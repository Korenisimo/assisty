// Web Browser Client - Generic browser automation for any website
// Uses Playwright to control browser - supports both user's Chrome and Playwright's Chromium
// Multi-domain session management with per-domain authentication

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

// Config paths (using platform-appropriate config directory)
function getConfigDir(): string {
  return ensurePlatformConfigDir();
}

function getWebSessionFile(): string {
  return join(getConfigDir(), 'web-sessions.json');
}

// Ensure config directory exists (delegates to platform utils)
function ensureConfigDir(): void {
  ensurePlatformConfigDir();
}

// Session storage per domain
interface DomainSession {
  domain: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  lastAccessed: string;
}

interface WebSessions {
  sessions: { [domain: string]: DomainSession };
}

export interface WebBrowserStatus {
  isOpen: boolean;
  currentUrl?: string;
  currentTitle?: string;
  domain?: string;
}

/**
 * WebBrowserManager - Controls a browser instance for generic web browsing
 * Singleton pattern - only one browser instance at a time
 */
export class WebBrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentUrl: string | null = null;
  private usingUserBrowser: boolean = false;

  /**
   * Launch browser and optionally navigate to a URL
   * 
   * Strategy:
   * 1. Try to connect to already-running Chrome via CDP (port 9222)
   * 2. Otherwise launch Playwright's Chromium with saved sessions
   */
  async launch(initialUrl?: string): Promise<{ 
    success: boolean; 
    error?: string; 
    usingUserBrowser: boolean;
    currentUrl?: string;
  }> {
    try {
      // Close existing browser if any
      if (this.browser || this.context) {
        await this.close();
      }

      // Strategy 1: Try to connect to existing Chrome with remote debugging
      const cdpConnected = await this.tryConnectToCDP();
      if (cdpConnected) {
        this.usingUserBrowser = true;
        
        if (initialUrl) {
          await this.page!.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.page!.waitForTimeout(1500);
          this.currentUrl = initialUrl;
        }
        
        return { success: true, usingUserBrowser: true, currentUrl: initialUrl };
      }

      // Strategy 2: Launch Playwright's Chromium with saved sessions
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--start-maximized',
        ],
      });

      // Load all saved sessions
      const sessions = this.loadSessions();
      const domain = initialUrl ? new URL(initialUrl).hostname : undefined;
      const domainSession = domain ? sessions.sessions[domain] : undefined;

      if (domainSession) {
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 800 },
          storageState: {
            cookies: domainSession.cookies,
            origins: [],
          },
        });
      } else {
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
      }

      this.page = await this.context.newPage();
      this.usingUserBrowser = false;

      if (initialUrl) {
        await this.page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(1500);
        this.currentUrl = initialUrl;
        
        // Save session for this domain
        await this.saveSession(domain!);
      }

      return { success: true, usingUserBrowser: false, currentUrl: initialUrl };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        usingUserBrowser: false,
      };
    }
  }

  /**
   * Try to connect to user's Chrome via Chrome DevTools Protocol (CDP)
   * Requires Chrome to be running with --remote-debugging-port=9222
   */
  private async tryConnectToCDP(): Promise<boolean> {
    try {
      // Try to connect to Chrome on port 9222
      this.browser = await chromium.connectOverCDP('http://localhost:9222');
      const contexts = this.browser.contexts();
      
      if (contexts.length > 0) {
        this.context = contexts[0];
        const pages = this.context.pages();
        
        if (pages.length > 0) {
          this.page = pages[0];
        } else {
          this.page = await this.context.newPage();
        }
        
        return true;
      }
      
      return false;
    } catch {
      // CDP connection failed - will fall back to launching Chromium
      return false;
    }
  }

  /**
   * Load all saved sessions from disk
   */
  private loadSessions(): WebSessions {
    ensureConfigDir();
    const sessionFile = getWebSessionFile();
    
    if (existsSync(sessionFile)) {
      try {
        const data = readFileSync(sessionFile, 'utf-8');
        return JSON.parse(data);
      } catch {
        return { sessions: {} };
      }
    }
    
    return { sessions: {} };
  }

  /**
   * Save session for a specific domain
   */
  private async saveSession(domain: string): Promise<void> {
    if (!this.context) return;
    
    try {
      ensureConfigDir();
      const state = await this.context.storageState();
      const sessions = this.loadSessions();
      
      sessions.sessions[domain] = {
        domain,
        cookies: state.cookies,
        lastAccessed: new Date().toISOString(),
      };
      
      writeFileSync(getWebSessionFile(), JSON.stringify(sessions, null, 2));
    } catch (error) {
      console.error('Failed to save web session:', error);
    }
  }

  /**
   * Navigate to a URL
   */
  async navigateToUrl(url: string): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not ready. Use launch() first.' };
    }

    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForTimeout(1500);
      this.currentUrl = url;
      
      // Save session for this domain
      const domain = new URL(url).hostname;
      await this.saveSession(domain);
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to navigate',
      };
    }
  }

  /**
   * Go back in browser history
   */
  async goBack(): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not ready' };
    }

    try {
      await this.page.goBack({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1000);
      this.currentUrl = this.page.url();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to go back',
      };
    }
  }

  /**
   * Go forward in browser history
   */
  async goForward(): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not ready' };
    }

    try {
      await this.page.goForward({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1000);
      this.currentUrl = this.page.url();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to go forward',
      };
    }
  }

  /**
   * Scroll the page
   */
  async scroll(direction: 'up' | 'down' | 'to_bottom' | 'to_top'): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not ready' };
    }

    try {
      switch (direction) {
        case 'up':
          await this.page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.8));
          break;
        case 'down':
          await this.page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
          break;
        case 'to_bottom':
          await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          break;
        case 'to_top':
          await this.page.evaluate(() => window.scrollTo(0, 0));
          break;
      }
      
      await this.page.waitForTimeout(500);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to scroll',
      };
    }
  }

  /**
   * Take a screenshot
   */
  async takeScreenshot(name: string = 'web-screenshot'): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not ready' };
    }

    try {
      const debugDir = join(process.cwd(), 'WORK_DIRS', 'web-debug');
      if (!existsSync(debugDir)) {
        mkdirSync(debugDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = join(debugDir, filename);

      await this.page.screenshot({ path: filepath, fullPage: true });

      return { success: true, path: filepath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to take screenshot',
      };
    }
  }

  /**
   * Get current browser status
   */
  async getStatus(): Promise<WebBrowserStatus> {
    if (!this.page) {
      return { isOpen: false };
    }

    try {
      const url = this.page.url();
      const title = await this.page.title();
      const domain = new URL(url).hostname;

      return {
        isOpen: true,
        currentUrl: url,
        currentTitle: title,
        domain,
      };
    } catch {
      return { isOpen: false };
    }
  }

  /**
   * Get the page object for direct manipulation by extractor
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    try {
      // Don't close if we're connected to user's Chrome via CDP
      if (this.usingUserBrowser && this.browser) {
        // Just disconnect, don't close the user's browser
        await this.browser.close();
      } else if (this.browser) {
        // Close Playwright's browser
        await this.browser.close();
      }
    } catch (error) {
      console.error('Error closing browser:', error);
    } finally {
      this.browser = null;
      this.context = null;
      this.page = null;
      this.currentUrl = null;
      this.usingUserBrowser = false;
    }
  }
}

// Singleton instance
let webBrowserInstance: WebBrowserManager | null = null;

/**
 * Get or create the web browser singleton
 */
export function getWebBrowser(): WebBrowserManager {
  if (!webBrowserInstance) {
    webBrowserInstance = new WebBrowserManager();
  }
  return webBrowserInstance;
}

/**
 * Clean up browser instance
 */
export async function closeWebBrowser(): Promise<void> {
  if (webBrowserInstance) {
    await webBrowserInstance.close();
    webBrowserInstance = null;
  }
}

