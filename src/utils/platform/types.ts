/**
 * Platform Service Interfaces
 * 
 * Type definitions for platform-specific services that will be
 * implemented in later phases of Windows compatibility work.
 */

/**
 * Cross-platform clipboard operations
 */
export interface ClipboardService {
  /** Copy text to system clipboard */
  copy(text: string): Promise<boolean>;
  /** Paste text from system clipboard */
  paste(): Promise<string | null>;
  /** Check if clipboard operations are available */
  isAvailable(): boolean;
}

/**
 * Cross-platform shell command execution
 */
export interface ShellService {
  /** Get the default shell for the platform */
  getDefaultShell(): string;
  /** Get the preferred shell for command execution */
  getPreferredShell(): string;
  /** Format a command for the platform's shell */
  formatCommand(command: string): string;
  /** Get the path separator for the platform */
  getPathSeparator(): string;
  /** Check if a command exists in PATH */
  commandExists(command: string): boolean;
  /** Normalize path for the platform */
  normalizePath(path: string): string;
}

/**
 * Cross-platform editor operations
 */
export interface EditorService {
  /** Get the default editor for the platform */
  getDefaultEditor(): string;
  /** Open a file in the default editor */
  openFile(filepath: string): Promise<void>;
}

/**
 * Cross-platform browser operations
 */
export interface BrowserService {
  /** Open a URL in the default browser */
  open(url: string): Promise<void>;
}

/**
 * Cross-platform terminal operations
 */
export interface TerminalService {
  /** Check if the terminal supports ANSI colors */
  supportsColor(): boolean;
  /** Check if the terminal supports unicode */
  supportsUnicode(): boolean;
  /** Get terminal type for blessed */
  getTerminalType(): string;
  /** Check if running in Windows Terminal */
  isWindowsTerminal(): boolean;
  /** Get recommended terminal for the platform */
  getRecommendedTerminal(): string;
}

/**
 * Cross-platform voice services
 */
export interface VoiceService {
  tts: {
    /** Check if TTS is available on this platform */
    isAvailable(): boolean;
    /** Speak text using platform TTS */
    speak(text: string, preprocess?: boolean): Promise<void>;
    /** Stop any current speech */
    stop(): void;
  };
  stt: {
    /** Check if STT is available on this platform */
    isAvailable(): boolean;
    /** Start voice recording */
    startRecording(): Promise<void>;
    /** Stop voice recording and get transcription */
    stopRecording(): Promise<string>;
  };
}

/**
 * Cursor IDE integration service
 */
export interface CursorService {
  /** Find the Cursor CLI executable */
  findCli(): string | null;
  /** Check if Cursor is available */
  isAvailable(): boolean;
  /** Invoke Cursor CLI with arguments */
  invoke(args: string[]): Promise<void>;
}
