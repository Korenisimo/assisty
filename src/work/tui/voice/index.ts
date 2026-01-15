// Voice Service - Main coordinator for TTS and STT functionality
// Manages global voice state across the TUI

import { EventEmitter } from 'events';
import { VoiceState, VoiceEvent, ParsedVoiceCommand } from '../types.js';
import { SpeechToText, STTConfig } from './stt.js';
import { TextToSpeech, TTSConfig } from './tts.js';
import { parseVoiceCommand, isCommand, suggestCommand } from './commands.js';
import { isFeatureAvailable, Platform } from '../../../utils/platform/index.js';

export interface VoiceServiceConfig {
  stt?: STTConfig;
  tts?: TTSConfig;
}

export interface VoiceServiceEvents {
  'state_change': (state: VoiceState) => void;
  'command': (command: ParsedVoiceCommand) => void;
  'tts_toggle': (enabled: boolean) => void;
  'error': (error: Error) => void;
  'info': (message: string) => void;
}

export class VoiceService extends EventEmitter {
  private stt: SpeechToText | null = null;
  private tts: TextToSpeech | null = null;
  private state: VoiceState;
  private lastResponse: string | null = null;  // For "read again" command
  private activeWorkstreamId: string | null = null;  // Track which workstream is active
  private platformSupportsVoice: boolean;

  constructor(config: VoiceServiceConfig = {}) {
    super();
    
    // Check if voice features are available on this platform
    this.platformSupportsVoice = isFeatureAvailable('voice');
    
    this.state = {
      ttsEnabled: false,
      isRecording: false,
      isSpeaking: false,
      isTranscribing: false,
      isPreprocessing: false,
    };
    
    // Only initialize voice services if available on this platform
    if (this.platformSupportsVoice) {
      this.stt = new SpeechToText(config.stt);
      this.tts = new TextToSpeech(config.tts);
      this.setupEventListeners();
    } else {
      // Voice features not available on this platform
      console.debug(`Voice features not available on ${Platform.name} - voice service disabled`);
    }
  }

  private setupEventListeners(): void {
    // Safety check - should only be called when voice is available
    if (!this.stt || !this.tts) {
      return;
    }
    
    // STT events
    this.stt.on('recording_started', () => {
      this.updateState({ isRecording: true });
      this.emit('info', '🎤 Recording... (press [ again to stop)');
    });

    this.stt.on('recording_stopped', () => {
      this.updateState({ isRecording: false });
      this.emit('info', '🎤 Recording stopped, processing...');
    });

    this.stt.on('transcription_started', () => {
      this.updateState({ isTranscribing: true });
      this.emit('info', '📝 Transcribing with Whisper...');
    });

    this.stt.on('transcription_complete', (text: string) => {
      this.updateState({ isTranscribing: false });
      this.handleTranscription(text);
    });

    this.stt.on('error', (error: Error) => {
      this.updateState({ 
        isRecording: false, 
        isTranscribing: false,
        lastError: error.message,
      });
      this.emit('error', error);
    });

    // TTS events
    this.tts.on('preprocessing_started', () => {
      this.updateState({ isPreprocessing: true });
    });

    this.tts.on('preprocessing_complete', () => {
      this.updateState({ isPreprocessing: false });
    });

    this.tts.on('speaking_started', () => {
      this.updateState({ isSpeaking: true });
    });

    this.tts.on('speaking_complete', () => {
      this.updateState({ isSpeaking: false });
    });

    this.tts.on('error', (error: Error) => {
      this.updateState({ 
        isSpeaking: false,
        isPreprocessing: false,
        lastError: error.message,
      });
      this.emit('error', error);
    });
  }

  private updateState(partial: Partial<VoiceState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('state_change', this.state);
  }

  private handleTranscription(text: string): void {
    if (!text.trim()) {
      this.emit('info', '🎤 No speech detected');
      return;
    }

    // Show what was transcribed for debugging
    this.emit('info', `🎤 Heard: "${text}"`);

    // Check if it's a command
    if (!isCommand(text)) {
      this.emit('info', `❌ Ignored (must start with "COMMAND")`);
      return;
    }

    // Try to parse the command
    const command = parseVoiceCommand(text);
    
    if (command) {
      this.emit('info', `✅ Command: ${command.type}${command.args ? ` "${command.args}"` : ''}`);
      this.emit('command', command);
    } else {
      // Try fuzzy matching
      const suggestion = suggestCommand(text);
      if (suggestion) {
        this.emit('info', `❓ Unknown. Try: "command ${suggestion}"?`);
      } else {
        // Show what we tried to parse
        const afterCommand = text.replace(/^command[,.:;]?\s+/i, '').trim();
        this.emit('info', `❓ Can't parse: "${afterCommand}"`);
      }
    }
  }

  // Public API

  /**
   * Get current voice state
   */
  getState(): VoiceState {
    return { ...this.state };
  }

  /**
   * Toggle TTS mode on/off
   */
  toggleTTS(): boolean {
    // Check if voice features are available
    if (!this.platformSupportsVoice) {
      this.emit('info', 'Text-to-speech is not available on this platform');
      return false;
    }
    
    const newState = !this.state.ttsEnabled;
    this.updateState({ ttsEnabled: newState });
    this.emit('tts_toggle', newState);
    
    if (newState) {
      this.emit('info', '🔊 Text-to-speech enabled');
    } else {
      this.emit('info', '🔇 Text-to-speech disabled');
      this.tts?.stop();  // Stop any current speech
    }
    
    return newState;
  }

  /**
   * Set TTS mode explicitly
   */
  setTTS(enabled: boolean): void {
    if (this.state.ttsEnabled !== enabled) {
      this.toggleTTS();
    }
  }

  /**
   * Toggle recording on/off
   */
  async toggleRecording(): Promise<void> {
    // Check if voice features are available
    if (!this.platformSupportsVoice) {
      this.emit('info', 'Voice recording is not available on this platform');
      return;
    }
    
    if (this.state.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  /**
   * Start recording
   */
  async startRecording(): Promise<void> {
    // Check if voice features are available
    if (!this.platformSupportsVoice || !this.stt) {
      this.emit('info', 'Voice recording is not available on this platform');
      return;
    }
    
    if (this.state.isRecording) {
      return;
    }

    // Check dependencies first
    const deps = await this.stt.checkDependencies();
    if (!deps.sox) {
      this.emit('error', new Error('sox not installed. Run: brew install sox'));
      return;
    }
    if (!deps.whisper) {
      this.emit('error', new Error('whisper-cpp not installed. Run: brew install whisper-cpp'));
      return;
    }
    if (!deps.model) {
      this.emit('info', SpeechToText.getModelDownloadInstructions());
      this.emit('error', new Error('Whisper model not found. See instructions above.'));
      return;
    }

    this.stt.startRecording();
  }

  /**
   * Stop recording and process
   */
  stopRecording(): void {
    if (!this.state.isRecording || !this.stt) {
      return;
    }

    // Just stop recording - transcription is triggered automatically
    // by the 'close' event handler in stt.ts
    this.stt.stopRecording();
  }

  /**
   * Speak text using TTS (if enabled)
   * Only speaks if TTS is enabled AND the response is from the active workstream
   */
  async speakResponse(text: string, workstreamId: string | null): Promise<void> {
    // Store for "read again" command
    this.lastResponse = text;

    // Only speak if voice is available and TTS is enabled
    if (!this.platformSupportsVoice || !this.tts || !this.state.ttsEnabled) {
      return;
    }

    // Only speak if this is from the currently active workstream (or general chat)
    if (workstreamId !== this.activeWorkstreamId) {
      return;
    }

    await this.tts.speak(text, true);  // true = preprocess
  }

  /**
   * Re-read the last response
   */
  async readAgain(): Promise<void> {
    // Check if voice features are available
    if (!this.platformSupportsVoice || !this.tts) {
      this.emit('info', 'Text-to-speech is not available on this platform');
      return;
    }
    
    if (!this.lastResponse) {
      this.emit('info', 'No response to read');
      return;
    }

    // Temporarily enable TTS for this read
    const wasEnabled = this.state.ttsEnabled;
    if (!wasEnabled) {
      this.updateState({ ttsEnabled: true });
    }

    await this.tts.speak(this.lastResponse, true);

    // Restore state
    if (!wasEnabled) {
      this.updateState({ ttsEnabled: false });
    }
  }

  /**
   * Stop any current speech
   */
  stopSpeaking(): void {
    this.tts?.stop();
  }

  /**
   * Update the active workstream ID (called by TUI when switching)
   */
  setActiveWorkstream(workstreamId: string | null): void {
    this.activeWorkstreamId = workstreamId;
  }

  /**
   * Check if voice features are available on this platform
   * This is the authoritative check used throughout the app
   */
  static isAvailable(): boolean {
    return isFeatureAvailable('voice');
  }

  /**
   * Get available TTS voices
   */
  static getVoices(): string[] {
    return TextToSpeech.listVoices();
  }

  /**
   * Set TTS voice
   */
  setVoice(voice: string): void {
    this.tts?.setVoice(voice);
  }

  /**
   * Set TTS speech rate
   */
  setRate(rate: number): void {
    this.tts?.setRate(rate);
  }

  /**
   * Check STT dependencies
   * Returns all false if voice is not available on this platform
   */
  async checkDependencies(): Promise<{ sox: boolean; whisper: boolean; model: boolean }> {
    if (!this.platformSupportsVoice || !this.stt) {
      return { sox: false, whisper: false, model: false };
    }
    return this.stt.checkDependencies();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.state.isRecording && this.stt) {
      this.stt.stopRecording();
    }
    this.tts?.stop();
  }
}

// Re-export for convenience
export { parseVoiceCommand, isCommand, getVoiceCommandHelp } from './commands.js';
export { SpeechToText } from './stt.js';
export { TextToSpeech } from './tts.js';
export type { ParsedVoiceCommand, VoiceCommandType } from '../types.js';

