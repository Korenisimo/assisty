// Slack Tools - Browser-based Slack access for the AI assistant
// Uses Playwright to scrape Slack web UI with LLM-powered extraction

import {
  slackBrowser,
  SlackChannel,
  SlackMessage,
  SlackBrowserStatus,
} from '../clients/slack.js';
import {
  extractChannels,
  extractMessages,
  extractCurrentChannel,
  isExtractorReady,
  scrollToLoadMore,
  scrollSidebar,
  searchForChannelAndGetResults,
  selectSearchResult,
  scrollToBottom,
  reactToMessage,
  replyToMessage,
  sendMessage,
  readThread,
  getMessageUrl,
  closeThreadPanel,
  debugScrollInfo,
  takeScreenshot,
} from '../clients/slack-extractor.js';

// Result types for tool responses
export interface SlackOpenResult {
  success: boolean;
  needsLogin: boolean;
  message: string;
  usingUserBrowser?: boolean;
  hint?: string;
  error?: string;
}

export interface SlackListChannelsResult {
  success: boolean;
  channels: SlackChannel[];
  error?: string;
}

export interface SlackReadMessagesResult {
  success: boolean;
  messages: SlackMessage[];
  channelName?: string;
  dateRange?: string;
  error?: string;
}

export interface SlackNavigateResult {
  success: boolean;
  channelName?: string;
  requestedChannel?: string;
  mismatch?: boolean;
  error?: string;
}

/**
 * Open Slack browser and navigate to workspace
 * If session exists, attempts to restore it
 * Returns whether login is needed
 */
export async function slackOpenBrowser(workspaceUrl: string): Promise<SlackOpenResult> {
  // Validate URL
  if (!workspaceUrl.includes('slack.com')) {
    return {
      success: false,
      needsLogin: false,
      message: 'Invalid Slack URL',
      error: 'URL must be a Slack workspace URL (e.g., https://yourcompany.slack.com or https://app.slack.com/client/T12345)',
    };
  }

  // Normalize URL to app.slack.com format if needed
  let normalizedUrl = workspaceUrl;
  if (workspaceUrl.match(/^https?:\/\/[\w-]+\.slack\.com\/?$/)) {
    // Convert workspace.slack.com to app.slack.com/client/WORKSPACE
    // We can't know the workspace ID, so just go to the URL and let Slack redirect
    normalizedUrl = workspaceUrl;
  }

  const result = await slackBrowser.launch(normalizedUrl);

  if (!result.success) {
    return {
      success: false,
      needsLogin: true,
      message: 'Failed to launch browser',
      error: result.error,
    };
  }

  const browserType = result.usingUserBrowser 
    ? 'your Chrome browser (with existing sessions)' 
    : 'a new browser window';

  if (result.needsLogin) {
    let message = `Opened ${browserType}. Please sign in to Slack in the browser window. Use slack_wait_for_login when ready.`;
    if (result.hint) {
      message += `\n\n${result.hint}`;
    }
    return {
      success: true,
      needsLogin: true,
      usingUserBrowser: result.usingUserBrowser,
      hint: result.hint,
      message,
    };
  }

  // Save workspace config for future use
  slackBrowser.saveConfig({ workspaceUrl: normalizedUrl, lastWorkspace: normalizedUrl });

  return {
    success: true,
    needsLogin: false,
    usingUserBrowser: result.usingUserBrowser,
    message: result.usingUserBrowser 
      ? 'Connected to Slack using your Chrome browser. Already logged in!' 
      : 'Connected to Slack workspace. Session restored from previous login.',
  };
}

/**
 * Wait for user to complete Slack login
 * Call this after slack_open_browser if login is needed
 */
export async function slackWaitForLogin(timeoutMinutes: number = 5): Promise<SlackOpenResult> {
  const result = await slackBrowser.waitForLogin(timeoutMinutes * 60 * 1000);

  if (!result.success) {
    return {
      success: false,
      needsLogin: true,
      message: 'Login not completed',
      error: result.error,
    };
  }

  // Get workspace info
  const status = await slackBrowser.getStatus();

  return {
    success: true,
    needsLogin: false,
    message: `Successfully logged in to Slack${status.workspaceName ? ` (${status.workspaceName})` : ''}. Ready to browse.`,
  };
}

/**
 * Get current Slack browser status
 */
export async function slackGetStatus(): Promise<SlackBrowserStatus> {
  return await slackBrowser.getStatus();
}

/**
 * List all visible channels/conversations in Slack sidebar
 */
export async function slackListChannels(): Promise<SlackListChannelsResult> {
  if (!isExtractorReady()) {
    return {
      success: false,
      channels: [],
      error: 'Slack browser not ready. Use slack_open_browser first.',
    };
  }

  const result = await extractChannels();

  if (result.error) {
    return {
      success: false,
      channels: [],
      error: result.error,
    };
  }

  return {
    success: true,
    channels: result.channels,
  };
}

/**
 * Navigate to a specific channel by name or ID
 */
export async function slackNavigateChannel(channelIdOrName: string): Promise<SlackNavigateResult> {
  if (!isExtractorReady()) {
    return {
      success: false,
      error: 'Slack browser not ready. Use slack_open_browser first.',
    };
  }

  const result = await slackBrowser.navigateToChannel(channelIdOrName);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  // Get the current channel name
  const channelInfo = await extractCurrentChannel();

  return {
    success: true,
    channelName: channelInfo?.name || channelIdOrName,
  };
}

/**
 * Read messages from current channel
 */
export async function slackReadMessages(limit: number = 20): Promise<SlackReadMessagesResult> {
  if (!isExtractorReady()) {
    return {
      success: false,
      messages: [],
      error: 'Slack browser not ready. Use slack_open_browser first.',
    };
  }

  // Check if we're on a login page (session expired or failed navigation)
  const onLoginPage = await slackBrowser.isOnLoginPage();
  if (onLoginPage) {
    return {
      success: false,
      messages: [],
      error: 'Slack session expired or navigation failed. You are on the login page. Please use slack_open_browser again and complete login.',
    };
  }

  // Get current channel name
  const channelInfo = await extractCurrentChannel();
  
  // Extract messages
  const result = await extractMessages(limit);

  if (result.error) {
    return {
      success: false,
      messages: [],
      error: result.error,
    };
  }

  // Calculate date range for context
  let dateRange: string | undefined;
  if (result.messages.length > 0) {
    const first = result.messages[0].timestamp;
    const last = result.messages[result.messages.length - 1].timestamp;
    dateRange = `${first} to ${last}`;
  }

  return {
    success: true,
    messages: result.messages,
    channelName: channelInfo?.name,
    dateRange,
  };
}

/**
 * Close the Slack browser
 */
export async function slackCloseBrowser(): Promise<{ success: boolean; message: string }> {
  await slackBrowser.close();
  return {
    success: true,
    message: 'Slack browser closed.',
  };
}

/**
 * Check if Slack browser is configured with a saved workspace
 */
export function getSlackConfig(): { configured: boolean; workspaceUrl?: string } {
  const config = slackBrowser.loadConfig();
  return {
    configured: !!config.workspaceUrl,
    workspaceUrl: config.workspaceUrl,
  };
}

/**
 * Quick open - open last used workspace or provided URL
 */
export async function slackQuickOpen(workspaceUrl?: string): Promise<SlackOpenResult> {
  const config = slackBrowser.loadConfig();
  const url = workspaceUrl || config.lastWorkspace;

  if (!url) {
    return {
      success: false,
      needsLogin: false,
      message: 'No workspace URL provided and no previous workspace saved',
      error: 'Please provide a Slack workspace URL',
    };
  }

  return await slackOpenBrowser(url);
}

/**
 * Scroll in the message area to load older/newer messages
 * Uses keyboard shortcuts for more reliable scrolling with virtual lists
 */
export async function slackScrollMessages(direction: 'up' | 'down' = 'up'): Promise<{ 
  success: boolean; 
  scrolled?: boolean;
  error?: string 
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const result = await scrollToLoadMore(direction);
  return { 
    success: result.success, 
    scrolled: result.scrolled,
    error: result.error 
  };
}

/**
 * Scroll to the very bottom of the message area
 */
export async function slackScrollToBottom(): Promise<{ success: boolean; error?: string }> {
  if (!isExtractorReady()) {
    return { success: true, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const result = await scrollToBottom();
  return { 
    success: result,
    error: result ? undefined : 'Failed to scroll to bottom' 
  };
}

/**
 * Scroll the sidebar to find more channels
 */
export async function slackScrollSidebar(direction: 'up' | 'down' = 'down'): Promise<{ success: boolean; error?: string }> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const result = await scrollSidebar(direction);
  return { 
    success: result, 
    error: result ? undefined : 'Failed to scroll sidebar' 
  };
}

/**
 * Search for channels/DMs and get all results for the agent to choose from
 * Lets the LLM see what's available and decide which result to select
 */
export async function slackSearchChannelGetResults(searchQuery: string, pressEnter: boolean = false): Promise<{
  success: boolean;
  results: Array<{
    index: number;
    text: string;
    fullText: string;
    type: 'channel' | 'dm' | 'unknown';
  }>;
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, results: [], error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  return await searchForChannelAndGetResults(searchQuery, pressEnter);
}

/**
 * Select a search result by index (call after slackSearchChannelGetResults)
 */
export async function slackSelectSearchResult(index: number): Promise<{
  success: boolean;
  navigatedTo?: string;
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  return await selectSearchResult(index);
}

/**
 * React to a message with an emoji
 */
export async function slackReactToMessage(messageIndex: number, emoji: string): Promise<{ success: boolean; error?: string }> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  return await reactToMessage(messageIndex, emoji);
}

/**
 * Reply to a message in a thread
 */
export async function slackReplyToMessage(messageIndex: number, replyText: string): Promise<{ success: boolean; error?: string }> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  // Always add AI disclaimer to thread replies
  return await replyToMessage(messageIndex, replyText, { skipDisclaimer: false });
}

/**
 * Send a message to the current channel/DM
 */
export async function slackSendMessage(text: string): Promise<{ success: boolean; error?: string }> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  // Check if we're on a login page
  const onLoginPage = await slackBrowser.isOnLoginPage();
  if (onLoginPage) {
    return {
      success: false,
      error: 'Slack session expired. You are on the login page. Please use slack_open_browser again.',
    };
  }

  // Always add AI disclaimer to channel messages
  return await sendMessage(text, { skipDisclaimer: false });
}

/**
 * Read a thread's messages (parent + all replies)
 */
export async function slackReadThread(messageIndex: number): Promise<{ 
  success: boolean; 
  messages: SlackMessage[]; 
  threadUrl?: string;
  error?: string 
}> {
  if (!isExtractorReady()) {
    return { success: false, messages: [], error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  // Check if we're on a login page
  const onLoginPage = await slackBrowser.isOnLoginPage();
  if (onLoginPage) {
    return {
      success: false,
      messages: [],
      error: 'Slack session expired. You are on the login page. Please use slack_open_browser again.',
    };
  }

  const result = await readThread(messageIndex);
  
  return {
    success: !result.error || result.messages.length > 0,
    messages: result.messages,
    threadUrl: result.threadUrl,
    error: result.error,
  };
}

/**
 * Get the shareable URL for a message
 */
export async function slackGetMessageUrl(messageIndex: number): Promise<{ success: boolean; url?: string; error?: string }> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const result = await getMessageUrl(messageIndex);
  
  return {
    success: !!result.url,
    url: result.url,
    error: result.error,
  };
}

/**
 * Close the thread panel if it's open
 */
export async function slackCloseThread(): Promise<{ success: boolean }> {
  if (!isExtractorReady()) {
    return { success: false };
  }

  const result = await closeThreadPanel();
  return { success: result };
}

/**
 * Debug tool to get scroll information
 */
export async function slackDebugScroll(): Promise<{
  success: boolean;
  info?: {
    url: string;
    scrollableElements: Array<{
      selector: string;
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      canScroll: boolean;
    }>;
    messagePaneFound: boolean;
    virtualListFound: boolean;
  };
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }
  
  return await debugScrollInfo();
}

/**
 * Debug tool to take a screenshot
 */
export async function slackTakeScreenshot(name?: string): Promise<{
  success: boolean;
  path?: string;
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }
  
  return await takeScreenshot(name);
}

/**
 * Navigate directly to a Slack URL (channel, message, or thread)
 * This is the fastest way to navigate when you have a link
 * 
 * Uses SlackBrowserManager's navigateToSlackUrl which automatically converts
 * workspace.slack.com/archives URLs to app.slack.com/client format
 */
export async function slackNavigateToUrl(url: string): Promise<{
  success: boolean;
  channelId?: string;
  messageTs?: string;
  type?: string;
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const page = slackBrowser.getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    // Use the SlackBrowserManager's navigateToSlackUrl method
    // It handles converting workspace.slack.com URLs to app.slack.com format
    const result = await slackBrowser.navigateToSlackUrl(url);
    
    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to navigate to URL',
      };
    }

    // Check if navigation resulted in login page
    const onLoginPage = await slackBrowser.isOnLoginPage();
    if (onLoginPage) {
      return {
        success: false,
        error: 'Navigation redirected to login page. Slack session may have expired. Please use slack_open_browser again.',
      };
    }
    
    // Check if navigation resulted in an unsupported browser page
    const pageContent = await page.content();
    if (pageContent.includes('This browser is no longer supported') || 
        pageContent.includes('browser is no longer supported')) {
      return {
        success: false,
        error: 'Slack says browser is unsupported. The workspace.slack.com URL format may not work. Try converting to app.slack.com format or use a different browser.',
      };
    }
    
    // Check if navigation resulted in an app-forcing page
    const finalUrl = page.url();
    if (finalUrl.includes('app_redirect') || finalUrl.includes('slack://')) {
      return {
        success: false,
        error: 'URL forces app opening. Could not convert to web version. Try using a different Slack URL format.',
      };
    }

    return {
      success: true,
      channelId: result.parsed?.channelId,
      messageTs: result.parsed?.messageTs,
      type: result.parsed?.type,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to navigate to URL',
    };
  }
}

/**
 * Query Slack AI with a question
 * Returns AI answer and any reference links
 */
export async function slackQueryAI(question: string): Promise<{
  success: boolean;
  answer?: string;
  references?: Array<{ title: string; url: string }>;
  error?: string;
}> {
  if (!isExtractorReady()) {
    return { success: false, error: 'Slack browser not ready. Use slack_open_browser first.' };
  }

  const { querySlackAI } = await import('../clients/slack-extractor.js');
  return await querySlackAI(question);
}

