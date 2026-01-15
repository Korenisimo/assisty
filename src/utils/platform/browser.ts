/**
 * Cross-platform Browser Service
 * 
 * Opens URLs in the system default browser.
 * Uses the 'open' package which handles platform differences internally.
 */

import open from 'open';

export class BrowserService {
  /**
   * Open a URL in the default browser
   * @param url - The URL to open
   * @throws Error if opening the URL fails
   */
  static async open(url: string): Promise<void> {
    try {
      await open(url);
    } catch (error) {
      throw new Error(
        `Failed to open URL: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Open a URL in the default browser, silently ignoring errors
   * Useful when opening URLs is not critical to the operation
   * @param url - The URL to open
   */
  static async openQuietly(url: string): Promise<void> {
    try {
      await open(url);
    } catch {
      // Silently ignore errors
    }
  }

  /**
   * Check if browser opening is available
   * @returns true (available on all platforms via 'open' package)
   */
  static isAvailable(): boolean {
    return true;
  }
}
