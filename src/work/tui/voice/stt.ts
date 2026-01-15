// Speech-to-Text module using sox for recording and local Whisper for transcription
// Requires: brew install sox whisper-cpp

import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, unlinkSync, statSync, readFileSync } from 'fs';
import { EventEmitter } from 'events';

export interface STTConfig {
  whisperModelPath?: string;  // Path to whisper model, defaults to base.en
  sampleRate?: number;        // Audio sample rate, defaults to 16000
  channels?: number;          // Audio channels, defaults to 1 (mono)
}

export interface STTEvents {
  'recording_started': () => void;
  'recording_stopped': (audioPath: string) => void;
  'transcription_started': () => void;
  'transcription_complete': (text: string) => void;
  'error': (error: Error) => void;
}

// Common model paths to check
const MODEL_PATHS = [
  // Homebrew Apple Silicon
  '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
  '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
  // Homebrew Intel
  '/usr/local/share/whisper-cpp/models/ggml-base.en.bin',
  '/usr/local/share/whisper-cpp/models/ggml-base.bin',
  // Home directory
  `${process.env.HOME}/.whisper/ggml-base.en.bin`,
  `${process.env.HOME}/.whisper/ggml-base.bin`,
  // Current directory
  './models/ggml-base.en.bin',
];

function findModelPath(): string | null {
  for (const path of MODEL_PATHS) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export class SpeechToText extends EventEmitter {
  private config: Required<STTConfig>;
  private recordingProcess: ChildProcess | null = null;
  private currentAudioPath: string | null = null;
  private isRecording = false;

  constructor(config: STTConfig = {}) {
    super();
    this.config = {
      whisperModelPath: config.whisperModelPath || findModelPath() || '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
    };
  }

  /**
   * Get instructions for downloading the whisper model
   */
  static getModelDownloadInstructions(): string {
    return `
Whisper model not found. Download it with:

  # Create models directory
  mkdir -p /opt/homebrew/share/whisper-cpp/models

  # Download base.en model (~150MB, recommended for speed)
  curl -L -o /opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin \\
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Or visit: https://huggingface.co/ggerganov/whisper.cpp/tree/main
    `.trim();
  }

  /**
   * Check if required dependencies are installed
   */
  async checkDependencies(): Promise<{ sox: boolean; whisper: boolean; model: boolean; modelPath?: string }> {
    const results: { sox: boolean; whisper: boolean; model: boolean; modelPath?: string } = {
      sox: false,
      whisper: false,
      model: false,
    };

    // Check sox
    try {
      const { execSync } = await import('child_process');
      execSync('which sox', { stdio: 'ignore' });
      results.sox = true;
    } catch {
      // sox not found
    }

    // Check whisper-cpp (homebrew installs as whisper-cli)
    const whisperBinaries = ['whisper-cli', 'whisper-cpp', 'whisper'];
    for (const bin of whisperBinaries) {
      try {
        const { execSync } = await import('child_process');
        execSync(`which ${bin}`, { stdio: 'ignore' });
        results.whisper = true;
        break;
      } catch {
        // Try next binary name
      }
    }

    // Check model - try to find it
    const foundModel = findModelPath();
    if (foundModel) {
      this.config.whisperModelPath = foundModel;
      results.model = true;
      results.modelPath = foundModel;
    } else {
      results.model = existsSync(this.config.whisperModelPath);
      if (results.model) {
        results.modelPath = this.config.whisperModelPath;
      }
    }

    return results;
  }

  /**
   * Start recording audio from microphone
   */
  startRecording(): void {
    if (this.isRecording) {
      this.emit('error', new Error('Already recording'));
      return;
    }

    // Generate temp file path for audio
    this.currentAudioPath = join(tmpdir(), `voice-recording-${Date.now()}.wav`);

    // Start sox recording
    // -d = default audio device (microphone)
    // -r = sample rate
    // -c = channels
    // -b 16 = 16-bit audio
    this.recordingProcess = spawn('sox', [
      '-d',                           // Default input device
      '-r', String(this.config.sampleRate),
      '-c', String(this.config.channels),
      '-b', '16',                     // 16-bit audio
      this.currentAudioPath,          // Output file
      'silence', '1', '0.1', '1%',    // Start when sound detected
      '1', '1.0', '1%',               // Stop after 1s of silence
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isRecording = true;
    this.emit('recording_started');

    this.recordingProcess.on('error', (err) => {
      this.isRecording = false;
      this.emit('error', new Error(`Recording failed: ${err.message}`));
    });

    this.recordingProcess.on('close', (code) => {
      const wasRecording = this.isRecording;
      this.isRecording = false;
      this.recordingProcess = null;
      
      if (this.currentAudioPath && existsSync(this.currentAudioPath)) {
        // Check if file has content (not empty)
        const stats = statSync(this.currentAudioPath);
        if (stats.size > 1000) {  // More than 1KB means we have audio
          this.emit('recording_stopped', this.currentAudioPath);
          // Auto-transcribe when sox stops due to silence detection
          if (wasRecording) {
            this.transcribe(this.currentAudioPath).catch((err) => {
              this.emit('error', err);
            });
          }
        } else {
          this.emit('error', new Error('No speech detected (recording too short)'));
        }
      } else if (code !== 0 && code !== null) {
        this.emit('error', new Error(`Recording ended with code ${code}`));
      }
    });
  }

  /**
   * Stop recording and return the audio file path
   */
  stopRecording(): string | null {
    if (!this.isRecording || !this.recordingProcess) {
      return null;
    }

    // Send SIGTERM to stop recording gracefully
    // NOTE: Don't set isRecording = false here - let the 'close' event handler do it
    // so that auto-transcription is triggered properly
    this.recordingProcess.kill('SIGTERM');

    return this.currentAudioPath;
  }

  /**
   * Check if currently recording
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Find the whisper binary
   */
  private findWhisperBinary(): string {
    const binaries = [
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli',
      '/opt/homebrew/bin/whisper-cpp',
      '/usr/local/bin/whisper-cpp',
    ];
    for (const bin of binaries) {
      if (existsSync(bin)) {
        return bin;
      }
    }
    return 'whisper-cli';  // Default, let it fail if not found
  }

  /**
   * Transcribe an audio file using Whisper
   */
  async transcribe(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.emit('transcription_started');

      // Find the whisper binary (homebrew installs as whisper-cli)
      const whisperCmd = this.findWhisperBinary();
      const isWhisperCli = whisperCmd.includes('whisper-cli') || whisperCmd.includes('whisper-cpp');
      
      let args: string[];
      if (isWhisperCli) {
        // whisper-cli / whisper-cpp syntax
        args = [
          '-m', this.config.whisperModelPath,
          '-f', audioPath,
          '-nt',  // No timestamps
          '-np',  // No progress
        ];
      } else {
        // OpenAI whisper Python syntax
        args = [
          audioPath,
          '--model', 'base.en',
          '--output_format', 'txt',
          '--output_dir', tmpdir(),
        ];
      }

      const whisperProcess = spawn(whisperCmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      whisperProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      whisperProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      whisperProcess.on('error', (err) => {
        this.emit('error', new Error(`Transcription failed: ${err.message}`));
        reject(err);
      });

      whisperProcess.on('close', (code) => {
        // Clean up audio file
        try {
          if (existsSync(audioPath)) {
            unlinkSync(audioPath);
          }
        } catch {
          // Ignore cleanup errors
        }

        if (code !== 0) {
          const error = new Error(`Transcription failed with code ${code}: ${stderr}`);
          this.emit('error', error);
          reject(error);
          return;
        }

        // Parse output based on whisper variant
        let text = '';
        if (isWhisperCli) {
          // whisper-cli/whisper-cpp outputs directly to stdout
          text = stdout.trim();
        } else {
          // OpenAI whisper outputs to a .txt file
          const txtPath = audioPath.replace('.wav', '.txt');
          if (existsSync(txtPath)) {
            text = readFileSync(txtPath, 'utf-8').trim();
            try {
              unlinkSync(txtPath);
            } catch {
              // Ignore
            }
          } else {
            text = stdout.trim();
          }
        }

        this.emit('transcription_complete', text);
        resolve(text);
      });
    });
  }

  /**
   * Record and transcribe in one call
   * Returns a promise that resolves when user stops recording
   */
  async recordAndTranscribe(): Promise<string> {
    return new Promise((resolve, reject) => {
      const handleStop = async (audioPath: string) => {
        try {
          const text = await this.transcribe(audioPath);
          resolve(text);
        } catch (err) {
          reject(err);
        }
      };

      const handleError = (err: Error) => {
        this.removeListener('recording_stopped', handleStop);
        reject(err);
      };

      this.once('recording_stopped', handleStop);
      this.once('error', handleError);

      this.startRecording();
    });
  }
}

