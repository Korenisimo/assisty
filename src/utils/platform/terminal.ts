/**
 * Cross-platform Terminal Service
 * 
 * Provides terminal capability detection for TUI applications.
 * Handles differences between Windows Terminal, PowerShell, cmd.exe,
 * and Unix terminals (xterm, iTerm2, etc.).
 */

import { Platform } from '../platform.js';

export class TerminalService {
  /**
   * Check if the terminal supports ANSI colors
   * Modern Windows terminals (Windows Terminal, VS Code) support colors.
   * Legacy cmd.exe has limited support.
   */
  static supportsColor(): boolean {
    // Check common env variables that indicate color support
    if (process.env.COLORTERM) {
      return true;
    }
    
    // 'dumb' terminals don't support colors
    if (process.env.TERM === 'dumb') {
      return false;
    }
    
    // Force color support check for NO_COLOR standard
    if (process.env.NO_COLOR !== undefined) {
      return false;
    }
    
    if (Platform.isWindows) {
      // Windows Terminal, ConEmu, VS Code terminal support colors
      return !!(
        process.env.WT_SESSION ||           // Windows Terminal
        process.env.ConEmuANSI === 'ON' ||  // ConEmu
        process.env.TERM_PROGRAM === 'vscode' || // VS Code integrated terminal
        process.env.ANSICON ||              // ANSICON
        process.env.TERM?.includes('color') ||
        process.env.TERM?.includes('xterm') ||
        // Windows 10 build 14393+ supports ANSI by default
        TerminalService.isModernWindowsConsole()
      );
    }
    
    // macOS and Linux generally support colors
    return true;
  }

  /**
   * Check if running on modern Windows console (build 14393+)
   * This version supports ANSI escape codes natively
   */
  private static isModernWindowsConsole(): boolean {
    if (!Platform.isWindows) return false;
    
    // Check if we have a TTY - required for ANSI support
    if (!process.stdout.isTTY) return false;
    
    // Windows 10 version 1511 (build 10586) added limited ANSI support
    // Windows 10 version 1607 (build 14393) added full ANSI support
    // We can't easily check the build version, but modern Node.js
    // enables VT processing by default on Windows 10+
    return true;
  }

  /**
   * Check if terminal supports Unicode characters
   * This affects box-drawing characters and emoji rendering
   */
  static supportsUnicode(): boolean {
    if (Platform.isWindows) {
      // Modern terminals support Unicode
      if (
        process.env.WT_SESSION ||              // Windows Terminal
        process.env.TERM_PROGRAM === 'vscode' || // VS Code
        process.env.ConEmuANSI === 'ON'        // ConEmu
      ) {
        return true;
      }
      
      // Check for UTF-8 codepage (65001)
      // This is commonly set in modern Windows setups
      if (process.env.LANG?.includes('UTF-8') || process.env.LC_ALL?.includes('UTF-8')) {
        return true;
      }
      
      // Conservative default for Windows - assume basic support
      // Box-drawing characters in Unicode work in most modern terminals
      return true;
    }
    
    // Unix terminals generally support Unicode
    return true;
  }

  /**
   * Get terminal type for blessed library configuration
   * Returns a terminal type string that blessed understands
   */
  static getTerminalType(): string {
    if (Platform.isWindows) {
      // Windows Terminal identifies itself
      if (process.env.WT_SESSION) {
        return 'xterm-256color'; // Windows Terminal emulates xterm well
      }
      
      // VS Code terminal
      if (process.env.TERM_PROGRAM === 'vscode') {
        return 'xterm-256color';
      }
      
      // ConEmu
      if (process.env.ConEmuANSI === 'ON') {
        return 'xterm-256color';
      }
      
      // Fallback for other Windows terminals
      // Use xterm-256color which most modern terminals support
      return process.env.TERM || 'xterm-256color';
    }
    
    // Unix - use TERM environment variable or default
    return process.env.TERM || 'xterm-256color';
  }

  /**
   * Check if running in Windows Terminal (the modern terminal app)
   */
  static isWindowsTerminal(): boolean {
    return Platform.isWindows && !!process.env.WT_SESSION;
  }

  /**
   * Check if running in VS Code's integrated terminal
   */
  static isVSCodeTerminal(): boolean {
    return process.env.TERM_PROGRAM === 'vscode';
  }

  /**
   * Check if running in a capable terminal (colors + unicode)
   */
  static isCapableTerminal(): boolean {
    return TerminalService.supportsColor() && TerminalService.supportsUnicode();
  }

  /**
   * Get recommended terminal for the platform
   * Shown to users when they're using a less capable terminal
   */
  static getRecommendedTerminal(): string {
    if (Platform.isWindows) {
      return 'Windows Terminal (recommended) or PowerShell';
    } else if (Platform.isMacOS) {
      return 'Terminal.app or iTerm2';
    } else {
      return 'xterm, gnome-terminal, or konsole';
    }
  }

  /**
   * Get terminal info for diagnostics/debugging
   */
  static getTerminalInfo(): Record<string, string | boolean> {
    return {
      platform: Platform.name,
      term: process.env.TERM || 'not set',
      colorterm: process.env.COLORTERM || 'not set',
      termProgram: process.env.TERM_PROGRAM || 'not set',
      isWindowsTerminal: TerminalService.isWindowsTerminal(),
      isVSCodeTerminal: TerminalService.isVSCodeTerminal(),
      supportsColor: TerminalService.supportsColor(),
      supportsUnicode: TerminalService.supportsUnicode(),
      terminalType: TerminalService.getTerminalType(),
      isTTY: process.stdout.isTTY ? 'true' : 'false',
    };
  }

  /**
   * Get box-drawing character set based on terminal capability
   * Falls back to ASCII if Unicode isn't supported
   */
  static getBoxCharacters(): {
    top: string;
    bottom: string;
    left: string;
    right: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    horizontal: string;
    vertical: string;
  } {
    if (TerminalService.supportsUnicode()) {
      return {
        top: '─',
        bottom: '─',
        left: '│',
        right: '│',
        topLeft: '┌',
        topRight: '┐',
        bottomLeft: '└',
        bottomRight: '┘',
        horizontal: '─',
        vertical: '│',
      };
    } else {
      // ASCII fallback for limited terminals
      return {
        top: '-',
        bottom: '-',
        left: '|',
        right: '|',
        topLeft: '+',
        topRight: '+',
        bottomLeft: '+',
        bottomRight: '+',
        horizontal: '-',
        vertical: '|',
      };
    }
  }

  /**
   * Print a warning if terminal capabilities are limited
   * Should be called at TUI startup
   */
  static getCapabilityWarning(): string | null {
    if (Platform.isWindows && !TerminalService.isCapableTerminal()) {
      return `Limited terminal detected. For best experience, use ${TerminalService.getRecommendedTerminal()}`;
    }
    return null;
  }
}
