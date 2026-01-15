/**
 * Cross-platform Shell Service
 * 
 * Provides platform-aware shell detection and command execution utilities.
 * Handles differences between PowerShell/cmd (Windows) and bash/zsh (Unix).
 */

import { execSync } from 'child_process';
import { sep } from 'path';
import { Platform } from '../platform.js';

export class ShellService {
  /**
   * Get the default shell for the platform
   * On Windows, returns COMSPEC (usually cmd.exe)
   * On Unix, returns SHELL env var or /bin/bash
   */
  static getDefaultShell(): string {
    if (Platform.isWindows) {
      return process.env.COMSPEC || 'cmd.exe';
    } else {
      return process.env.SHELL || '/bin/bash';
    }
  }

  /**
   * Get the preferred shell for executing commands
   * On Windows, prefers PowerShell Core (pwsh), then PowerShell, then cmd
   * On Unix, uses the default shell
   */
  static getPreferredShell(): string {
    if (Platform.isWindows) {
      // Check for PowerShell Core (pwsh) first - modern and cross-platform
      if (ShellService.commandExists('pwsh')) {
        return 'pwsh';
      }
      // Check for Windows PowerShell (powershell)
      if (ShellService.commandExists('powershell')) {
        return 'powershell';
      }
      // Fallback to cmd.exe
      return 'cmd.exe';
    }
    return ShellService.getDefaultShell();
  }

  /**
   * Get the path separator for the platform
   */
  static getPathSeparator(): string {
    return sep;
  }

  /**
   * Format a command for the platform's shell
   * Currently returns command as-is, but could be extended to translate
   * common commands (e.g., ls -> dir on Windows)
   * 
   * @param command - The command to format
   * @returns The formatted command
   */
  static formatCommand(command: string): string {
    // For now, return as-is
    // Future enhancement: translate common commands
    return command;
  }

  /**
   * Check if a command exists in PATH
   * Uses 'where' on Windows, 'which' on Unix
   * 
   * @param command - The command to check
   * @returns true if the command exists
   */
  static commandExists(command: string): boolean {
    try {
      if (Platform.isWindows) {
        execSync(`where ${command}`, { 
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        execSync(`which ${command}`, { stdio: 'ignore' });
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalize a path for the current platform
   * Converts forward slashes to backslashes on Windows, and vice versa on Unix
   * 
   * @param path - The path to normalize
   * @returns The normalized path
   */
  static normalizePath(path: string): string {
    if (Platform.isWindows) {
      return path.replace(/\//g, '\\');
    }
    return path.replace(/\\/g, '/');
  }

  /**
   * Get the shell options for child_process.exec
   * Returns appropriate shell configuration for the platform
   */
  static getExecOptions(): { shell: string; windowsHide?: boolean } {
    const shell = ShellService.getPreferredShell();
    
    if (Platform.isWindows) {
      return {
        shell,
        windowsHide: true, // Don't show a console window
      };
    }
    
    return { shell };
  }

  /**
   * Get an environment variable, handling case-insensitivity on Windows
   * 
   * @param name - Environment variable name
   * @returns The value or undefined
   */
  static getEnvVar(name: string): string | undefined {
    if (Platform.isWindows) {
      // Windows env vars are case-insensitive
      // Check both original case and uppercase
      return process.env[name] || process.env[name.toUpperCase()];
    }
    return process.env[name];
  }

  /**
   * Quote a path for use in shell commands
   * Handles paths with spaces correctly on both platforms
   * 
   * @param path - The path to quote
   * @returns The quoted path
   */
  static quotePath(path: string): string {
    if (path.includes(' ')) {
      return `"${path}"`;
    }
    return path;
  }
}
