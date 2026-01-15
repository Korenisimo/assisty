// Text-to-Speech module using macOS native `say` command
// with Gemini Flash preprocessing for voice-friendly text

import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

export interface TTSConfig {
  voice?: string;           // macOS voice to use (e.g., 'Samantha', 'Alex')
  rate?: number;            // Speech rate in words per minute (default: 175)
  preprocessingModel?: string;  // Gemini model for preprocessing
}

export interface TTSEvents {
  'preprocessing_started': () => void;
  'preprocessing_complete': (text: string) => void;
  'speaking_started': () => void;
  'speaking_complete': () => void;
  'error': (error: Error) => void;
}

// Preprocessing prompt for making text voice-friendly
const VOICE_PREPROCESSING_PROMPT = `You are a text-to-speech preprocessor. Your job is to convert written text into a format that sounds natural when spoken aloud.

Rules:
1. Expand abbreviations: "PR" → "pull request", "JIRA" → "Jira", "API" → "A.P.I.", "URL" → "U.R.L."
2. Convert markdown to spoken form: remove formatting symbols, describe links naturally
3. Convert code snippets to spoken descriptions: \`function()\` → "the function"
4. Replace bullet points with natural transitions: "• item" → "First, item. Then, item."
5. Numbers and dates should be spoken naturally: "2024-01-07" → "January 7th, 2024"
6. Remove or describe emojis: "✓" → "check", "⚠️" → "warning"
7. Keep the response concise - summarize if the original is very long (>500 words)
8. Use natural pauses: add commas where breaths would occur
9. Never include formatting like asterisks, underscores, or backticks
10. If the text contains a list, summarize the key points rather than reading each item

Output ONLY the voice-friendly text, no explanations or meta-commentary.`;

export class TextToSpeech extends EventEmitter {
  private config: Required<TTSConfig>;
  private speakingProcess: ChildProcess | null = null;
  private isSpeaking = false;
  private llm: ChatGoogleGenerativeAI | null = null;

  constructor(config: TTSConfig = {}) {
    super();
    this.config = {
      voice: config.voice || 'Samantha',  // Default macOS voice
      rate: config.rate || 175,
      preprocessingModel: config.preprocessingModel || 'gemini-2.0-flash-exp',
    };
  }

  /**
   * Initialize the LLM for preprocessing
   */
  private initLLM(): void {
    if (!this.llm) {
      this.llm = new ChatGoogleGenerativeAI({
        model: this.config.preprocessingModel,
        temperature: 0.3,  // Low temperature for consistent preprocessing
        maxOutputTokens: 1024,
      });
    }
  }

  /**
   * List available macOS voices
   */
  static listVoices(): string[] {
    try {
      const output = execSync('say -v "?"', { encoding: 'utf-8' });
      const voices: string[] = [];
      for (const line of output.split('\n')) {
        const match = line.match(/^(\S+)\s+/);
        if (match) {
          voices.push(match[1]);
        }
      }
      return voices;
    } catch {
      return ['Samantha', 'Alex', 'Victoria', 'Karen'];  // Fallback defaults
    }
  }

  /**
   * Check if TTS is available on this system
   */
  static isAvailable(): boolean {
    try {
      execSync('which say', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Preprocess text to make it voice-friendly using Gemini
   */
  async preprocessForVoice(text: string): Promise<string> {
    this.emit('preprocessing_started');

    // Skip preprocessing for very short text
    if (text.length < 50 && !text.includes('```') && !text.includes('**')) {
      this.emit('preprocessing_complete', text);
      return text;
    }

    try {
      this.initLLM();
      
      const response = await this.llm!.invoke([
        { role: 'system', content: VOICE_PREPROCESSING_PROMPT },
        { role: 'user', content: `Convert this to voice-friendly text:\n\n${text}` },
      ]);

      const processed = typeof response.content === 'string' 
        ? response.content 
        : response.content.toString();

      this.emit('preprocessing_complete', processed);
      return processed;
    } catch (error) {
      // On error, fall back to basic cleanup
      const fallback = this.basicCleanup(text);
      this.emit('preprocessing_complete', fallback);
      return fallback;
    }
  }

  /**
   * Basic text cleanup without LLM (fallback)
   */
  private basicCleanup(text: string): string {
    return text
      // Remove markdown formatting
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/```[\s\S]*?```/g, 'code block omitted')
      // Remove bullet points
      .replace(/^[-•*]\s*/gm, '')
      // Clean URLs
      .replace(/https?:\/\/[^\s]+/g, 'link')
      // Remove multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Speak text using macOS say command
   * Optionally preprocess first
   */
  async speak(text: string, preprocess = true): Promise<void> {
    if (this.isSpeaking) {
      this.stop();
    }

    // Preprocess if enabled
    const textToSpeak = preprocess 
      ? await this.preprocessForVoice(text)
      : text;

    return new Promise((resolve, reject) => {
      this.emit('speaking_started');
      this.isSpeaking = true;

      // Use macOS say command
      this.speakingProcess = spawn('say', [
        '-v', this.config.voice,
        '-r', String(this.config.rate),
        textToSpeak,
      ], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      this.speakingProcess.on('error', (err) => {
        this.isSpeaking = false;
        this.speakingProcess = null;
        const error = new Error(`TTS failed: ${err.message}`);
        this.emit('error', error);
        reject(error);
      });

      this.speakingProcess.on('close', (code) => {
        this.isSpeaking = false;
        this.speakingProcess = null;
        
        if (code === 0) {
          this.emit('speaking_complete');
          resolve();
        } else {
          // Code -15 is SIGTERM (normal stop)
          if (code === null || code === 143) {
            this.emit('speaking_complete');
            resolve();
          } else {
            const error = new Error(`TTS ended with code ${code}`);
            this.emit('error', error);
            reject(error);
          }
        }
      });
    });
  }

  /**
   * Speak text without preprocessing
   */
  async speakRaw(text: string): Promise<void> {
    return this.speak(text, false);
  }

  /**
   * Stop speaking
   */
  stop(): void {
    if (this.speakingProcess) {
      this.speakingProcess.kill('SIGTERM');
      this.isSpeaking = false;
      this.speakingProcess = null;
    }
  }

  /**
   * Check if currently speaking
   */
  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Set the voice
   */
  setVoice(voice: string): void {
    this.config.voice = voice;
  }

  /**
   * Set the speech rate
   */
  setRate(rate: number): void {
    this.config.rate = rate;
  }
}


