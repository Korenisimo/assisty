/**
 * Cross-platform Clipboard Service
 * 
 * Provides clipboard copy/paste operations that work on Windows, macOS, and Linux.
 * Uses platform-native commands: pbcopy/pbpaste (macOS), PowerShell (Windows), xclip (Linux).
 */

import { execSync } from 'child_process';
import { Platform } from '../platform.js';

export class ClipboardService {
  /**
   * Copy text to the system clipboard
   * @param text - The text to copy
   * @returns true if successful, false otherwise
   */
  static async copy(text: string): Promise<boolean> {
    try {
      if (Platform.isMacOS) {
        execSync('pbcopy', { input: text, encoding: 'utf-8' });
        return true;
      } else if (Platform.isWindows) {
        // Use PowerShell Set-Clipboard
        // Escape special characters for PowerShell
        const escapedText = text
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '`"')
          .replace(/\$/g, '`$');
        
        execSync(
          `powershell -NoProfile -Command "Set-Clipboard -Value \\"${escapedText}\\""`,
          { encoding: 'utf-8', windowsHide: true }
        );
        return true;
      } else if (Platform.isLinux) {
        execSync('xclip -selection clipboard', { input: text, encoding: 'utf-8' });
        return true;
      }
    } catch (error) {
      console.error('Clipboard copy failed:', error instanceof Error ? error.message : error);
      return false;
    }
    return false;
  }

  /**
   * Paste text from the system clipboard
   * @returns The clipboard content, or null if failed
   */
  static async paste(): Promise<string | null> {
    try {
      if (Platform.isMacOS) {
        return execSync('pbpaste', { encoding: 'utf-8' });
      } else if (Platform.isWindows) {
        return execSync('powershell -NoProfile -Command "Get-Clipboard"', { 
          encoding: 'utf-8',
          windowsHide: true,
        }).trim();
      } else if (Platform.isLinux) {
        return execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });
      }
    } catch (error) {
      console.error('Clipboard paste failed:', error instanceof Error ? error.message : error);
      return null;
    }
    return null;
  }

  /**
   * Check if clipboard operations are available on this platform
   * @returns true if clipboard is available
   */
  static isAvailable(): boolean {
    // Clipboard is available on all platforms we support
    // On Linux, xclip must be installed - but we'll handle errors gracefully
    return true;
  }
}
