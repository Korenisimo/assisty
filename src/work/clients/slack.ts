// Slack Browser Client - Browser automation for Slack web UI
// Uses Playwright to control the USER'S ACTUAL BROWSER (not a sandboxed one)
// This means existing logins, cookies, and sessions are preserved

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

// Types for Slack data
export interface SlackChannel {
  name: string;
  id: string;
  unread: boolean;
  type: 'channel' | 'dm' | 'group';
}

export interface ParsedSlackUrl {
  type: 'channel' | 'message' | 'thread' | 'unknown';
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  workspaceId?: string;
  workspaceDomain?: string;
}

export interface SlackMessage {
  author: string;
  timestamp: string;
  content: string;
  threadReplies?: number;
  reactions?: string[];
  links?: Array<{
    url: string;
    text?: string;
    isSlackLink?: boolean;
  }>;
}

export interface SlackBrowserStatus {
  isOpen: boolean;
  isLoggedIn: boolean;
  currentChannel?: string;
  workspaceUrl?: string;
  workspaceName?: string;
}

// Config paths
const CONFIG_DIR = join(homedir(), '.config', 'hn-cli');
const SESSION_FILE = join(CONFIG_DIR, 'slack-session.json');
const SLACK_CONFIG_FILE = join(CONFIG_DIR, 'slack-config.json');

// Get the user's Chrome profile directory based on OS
function getUserChromeProfileDir(): string {
  const home = homedir();
  const os = platform();
  
  switch (os) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    case 'win32': // Windows
      return join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    case 'linux':
      return join(home, '.config', 'google-chrome');
    default:
      return join(home, '.config', 'google-chrome');
  }
}

// Get path to user's installed Chrome executable
function getChromePath(): string | undefined {
  const os = platform();
  
  const paths: Record<string, string[]> = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ],
  };
  
  const candidates = paths[os] || paths.linux;
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  
  return undefined; // Will use Playwright's bundled Chromium as fallback
}

// Ensure config directory exists
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Session storage
interface SlackSession {
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
  workspaceUrl: string;
  savedAt: string;
}

// Config storage
interface SlackConfig {
  workspaceUrl?: string;
  lastWorkspace?: string;
}

/**
 * SlackBrowser - Controls a browser instance for Slack web scraping
 * 
 * Singleton pattern - only one browser instance at a time
 */
export class SlackBrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private workspaceUrl: string | null = null;
  private isAuthenticated: boolean = false;

  /**
   * Launch browser and navigate to Slack workspace
   * 
   * Strategy:
   * 1. Try to connect to already-running Chrome via CDP (port 9222)
   * 2. If that fails, try to copy cookies from Chrome and use Playwright's Chromium
   * 3. Fall back to Playwright's Chromium with saved session
   */
  async launch(workspaceUrl: string): Promise<{ success: boolean; needsLogin: boolean; error?: string; usingUserBrowser: boolean; hint?: string }> {
    try {
      // Close existing browser if any
      if (this.browser || this.context) {
        await this.close();
      }

      this.workspaceUrl = workspaceUrl;

      // Strategy 1: Try to connect to existing Chrome with remote debugging
      const cdpConnected = await this.tryConnectToCDP();
      if (cdpConnected) {
        // Navigate to Slack in the connected browser
        await this.page!.goto(workspaceUrl, { waitUntil: 'domcontentloaded' });
        await this.page!.waitForTimeout(2000);
        
        const needsLogin = await this.checkNeedsLogin();
        this.isAuthenticated = !needsLogin;
        
        return { success: true, needsLogin, usingUserBrowser: true };
      }

      // Strategy 2: Launch Playwright's Chromium with saved session or Chrome cookies
      this.browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--start-maximized',  // Start maximized so it's visible
        ],
      });

      // Try to use saved session
      const session = this.loadSession();
      if (session && session.workspaceUrl === workspaceUrl) {
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 800 },
          storageState: {
            cookies: session.cookies,
            origins: [],
          },
        });
      } else {
        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
      }

      this.page = await this.context.newPage();

      // Navigate to Slack
      await this.page.goto(workspaceUrl, { waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);

      // Check if we're logged in
      const needsLogin = await this.checkNeedsLogin();
      this.isAuthenticated = !needsLogin;

      if (!needsLogin) {
        await this.saveSession();
      }

      // If login needed and Chrome is running, give hint about CDP
      const hint = needsLogin 
        ? 'TIP: To use your existing Chrome login, quit Chrome and restart it with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222'
        : undefined;

      return { success: true, needsLogin, usingUserBrowser: false, hint };
    } catch (error) {
      return {
        success: false,
        needsLogin: true,
        usingUserBrowser: false,
        error: error instanceof Error ? error.message : 'Unknown error launching browser',
      };
    }
  }

  /**
   * Try to connect to an already-running Chrome with remote debugging enabled
   */
  private async tryConnectToCDP(): Promise<boolean> {
    try {
      // Try to connect to Chrome running with --remote-debugging-port=9222
      this.browser = await chromium.connectOverCDP('http://localhost:9222');
      const contexts = this.browser.contexts();
      
      if (contexts.length > 0) {
        this.context = contexts[0];
        // Use existing page or create new one
        const pages = this.context.pages();
        this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
        return true;
      }
      
      // No contexts, close and try another method
      await this.browser.close();
      this.browser = null;
      return false;
    } catch {
      // CDP not available (Chrome not running with remote debugging)
      return false;
    }
  }

  /**
   * Check if user needs to login (not authenticated)
   */
  private async checkNeedsLogin(): Promise<boolean> {
    if (!this.page) return true;

    try {
      // Check for common login indicators
      const url = this.page.url();
      
      // If URL contains signin or oauth, we need login
      if (url.includes('signin') || url.includes('oauth') || url.includes('/sign_in')) {
        return true;
      }

      // Check for the main Slack app container (indicates we're logged in)
      const appContainer = await this.page.$('[data-qa="slack_kit_list"]');
      if (appContainer) {
        return false;
      }

      // Check for channel sidebar (another logged-in indicator)
      const sidebar = await this.page.$('[data-qa="channel_sidebar"]');
      if (sidebar) {
        return false;
      }

      // Check for "Couldn't sign in" or similar error pages
      const pageText = await this.page.textContent('body');
      if (pageText?.includes("Couldn't sign in") || pageText?.includes('try again')) {
        return true;
      }

      // If we're on /client/ path, we're likely logged in
      if (url.includes('/client/')) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }

  /**
   * Wait for user to complete login
   * Polls until authentication is detected
   */
  async waitForLogin(timeoutMs: number = 300000): Promise<{ success: boolean; error?: string }> {
    if (!this.page) {
      return { success: false, error: 'Browser not launched' };
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if page/browser is still open
        if (this.page.isClosed()) {
          return { success: false, error: 'Browser was closed' };
        }

        const needsLogin = await this.checkNeedsLogin();
        
        if (!needsLogin) {
          this.isAuthenticated = true;
          // Save session after successful login
          await this.saveSession();
          return { success: true };
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        // Browser might have been closed
        return { success: false, error: 'Browser was closed or became unresponsive' };
      }
    }

    return { success: false, error: 'Login timeout - user did not complete authentication' };
  }

  /**
   * Get current browser status
   */
  async getStatus(): Promise<SlackBrowserStatus> {
    if (!this.browser || !this.page) {
      return { isOpen: false, isLoggedIn: false };
    }

    const isLoggedIn = this.isAuthenticated && !(await this.checkNeedsLogin());
    
    // Try to get workspace name from page
    let workspaceName: string | undefined;
    try {
      const teamNameEl = await this.page.$('[data-qa="team-name"]');
      if (teamNameEl) {
        workspaceName = await teamNameEl.textContent() || undefined;
      }
    } catch {
      // Ignore errors getting workspace name
    }

    // Try to get current channel
    let currentChannel: string | undefined;
    try {
      const channelHeader = await this.page.$('[data-qa="channel_header_title"]');
      if (channelHeader) {
        currentChannel = await channelHeader.textContent() || undefined;
      }
    } catch {
      // Ignore errors
    }

    return {
      isOpen: true,
      isLoggedIn,
      currentChannel,
      workspaceUrl: this.workspaceUrl || undefined,
      workspaceName,
    };
  }

  /**
   * Get the current page (for extraction operations)
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Check if we're on a login/error page (for tools to detect session expiry)
   */
  async isOnLoginPage(): Promise<boolean> {
    return await this.checkNeedsLogin();
  }

  /**
   * Check if browser is ready for operations
   */
  isReady(): boolean {
    return this.browser !== null && this.page !== null && this.isAuthenticated;
  }

  /**
   * Navigate to a specific channel by ID or name
   */
  async navigateToChannel(channelIdOrName: string): Promise<{ success: boolean; error?: string }> {
    if (!this.page || !this.isAuthenticated) {
      return { success: false, error: 'Browser not ready or not authenticated' };
    }

    try {
      // If it looks like a channel ID (starts with C, D, or G), use direct URL
      if (/^[CDG][A-Z0-9]+$/i.test(channelIdOrName)) {
        // Get current URL to extract workspace ID
        const currentUrl = this.page.url();
        let workspaceId = '';
        
        // Try to extract workspace ID from current URL
        const clientMatch = currentUrl.match(/app\.slack\.com\/client\/([^/]+)/);
        if (clientMatch) {
          workspaceId = clientMatch[1];
          const channelUrl = `https://app.slack.com/client/${workspaceId}/${channelIdOrName}`;
          await this.page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(1500);
          return { success: true };
        }
        
        // Fallback: Try to construct from workspaceUrl if it looks like app.slack.com format
        if (this.workspaceUrl?.includes('app.slack.com/client/')) {
          const wsMatch = this.workspaceUrl.match(/app\.slack\.com\/client\/([^/]+)/);
          if (wsMatch) {
            workspaceId = wsMatch[1];
            const channelUrl = `https://app.slack.com/client/${workspaceId}/${channelIdOrName}`;
            await this.page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
            await this.page.waitForTimeout(1500);
            return { success: true };
          }
        }
        
        // Last resort: Use the old approach but with better URL handling
        const baseUrl = this.workspaceUrl?.replace(/\/$/, '') || 'https://app.slack.com';
        const cleanBase = baseUrl.replace(/\/client\/.*$/, '');
        const channelUrl = `${cleanBase}/client/${channelIdOrName}`;
        await this.page.goto(channelUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(1500);
        return { success: true };
      }

      // Otherwise, try to find and click the channel in sidebar
      // First, ensure sidebar is visible
      const sidebarChannel = await this.page.$(`[data-qa-channel-sidebar-channel-type="channel"][data-qa-channel-sidebar-channel-id] >> text="${channelIdOrName}"`);
      
      if (sidebarChannel) {
        await sidebarChannel.click();
        await this.page.waitForTimeout(1000);
        return { success: true };
      }

      return { success: false, error: `Channel "${channelIdOrName}" not found in sidebar` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error navigating to channel',
      };
    }
  }

  /**
   * Navigate directly to a Slack URL
   * Combines parsing + navigation for convenience
   */
  async navigateToSlackUrl(url: string): Promise<{
    success: boolean;
    parsed?: ParsedSlackUrl;
    error?: string;
  }> {
    if (!this.page || !this.isAuthenticated) {
      return {
        success: false,
        error: 'Browser not ready or not authenticated',
      };
    }

    const parsed = parseSlackUrl(url);
    
    if (!parsed || !parsed.channelId) {
      return {
        success: false,
        error: 'Could not parse Slack URL or extract channel ID',
      };
    }
    
    try {
      // For app.slack.com format, we need workspace ID
      if (parsed.workspaceId) {
        // URL is in app.slack.com/client/WORKSPACE/CHANNEL format
        const targetUrl = `https://app.slack.com/client/${parsed.workspaceId}/${parsed.channelId}`;
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForTimeout(1500);
        return { success: true, parsed };
      }
      
      // For workspace.slack.com/archives format, we need to get the workspace ID from current page
      if (parsed.workspaceDomain || parsed.channelId) {
        const currentUrl = this.page.url();
        let workspaceId = '';
        
        // Try to extract workspace ID from current URL
        const clientMatch = currentUrl.match(/app\.slack\.com\/client\/([^/]+)/);
        if (clientMatch) {
          workspaceId = clientMatch[1];
        } else {
          // Try from stored workspace URL
          const wsMatch = this.workspaceUrl?.match(/app\.slack\.com\/client\/([^/]+)/);
          if (wsMatch) {
            workspaceId = wsMatch[1];
          }
        }
        
        if (workspaceId) {
          // Navigate using app.slack.com format
          const targetUrl = `https://app.slack.com/client/${workspaceId}/${parsed.channelId}`;
          await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(1500);
          return { success: true, parsed };
        } else {
          // Fallback: Just navigate to the original URL and let Slack handle it
          await this.page.goto(url, { waitUntil: 'domcontentloaded' });
          await this.page.waitForTimeout(2000);
          return { success: true, parsed };
        }
      }
      
      // Fallback: use navigateToChannel (but this might have issues)
      const navResult = await this.navigateToChannel(parsed.channelId);
      
      if (!navResult.success) {
        return {
          success: false,
          parsed,
          error: navResult.error,
        };
      }
      
      return {
        success: true,
        parsed,
      };
    } catch (error) {
      return {
        success: false,
        parsed,
        error: error instanceof Error ? error.message : 'Failed to navigate to URL',
      };
    }
  }

  /**
   * Get accessibility tree snapshot for stable navigation
   * Note: Playwright moved accessibility to locator.ariaSnapshot() in newer versions
   * This method captures ARIA attributes from key elements instead
   */
  async getAccessibilityTree(): Promise<any> {
    if (!this.page) return null;
    
    try {
      // Capture ARIA info from key navigation elements
      return await this.page.evaluate(() => {
        function getAriaInfo(el: Element): any {
          const role = el.getAttribute('role');
          const label = el.getAttribute('aria-label');
          const name = el.textContent?.trim().substring(0, 100);
          const children: any[] = [];
          
          for (const child of el.children) {
            const childInfo = getAriaInfo(child);
            if (childInfo.role || childInfo.label || (childInfo.children && childInfo.children.length > 0)) {
              children.push(childInfo);
            }
          }
          
          return { role, name, label, children: children.length > 0 ? children : undefined };
        }
        
        // Focus on navigation and list elements
        const nav = document.querySelector('nav, [role="navigation"], [data-qa="channel_sidebar"]');
        if (nav) return getAriaInfo(nav);
        
        // Fallback to body
        return getAriaInfo(document.body);
      });
    } catch {
      return null;
    }
  }

  /**
   * Get HTML content of specific regions for LLM extraction
   * Returns all matching elements joined together
   */
  async getDOMChunks(selector: string): Promise<string | null> {
    if (!this.page) return null;

    try {
      const elements = await this.page.$$(selector);
      if (elements.length === 0) return null;
      
      const chunks = await Promise.all(elements.map(el => el.innerHTML()));
      return chunks.join('\n<!-- chunk separator -->\n');
    } catch {
      return null;
    }
  }

  /**
   * Get HTML content of a specific region for LLM extraction
   */
  async getDOMChunk(selector: string): Promise<string | null> {
    return this.getDOMChunks(selector);
  }

  /**
   * Get the entire page HTML (be careful - can be large)
   */
  async getPageHTML(): Promise<string | null> {
    if (!this.page) return null;

    try {
      return await this.page.content();
    } catch {
      return null;
    }
  }

  /**
   * Close browser and cleanup
   * Note: When using user's browser, this closes the automated window but not their whole browser
   */
  async close(): Promise<void> {
    try {
      // For persistent context (user's browser), just close the context
      // This closes the automated tabs but keeps Chrome running
      if (this.context) {
        await this.context.close();
        this.context = null;
        this.page = null;
      }
      // For standalone browser (fallback mode)
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      this.isAuthenticated = false;
      this.workspaceUrl = null;
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Save session cookies for later reuse
   */
  private async saveSession(): Promise<void> {
    if (!this.context || !this.workspaceUrl) return;

    try {
      ensureConfigDir();
      const cookies = await this.context.cookies();
      const session: SlackSession = {
        cookies: cookies as SlackSession['cookies'],
        workspaceUrl: this.workspaceUrl,
        savedAt: new Date().toISOString(),
      };
      writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Load saved session
   */
  private loadSession(): SlackSession | null {
    try {
      if (!existsSync(SESSION_FILE)) return null;
      const data = readFileSync(SESSION_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Save workspace config
   */
  saveConfig(config: SlackConfig): void {
    try {
      ensureConfigDir();
      writeFileSync(SLACK_CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Load workspace config
   */
  loadConfig(): SlackConfig {
    try {
      if (!existsSync(SLACK_CONFIG_FILE)) return {};
      const data = readFileSync(SLACK_CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
}

// Export singleton instance
export const slackBrowser = new SlackBrowserManager();

// Export types
export type { SlackSession, SlackConfig };

/**
 * Parse a Slack URL and extract its components
 * 
 * Supported formats:
 * - https://app.slack.com/client/T123WORKSPACE/C456CHANNEL
 * - https://workspace.slack.com/archives/C456CHANNEL/p1234567890123456
 * - https://workspace.slack.com/archives/C456CHANNEL/p1234567890123456?thread_ts=1234567890.123456
 */
export function parseSlackUrl(url: string): ParsedSlackUrl | null {
  try {
    const urlObj = new URL(url);
    
    // Format 1: app.slack.com/client/WORKSPACE/CHANNEL
    const clientMatch = urlObj.pathname.match(/^\/client\/([^/]+)\/([^/]+)/);
    if (clientMatch) {
      return {
        type: 'channel',
        workspaceId: clientMatch[1],
        channelId: clientMatch[2],
      };
    }
    
    // Format 2: workspace.slack.com/archives/CHANNEL/pTIMESTAMP
    const archivesMatch = urlObj.pathname.match(/^\/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (archivesMatch) {
      const channelId = archivesMatch[1];
      const messageTs = convertSlackTimestamp(archivesMatch[2]);
      const threadTs = urlObj.searchParams.get('thread_ts');
      
      return {
        type: threadTs ? 'thread' : 'message',
        workspaceDomain: urlObj.hostname.replace('.slack.com', ''),
        channelId,
        messageTs,
        threadTs: threadTs || undefined,
      };
    }
    
    // Format 3: Just /archives/CHANNEL (no message)
    const channelOnlyMatch = urlObj.pathname.match(/^\/archives\/([A-Z0-9]+)\/?$/);
    if (channelOnlyMatch) {
      return {
        type: 'channel',
        workspaceDomain: urlObj.hostname.replace('.slack.com', ''),
        channelId: channelOnlyMatch[1],
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert Slack's p-style timestamp to standard timestamp
 * p1234567890123456 -> "1234567890.123456"
 */
function convertSlackTimestamp(pTimestamp: string): string {
  // pTIMESTAMP format: p followed by Unix timestamp + microseconds
  // Example: p1234567890123456 = 1234567890.123456
  const numStr = pTimestamp;
  if (numStr.length >= 10) {
    const seconds = numStr.substring(0, 10);
    const micros = numStr.substring(10);
    return `${seconds}.${micros}`;
  }
  return numStr;
}

