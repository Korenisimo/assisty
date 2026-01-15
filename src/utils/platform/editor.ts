/**
 * Cross-platform Editor Service
 * 
 * Provides platform-aware editor detection and file opening.
 * Handles differences between Windows (notepad, VS Code) and Unix (vim, nano) defaults.
 */

import { spawn } from 'child_process';
import { Platform } from '../platform.js';
import { ShellService } from './shell.js';

export class EditorService {
  /**
   * Get the default editor for the platform
   * Checks environment variables first, then falls back to platform defaults.
   * 
   * Priority:
   * 1. EDITOR environment variable
   * 2. VISUAL environment variable
   * 3. VS Code (if available)
   * 4. Platform-specific default (vim on Unix, notepad on Windows)
   */
  static getDefaultEditor(): string {
    // Check environment variables first
    const envEditor = process.env.EDITOR || process.env.VISUAL;
    if (envEditor) {
      return envEditor;
    }

    // Check for VS Code - popular cross-platform choice
    if (ShellService.commandExists('code')) {
      return 'code --wait'; // --wait flag makes VS Code block until file is closed
    }

    // Platform-specific defaults
    if (Platform.isWindows) {
      // Try notepad++ first (popular Windows editor)
      if (ShellService.commandExists('notepad++')) {
        return 'notepad++';
      }
      // Fallback to notepad (always available on Windows)
      return 'notepad';
    } else if (Platform.isMacOS) {
      // macOS: prefer nano (more user-friendly than vim)
      if (ShellService.commandExists('nano')) {
        return 'nano';
      }
      return 'vim';
    } else {
      // Linux: prefer nano, fallback to vi
      if (ShellService.commandExists('nano')) {
        return 'nano';
      }
      return 'vi';
    }
  }

  /**
   * Open a file in the default editor and wait for it to close
   * 
   * @param filepath - The file to open
   * @returns Promise that resolves when the editor is closed
   * @throws Error if the editor exits with a non-zero code
   */
  static async openFile(filepath: string): Promise<void> {
    const editorCommand = EditorService.getDefaultEditor();
    
    // Parse the editor command (might include flags like "code --wait")
    const parts = editorCommand.split(' ');
    const editor = parts[0];
    const editorArgs = [...parts.slice(1), filepath];

    return new Promise((resolve, reject) => {
      const editorProcess = spawn(editor, editorArgs, {
        stdio: 'inherit', // Inherit stdin/stdout/stderr for interactive editing
        shell: true,
      });

      editorProcess.on('exit', (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Editor exited with code ${code}`));
        }
      });

      editorProcess.on('error', (err) => {
        reject(new Error(`Failed to open editor: ${err.message}`));
      });
    });
  }

  /**
   * Open a file in the default editor without waiting
   * Useful for viewing files in a detached window
   * 
   * @param filepath - The file to open
   */
  static openFileDetached(filepath: string): void {
    const editorCommand = EditorService.getDefaultEditor();
    
    // For detached mode, don't use --wait flag for VS Code
    const editor = editorCommand.replace(' --wait', '');
    const parts = editor.split(' ');
    const editorName = parts[0];
    const editorArgs = [...parts.slice(1), filepath];

    spawn(editorName, editorArgs, {
      stdio: 'ignore',
      detached: true,
      shell: true,
    }).unref();
  }

  /**
   * Check if a graphical editor is available
   * Useful for determining if we can open files in a GUI
   */
  static hasGraphicalEditor(): boolean {
    if (Platform.isWindows) {
      // Windows always has notepad
      return true;
    }
    
    // Check for common GUI editors
    return ShellService.commandExists('code') ||
           ShellService.commandExists('subl') ||
           ShellService.commandExists('atom') ||
           ShellService.commandExists('gedit') ||
           ShellService.commandExists('kate');
  }

  /**
   * Get a list of available editors on the system
   */
  static getAvailableEditors(): string[] {
    const editors: string[] = [];
    
    // Check common editors
    const candidates = Platform.isWindows
      ? ['code', 'notepad++', 'notepad', 'nvim', 'vim']
      : ['code', 'vim', 'nvim', 'nano', 'emacs', 'vi', 'gedit', 'kate'];
    
    for (const editor of candidates) {
      if (ShellService.commandExists(editor)) {
        editors.push(editor);
      }
    }
    
    return editors;
  }
}
