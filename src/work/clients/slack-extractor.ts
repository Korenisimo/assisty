// Slack Extractor - LLM-powered DOM extraction for Slack web UI
// Uses a hybrid approach: accessibility tree for navigation + LLM for content extraction

import { GoogleGenerativeAI } from '@google/generative-ai';
import { slackBrowser, SlackChannel, SlackMessage } from './slack.js';
import { slackCache, CacheKeys, CacheTTL } from './slack-cache.js';

// Initialize Gemini for extraction
let genAI: GoogleGenerativeAI | null = null;

// Abort controller for interrupting long-running operations
let globalAbortController: AbortController | null = null;

export function setSlackAbortController(controller: AbortController | null): void {
  globalAbortController = controller;
}

export function isSlackAborted(): boolean {
  return globalAbortController?.signal.aborted || false;
}

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment. Required for Slack extraction.');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Clean HTML to reduce noise for LLM extraction
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '') // Remove SVGs
    .replace(/<style[\s\S]*?<\/style>/g, '') // Remove styles
    .replace(/<script[\s\S]*?<\/script>/g, '') // Remove scripts
    .replace(/\s+/g, ' ') // Collapse whitespace
    .replace(/class="[\s\S]*?"/g, (match) => {
      // Keep some potentially useful classes
      if (match.includes('c-message') || match.includes('sender') || match.includes('timestamp')) {
        return match;
      }
      return '';
    })
    .replace(/data-[\w-]+="[\s\S]*?"/g, (match) => {
      // Keep important data attributes for message identification
      if (match.includes('data-qa="message_sender"') || 
          match.includes('data-qa="message_content"') ||
          match.includes('data-qa="message_container"') ||
          match.includes('data-qa="virtual-list-item"') ||
          match.includes('data-qa="message_timestamp"') ||
          match.includes('data-message-id')) {
        return match;
      }
      return '';
    })
    .trim();
}

/**
 * Extract structured data from HTML using LLM
 */
async function llmExtract<T>(html: string, prompt: string): Promise<T | null> {
  try {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent extraction
      },
    });

    const cleanedHtml = cleanHtml(html);
    const fullPrompt = `${prompt}

HTML Content:
\`\`\`html
${cleanedHtml.substring(0, 150000)} ${cleanedHtml.length > 150000 ? '... (truncated)' : ''}
\`\`\`

IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code blocks.`;

    const result = await model.generateContent(fullPrompt);
    const response = result.response.text().trim();

    // Clean up response (remove any markdown artifacts)
    let cleanJson = response;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    return JSON.parse(cleanJson) as T;
  } catch (error) {
    console.error('LLM extraction failed:', error);
    return null;
  }
}

/**
 * Parse accessibility tree to find channels
 * The accessibility tree is more stable than CSS selectors
 */
function parseAccessibilityTreeForChannels(tree: any): SlackChannel[] {
  const channels: SlackChannel[] = [];
  
  function traverse(node: any, depth: number = 0): void {
    if (!node) return;

    // Look for list items that represent channels
    // Slack uses role="treeitem" or similar for channel items
    if (node.role === 'treeitem' || node.role === 'listitem' || node.role === 'link') {
      const name = node.name?.trim();
      if (name && name.length > 0 && name.length < 100) {
        // Try to determine channel type from context
        let type: 'channel' | 'dm' | 'group' = 'channel';
        if (name.includes(' (DM)') || node.description?.includes('direct message')) {
          type = 'dm';
        } else if (name.includes(' (group)')) {
          type = 'group';
        }

        // Check for unread indicator
        const unread = node.name?.includes('unread') || 
                       node.description?.includes('unread') ||
                       (node.children?.some((c: any) => c.name?.includes('unread')));

        channels.push({
          name: name.replace(/\s*\(unread\).*$/i, '').replace(/^#\s*/, '').trim(),
          id: '', // Will be filled by LLM if needed
          unread: !!unread,
          type,
        });
      }
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(tree);
  
  // Deduplicate by name
  const seen = new Set<string>();
  return channels.filter(ch => {
    if (seen.has(ch.name.toLowerCase())) return false;
    seen.add(ch.name.toLowerCase());
    return true;
  });
}

/**
 * Extract channels from Slack sidebar
 * Uses hybrid approach: try accessibility tree first, fall back to LLM
 */
export async function extractChannels(): Promise<{ channels: SlackChannel[]; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) {
    return { channels: [], error: 'Browser not ready' };
  }

  // Try accessibility tree first (more stable)
  const a11yTree = await slackBrowser.getAccessibilityTree();
  if (a11yTree) {
    const channels = parseAccessibilityTreeForChannels(a11yTree);
    if (channels.length > 0) {
      // Use LLM to enrich with IDs if we have partial data
      return { channels };
    }
  }

  // Fall back to LLM extraction from sidebar HTML
  const sidebarSelectors = [
    '[data-qa="channel_sidebar"]',
    '[data-qa="slack_kit_list"]',
    '.p-channel_sidebar',
    '[role="navigation"]',
    'nav',
  ];

  let sidebarHtml: string | null = null;
  for (const selector of sidebarSelectors) {
    sidebarHtml = await slackBrowser.getDOMChunk(selector);
    if (sidebarHtml && sidebarHtml.length > 100) break;
  }

  if (!sidebarHtml) {
    // Last resort: get full page and let LLM find the sidebar
    sidebarHtml = await slackBrowser.getPageHTML();
  }

  if (!sidebarHtml) {
    return { channels: [], error: 'Could not extract sidebar HTML' };
  }

  const extractionPrompt = `Extract all Slack channels from this sidebar HTML.

For each channel, extract:
- name: The channel name (without # prefix)
- id: The channel ID if visible in data attributes (look for data-qa-channel-sidebar-channel-id or similar), otherwise empty string
- unread: true if channel has unread messages indicator
- type: "channel" for public channels, "dm" for direct messages, "group" for group DMs

Return a JSON array of channels:
[{"name": "general", "id": "C123ABC", "unread": false, "type": "channel"}, ...]

Only include actual channels/conversations, not section headers or UI elements.`;

  const extracted = await llmExtract<SlackChannel[]>(sidebarHtml, extractionPrompt);
  
  if (extracted && Array.isArray(extracted)) {
    return { channels: extracted };
  }

  return { channels: [], error: 'LLM extraction failed' };
}

/**
 * Extract messages from current channel view
 * Always uses LLM due to complex message structure
 */
export async function extractMessages(limit: number = 20): Promise<{ messages: SlackMessage[]; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) {
    return { messages: [], error: 'Browser not ready' };
  }

  // Generate cache key based on current URL and scroll position
  try {
    const currentUrl = page.url();
    const scrollPosition = await page.evaluate(() => {
      const messagesContainer = document.querySelector('[data-qa="slack_kit_list"]');
      return messagesContainer ? messagesContainer.scrollTop : 0;
    });
    
    // Use new cache structure
    const channelId = currentUrl.split('/').pop() || 'unknown';
    const cacheKey = CacheKeys.messages(channelId, Math.floor(scrollPosition / 100));

    // Check cache first
    const cached = slackCache.get<{ messages: SlackMessage[]; error?: string }>(cacheKey, CacheTTL.messages);
    if (cached) {
      return cached;
    }

    // Not in cache, extract from DOM
    const result = await _extractMessagesUncached(limit);
    
    // Cache the result
    slackCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    // If caching fails, fall back to uncached extraction
    return await _extractMessagesUncached(limit);
  }
}

/**
 * Internal function that actually extracts messages (no caching)
 */
async function _extractMessagesUncached(limit: number = 20): Promise<{ messages: SlackMessage[]; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) {
    return { messages: [], error: 'Browser not ready' };
  }

  // Try to get individual message elements first (more accurate than container)
  const individualSelectors = [
    '[data-qa="virtual-list-item"]',
    '.c-message_kit__background',
    '.c-message',
    '[role="listitem"]',
  ];

  let messagesHtml: string | null = null;
  for (const selector of individualSelectors) {
    messagesHtml = await slackBrowser.getDOMChunks(selector);
    if (messagesHtml && messagesHtml.length > 500) break;
  }

  if (!messagesHtml) {
    // Fall back to containers if individual items not found
    const containerSelectors = [
      '.c-virtual_list__scroll_container',
      '[role="list"]',
      '[data-qa="slack_kit_list"]',
      '.p-message_pane__foreground',
      '[data-qa="message_container"]',
    ];

    for (const selector of containerSelectors) {
      messagesHtml = await slackBrowser.getDOMChunks(selector);
      if (messagesHtml && messagesHtml.length > 500) break;
    }
  }

  if (!messagesHtml) {
    // Try main content area
    const mainSelectors = [
      '[data-qa="message_pane"]',
      '.p-workspace__primary_view',
      'main',
    ];
    
    for (const selector of mainSelectors) {
      messagesHtml = await slackBrowser.getDOMChunks(selector);
      if (messagesHtml && messagesHtml.length > 500) break;
    }
  }

  if (!messagesHtml) {
    // Last resort: evaluate everything in pane
    messagesHtml = await page.evaluate(() => {
      const pane = document.querySelector('[data-qa="message_pane"]') || document.querySelector('.p-workspace__primary_view');
      return pane ? pane.innerHTML : null;
    });
  }

  if (!messagesHtml) {
    return { messages: [], error: 'Could not find any message elements' };
  }

  const extractionPrompt = `Extract ALL Slack messages from the provided HTML, up to ${limit} messages.

For each message, find:
- author: The sender's name (look for "data-qa='message_sender'", "c-message__sender", or text near avatars)
- timestamp: The time/date (look for "data-qa='message_timestamp'", "aria-label" on time elements, or small text)
- content: The FULL message text (capture ALL lines, links, and @mentions)
- threadReplies: Number of replies if it's a thread (look for "reply", "replies", or count numbers)
- reactions: Array of emoji names present on the message
- links: Array of ALL URLs/links in the message, with this structure:
  [{"url": "full URL", "text": "link text if visible", "isSlackLink": true/false}]

IMPORTANT FOR LINKS:
1. Extract ALL <a href="..."> URLs from the message HTML
2. Mark Slack URLs (containing slack.com, /archives/, /client/) with isSlackLink: true
3. Include both the href URL and any visible link text
4. If no links in message, use empty array []

Important:
1. Each distinct message block (usually marked by "data-qa='virtual-list-item'") should be a separate entry.
2. Order them from OLDEST to NEWEST (top to bottom in the HTML).
3. Capture the full text even if it's long.
4. Include system messages and bot summaries (like "Ask Engineering").

Return a JSON array of message objects:
[{"author": "Name", "timestamp": "time", "content": "text", "threadReplies": 0, "reactions": [], "links": [{"url": "https://...", "text": "...", "isSlackLink": true}]}, ...]`;

  const extracted = await llmExtract<SlackMessage[]>(messagesHtml, extractionPrompt);

  if (extracted && Array.isArray(extracted)) {
    return { messages: extracted.slice(-limit) };
  }

  return { messages: [], error: 'LLM extraction failed' };
}

/**
 * Extract current channel/conversation info
 */
export async function extractCurrentChannel(): Promise<{ name: string; description?: string } | null> {
  const page = slackBrowser.getPage();
  if (!page) return null;

  // Try to get channel header
  const headerSelectors = [
    '[data-qa="channel_header"]',
    '.p-channel_header',
    'header',
  ];

  let headerHtml: string | null = null;
  for (const selector of headerSelectors) {
    headerHtml = await slackBrowser.getDOMChunk(selector);
    if (headerHtml && headerHtml.length > 50) break;
  }

  if (!headerHtml) return null;

  const extractionPrompt = `Extract the current channel/conversation info from this Slack header HTML.

Return a JSON object with:
- name: The channel name (without # prefix)
- description: The channel description/topic if visible, otherwise null

Example: {"name": "general", "description": "Company-wide announcements"}`;

  return await llmExtract<{ name: string; description?: string }>(headerHtml, extractionPrompt);
}

/**
 * Find a channel in the sidebar and get its clickable element info
 */
export async function findChannelElement(channelName: string): Promise<{ found: boolean; selector?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { found: false };

  // Try common selectors for channel items
  const selectors = [
    `[data-qa-channel-sidebar-channel-type="channel"] >> text="${channelName}"`,
    `[data-qa="channel_sidebar_name_${channelName}"]`,
    `[aria-label*="${channelName}"]`,
    `button:has-text("${channelName}")`,
    `a:has-text("${channelName}")`,
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        return { found: true, selector };
      }
    } catch {
      // Try next selector
    }
  }

  return { found: false };
}

/**
 * Scroll to load more messages (for infinite scroll)
 * Uses Playwright's native locator-based scrolling
 */
export async function scrollToLoadMore(direction: 'up' | 'down' = 'up'): Promise<{ 
  success: boolean; 
  scrolled: boolean;
  error?: string 
}> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, scrolled: false, error: 'Browser not ready' };

  try {
    // First, click somewhere in the message area to ensure it has focus
    // Use the message pane but avoid clicking on actual messages
    const messagePane = page.locator('[data-qa="message_pane"]').first();
    
    if (await messagePane.count() > 0) {
      // Get the bounding box and click near the top/bottom edge (not on messages)
      const box = await messagePane.boundingBox();
      if (box) {
        // Click on the edge of the message pane to give it focus without clicking a message
        const clickY = direction === 'up' ? box.y + 50 : box.y + box.height - 50;
        await page.mouse.click(box.x + box.width - 30, clickY);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    // Use keyboard scrolling - this is the most reliable method in Slack
    // For incremental scroll, we use a single PageUp/Down or several Arrow keys
    // This prevents "scrolling past" content too quickly
    const keys = direction === 'up' 
      ? ['PageUp', 'ArrowUp', 'ArrowUp', 'ArrowUp']
      : ['PageDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'];
    
    for (const key of keys) {
      await page.keyboard.press(key);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Wait for Slack to load content
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Also try mouse wheel as backup with a moderate delta
    const box = await messagePane.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const wheelDelta = direction === 'up' ? -800 : 800;
      await page.mouse.wheel(0, wheelDelta);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return { success: true, scrolled: true };
  } catch (error) {
    return { 
      success: false, 
      scrolled: false, 
      error: error instanceof Error ? error.message : 'Failed to scroll'
    };
  }
}

/**
 * Scroll to the very bottom of the current channel
 */
export async function scrollToBottom(): Promise<boolean> {
  const page = slackBrowser.getPage();
  if (!page) return false;

  try {
    const messagePane = page.locator('[data-qa="message_pane"]').first();
    if (await messagePane.count() > 0) {
      const box = await messagePane.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width - 30, box.y + box.height - 50);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Press End key multiple times (some Slack versions need it)
    await page.keyboard.press('End');
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.keyboard.press('End');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Also try scrolling the container directly
    await page.evaluate(() => {
      const selectors = ['.c-virtual_list__scroll_container', '[data-qa="message_pane"]', '.p-message_pane__foreground'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    return true;
  } catch {
    return false;
  }
}

/**
 * Scroll sidebar to find more channels
 * Uses Playwright's native locator-based scrolling
 */
export async function scrollSidebar(direction: 'up' | 'down' = 'down'): Promise<boolean> {
  const page = slackBrowser.getPage();
  if (!page) return false;

  try {
    // Find the sidebar using Playwright locators
    const sidebar = page.locator('[data-qa="channel_sidebar_sections_and_டிஎம்s"]')
      .or(page.locator('.p-channel_sidebar__list'))
      .or(page.locator('[data-qa="channel_sidebar"]'))
      .first();
    
    // Click on the sidebar to give it focus
    if (await sidebar.count() > 0) {
      const box = await sidebar.boundingBox();
      if (box) {
        // Click in the sidebar area
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Use mouse wheel to scroll the sidebar
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const wheelDelta = direction === 'up' ? -600 : 600;
        
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(0, wheelDelta);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        await new Promise(resolve => setTimeout(resolve, 800));
        return true;
      }
    }
    
    // Fallback: try keyboard navigation after clicking somewhere in sidebar
    const anyChannel = page.locator('[data-qa="channel_sidebar_name_"]').first();
    if (await anyChannel.count() > 0) {
      await anyChannel.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Use keyboard to scroll
      const keys = direction === 'up' 
        ? ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'PageUp']
        : ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'PageDown'];
      
      for (const key of keys) {
        await page.keyboard.press(key);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Search for channels/DMs and return all visible results for the agent to choose from
 * This is much better than trying to do exact string matching - let the LLM decide!
 */
export async function searchForChannelAndGetResults(searchQuery: string, pressEnter: boolean = false): Promise<{
  success: boolean;
  results: Array<{
    index: number;
    text: string;
    fullText: string;
    type: 'channel' | 'dm' | 'unknown';
  }>;
  error?: string;
}> {
  // Check cache first
  const cacheKey = CacheKeys.search(searchQuery, pressEnter);
  const cached = slackCache.get<ReturnType<typeof searchForChannelAndGetResults>>(cacheKey, CacheTTL.search);
  if (cached) {
    return cached;
  }

  const page = slackBrowser.getPage();
  if (!page) return { success: false, results: [], error: 'Browser not ready' };

  try {
    // Open the channel switcher with Cmd+K
    await page.keyboard.press('Meta+k');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Type the search query
    await page.keyboard.type(searchQuery, { delay: 50 });
    await new Promise(resolve => setTimeout(resolve, 1500));

    // If pressEnter is true, submit the search to get full results
    if (pressEnter) {
      await page.keyboard.press('Enter');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for full search results to load
    }

    // Extract ALL visible results
    const resultSelectors = [
      '[data-qa="search_result_item"]',
      '[data-qa="channel_browser_result_item"]',
      '[role="option"]',
      '.c-search_autocomplete__suggestion',
      // Additional selectors for full search results page
      '[data-qa="search_message_result"]',
      '[data-qa="search_channel_result"]',
      '.c-search_modal__result_section',
    ];

    const results: Array<{
      index: number;
      text: string;
      fullText: string;
      type: 'channel' | 'dm' | 'unknown';
    }> = [];

    // Try each selector to find results
    for (const selector of resultSelectors) {
      const elements = await page.$$(selector);
      
      if (elements.length > 0) {
        // Extract text from each result
        for (let i = 0; i < Math.min(elements.length, pressEnter ? 20 : 10); i++) {
          const element = elements[i];
          
          // Get text content
          const fullText = await element.textContent() || '';
          const innerText = await element.evaluate(el => (el as HTMLElement).innerText || '');
          
          const textToUse = (innerText || fullText).trim();
          
          // Try to determine if it's a channel or DM
          let type: 'channel' | 'dm' | 'unknown' = 'unknown';
          if (textToUse.startsWith('#')) {
            type = 'channel';
          } else if (textToUse.match(/[A-Z][a-z]+ [A-Z][a-z]+/)) {
            // Looks like a person name (Capital First Capital Last)
            type = 'dm';
          }
          
          results.push({
            index: i,
            text: textToUse,
            fullText: textToUse,
            type,
          });
        }
        break; // Found results with this selector, stop trying others
      }
    }

    if (results.length === 0) {
      await page.keyboard.press('Escape');
      return {
        success: false,
        results: [],
        error: `No results found for "${searchQuery}". ${pressEnter ? 'Full search returned no results.' : 'Try with pressEnter: true for full search results.'}`,
      };
    }

    // Keep the search dialog open - agent will call select_result next
    const result = {
      success: true,
      results,
    };
    
    // Cache the result
    slackCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    try { await page.keyboard.press('Escape'); } catch {}
    return {
      success: false,
      results: [],
      error: error instanceof Error ? error.message : 'Failed to search',
    };
  }
}

/**
 * Select a search result by index (after searchForChannelAndGetResults)
 */
export async function selectSearchResult(index: number): Promise<{
  success: boolean;
  navigatedTo?: string;
  error?: string;
}> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    // Make sure we're still in the search dialog
    // If not, this function was called without searchForChannelAndGetResults
    const searchDialog = await page.$('[role="dialog"], [role="listbox"], .c-search_modal');
    if (!searchDialog) {
      return { 
        success: false, 
        error: 'Search dialog not found. Call slack_search_channel_get_results first.' 
      };
    }

    // The first item (index 0) is already highlighted by default in Slack
    // So we need to press ArrowDown 'index' times to reach the desired item
    // BUT: if index is 0, we don't need to move at all
    if (index > 0) {
      for (let i = 0; i < index; i++) {
        await page.keyboard.press('ArrowDown');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    // Wait a moment for the highlight to settle
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Press Enter to select
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify where we navigated to
    const channelInfo = await extractCurrentChannel();
    const navigatedTo = channelInfo?.name;

    return {
      success: true,
      navigatedTo,
    };
  } catch (error) {
    try { await page.keyboard.press('Escape'); } catch {}
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to select result',
    };
  }
}

/**
 * OLD FUNCTION - DEPRECATED - Use searchForChannelAndGetResults + selectSearchResult instead
 * Search for a channel OR DM by typing in Slack's search/jump dialog
 * Uses arrow key navigation to find the EXACT channel/DM match
 * Returns the actual channel/DM navigated to, which may differ from requested if no exact match found
 * 
 * IMPORTANT: For DMs, pass just the person's name (e.g., "John Doe"), NOT "#John Doe"
 *            For channels, pass the channel name without # (e.g., "general"), NOT "#general"
 */
/**
 * React to a message with an emoji
 */
export async function reactToMessage(messageIndex: number, emoji: string): Promise<{ success: boolean; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    // Find all messages
    const messages = await page.$$('[data-qa="message_container"] [data-qa="virtual-list-item"], .c-message_kit__background');
    
    if (messageIndex < 0 || messageIndex >= messages.length) {
      return { success: false, error: `Message index ${messageIndex} out of range (${messages.length} messages)` };
    }

    const message = messages[messageIndex];
    
    // Hover over the message to show the action toolbar
    await message.hover();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the "Add reaction" button (emoji icon)
    const reactionButton = await message.$('[data-qa="add_reaction"], [aria-label*="Add reaction"], button[data-qa="reaction-button"]');
    if (!reactionButton) {
      // Try the message actions toolbar
      const toolbar = await page.$('[data-qa="message_actions"], .c-message_actions__container');
      if (toolbar) {
        const addReaction = await toolbar.$('[aria-label*="reaction"], [data-qa="add_reaction"]');
        if (addReaction) {
          await addReaction.click();
        } else {
          return { success: false, error: 'Could not find reaction button' };
        }
      } else {
        return { success: false, error: 'Could not find message toolbar' };
      }
    } else {
      await reactionButton.click();
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Type the emoji name in the emoji picker search
    await page.keyboard.type(emoji, { delay: 30 });
    await new Promise(resolve => setTimeout(resolve, 500));

    // Press Enter to select the emoji
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 500));

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to react' };
  }
}

/**
 * Wrap a message with AI assistant disclaimer
 */
function wrapWithAIDisclaimer(text: string): string {
  const disclaimer = "🤖 *Hey! Koren's AI assistant here. I've looked into this, but I'm not perfect—double-check with Koren if you need to be sure.*\n\n";
  return disclaimer + text;
}

/**
 * Reply to a message in a thread
 */
export async function replyToMessage(messageIndex: number, replyText: string, options?: { skipDisclaimer?: boolean }): Promise<{ success: boolean; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    // Add AI disclaimer unless explicitly skipped
    const messageText = options?.skipDisclaimer ? replyText : wrapWithAIDisclaimer(replyText);
    // Find all messages
    const messages = await page.$$('[data-qa="message_container"] [data-qa="virtual-list-item"], .c-message_kit__background');
    
    if (messageIndex < 0 || messageIndex >= messages.length) {
      return { success: false, error: `Message index ${messageIndex} out of range (${messages.length} messages)` };
    }

    const message = messages[messageIndex];
    
    // Hover over the message to show the action toolbar
    await message.hover();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the "Reply in thread" button
    const threadButton = await message.$('[data-qa="start_thread"], [aria-label*="thread"], [aria-label*="Reply"]');
    if (!threadButton) {
      // Try finding it in the toolbar
      const toolbar = await page.$('[data-qa="message_actions"], .c-message_actions__container');
      if (toolbar) {
        const startThread = await toolbar.$('[aria-label*="thread"], [aria-label*="Reply"], [data-qa="start_thread"]');
        if (startThread) {
          await startThread.click();
        } else {
          return { success: false, error: 'Could not find reply button' };
        }
      } else {
        return { success: false, error: 'Could not find message toolbar' };
      }
    } else {
      await threadButton.click();
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Find the thread reply input - it should be in the thread panel (right side)
    // Try multiple selectors for the thread composer specifically
    const threadInputSelectors = [
      '[data-qa="message_pane_input_area"] [contenteditable="true"]',
      '.p-message_pane_input_area [contenteditable="true"]',
      '[aria-label*="Reply to thread"] [contenteditable="true"]',
      '.p-flexpane_header + div [contenteditable="true"]', // Thread panel content area
    ];
    
    let threadInput = null;
    for (const selector of threadInputSelectors) {
      threadInput = await page.$(selector);
      if (threadInput) break;
    }
    
    if (!threadInput) {
      return { success: false, error: 'Could not find thread reply input. Is the thread panel open?' };
    }

    await threadInput.click();
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Handle multi-line messages: replace \n with Shift+Enter
    const lines = messageText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      await page.keyboard.type(lines[i], { delay: 20 });
      if (i < lines.length - 1) {
        // Not the last line - press Shift+Enter for newline without sending
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
    }
    
    // Send the message with plain Enter
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 1000));

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to reply' };
  }
}

/**
 * Send a message to the current channel/DM
 */
export async function sendMessage(text: string, options?: { skipDisclaimer?: boolean }): Promise<{ success: boolean; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    // Add AI disclaimer unless explicitly skipped
    const messageText = options?.skipDisclaimer ? text : wrapWithAIDisclaimer(text);
    
    // Find the main message input (NOT the thread input)
    const input = await page.$('[data-qa="message_input"] [contenteditable="true"], .ql-editor[contenteditable="true"], [aria-label*="Message"] [contenteditable="true"]');
    if (!input) {
      return { success: false, error: 'Could not find message input' };
    }

    await input.click();
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Handle multi-line messages: replace \n with Shift+Enter
    const lines = messageText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      await page.keyboard.type(lines[i], { delay: 20 });
      if (i < lines.length - 1) {
        // Not the last line - press Shift+Enter for newline without sending
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
      }
    }
    
    // Send the message with plain Enter
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 1000));

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to send message' };
  }
}

/**
 * Open a thread and read its replies
 */
export async function readThread(messageIndex: number): Promise<{ messages: SlackMessage[]; threadUrl?: string; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { messages: [], error: 'Browser not ready' };

  try {
    // Find all messages
    const messageElements = await page.$$('[data-qa="virtual-list-item"], .c-message_kit__background, [data-qa="message_container"] > div');
    
    if (messageIndex < 0 || messageIndex >= messageElements.length) {
      return { messages: [], error: `Message index ${messageIndex} out of range (${messageElements.length} messages)` };
    }

    const message = messageElements[messageIndex];
    
    // Hover over the message to show the action toolbar
    await message.hover();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Look for "X replies" link or thread button
    const threadLink = await message.$('[data-qa="replies_button"], .c-message__reply_count, [aria-label*="thread"], [aria-label*="replies"], [aria-label*="Reply"]');
    
    if (threadLink) {
      await threadLink.click();
    } else {
      // Try clicking the message itself to open thread panel
      const replyButton = await page.$('[data-qa="message_actions"] [aria-label*="Reply"], [data-qa="start_thread"]');
      if (replyButton) {
        await replyButton.click();
      } else {
        return { messages: [], error: 'Could not find thread or reply button' };
      }
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Now extract messages from the thread panel
    const threadPanelSelectors = [
      '[data-qa="thread_view"]',
      '.p-flexpane__inside_body',
      '[data-qa="slack_kit_list"]',
    ];

    let threadHtml: string | null = null;
    for (const selector of threadPanelSelectors) {
      threadHtml = await slackBrowser.getDOMChunk(selector);
      if (threadHtml && threadHtml.length > 200) break;
    }

    if (!threadHtml) {
      return { messages: [], error: 'Could not find thread panel' };
    }

    // Get the thread URL from the browser
    const currentUrl = page.url();
    
    // Extract messages using LLM
    const extractionPrompt = `Extract all messages from this Slack thread HTML.

For each message, extract:
- author: The username/display name of the message sender
- timestamp: The timestamp (can be relative like "2:30 PM" or "yesterday")  
- content: The message text content
- threadReplies: 0 (these are already thread replies)
- reactions: Array of reaction emoji names if any
- links: Array of ALL URLs/links in the message, with this structure:
  [{"url": "full URL", "text": "link text if visible", "isSlackLink": true/false}]

IMPORTANT FOR LINKS:
1. Extract ALL <a href="..."> URLs from the message HTML
2. Mark Slack URLs (containing slack.com, /archives/, /client/) with isSlackLink: true
3. Include both the href URL and any visible link text
4. If no links in message, use empty array []

Return a JSON array of messages, ordered from oldest to newest (parent message first, then replies):
[{"author": "John", "timestamp": "2:30 PM", "content": "Hello!", "threadReplies": 0, "reactions": [], "links": [{"url": "https://...", "text": "...", "isSlackLink": true}]}, ...]`;

    const extracted = await llmExtract<SlackMessage[]>(threadHtml, extractionPrompt);

    if (extracted && Array.isArray(extracted)) {
      return { 
        messages: extracted, 
        threadUrl: currentUrl.includes('/thread/') ? currentUrl : undefined 
      };
    }

    return { messages: [], error: 'LLM extraction failed' };
  } catch (error) {
    return { messages: [], error: error instanceof Error ? error.message : 'Failed to read thread' };
  }
}

/**
 * Get the shareable URL for a message/thread
 */
export async function getMessageUrl(messageIndex: number): Promise<{ url?: string; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { error: 'Browser not ready' };

  try {
    // Find all messages
    const messageElements = await page.$$('[data-qa="virtual-list-item"], .c-message_kit__background, [data-qa="message_container"] > div');
    
    if (messageIndex < 0 || messageIndex >= messageElements.length) {
      return { error: `Message index ${messageIndex} out of range (${messageElements.length} messages)` };
    }

    const message = messageElements[messageIndex];
    
    // Hover over the message to show the action toolbar
    await message.hover();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the "More actions" button (three dots)
    const moreActions = await message.$('[data-qa="more_message_actions"], [aria-label="More actions"], .c-message_actions__button--overflow');
    if (!moreActions) {
      // Try finding it in the toolbar
      const toolbar = await page.$('[data-qa="message_actions"], .c-message_actions__container');
      if (toolbar) {
        const more = await toolbar.$('[aria-label="More actions"], [data-qa="more_message_actions"]');
        if (more) {
          await more.click();
        } else {
          return { error: 'Could not find more actions button' };
        }
      } else {
        return { error: 'Could not find message toolbar' };
      }
    } else {
      await moreActions.click();
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Click "Copy link"
    const copyLink = await page.$('[data-qa="copy_link"], [aria-label*="Copy link"], button:has-text("Copy link")');
    if (!copyLink) {
      // Close the menu
      await page.keyboard.press('Escape');
      return { error: 'Could not find Copy link option' };
    }

    await copyLink.click();
    await new Promise(resolve => setTimeout(resolve, 300));

    // The URL is now in the clipboard - try to read it
    // Note: This requires clipboard permissions which may not always work
    try {
      const clipboardUrl = await page.evaluate(async () => {
        return await navigator.clipboard.readText();
      });
      
      if (clipboardUrl && clipboardUrl.includes('slack.com')) {
        return { url: clipboardUrl };
      }
    } catch {
      // Clipboard access failed, try alternative method
    }

    // Alternative: construct URL from page context
    const currentUrl = page.url();
    // Try to extract workspace and channel from current URL
    const match = currentUrl.match(/app\.slack\.com\/client\/([^/]+)\/([^/]+)/);
    if (match) {
      // We can't get the exact message timestamp, but we have the channel
      return { url: currentUrl, error: 'Could not get exact message link, returning channel URL' };
    }

    return { error: 'Could not retrieve message URL' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to get message URL' };
  }
}

/**
 * Query Slack AI with a question
 * Opens search, types question, presses Enter, and extracts AI response with references
 */
export async function querySlackAI(question: string): Promise<{
  success: boolean;
  answer?: string;
  references?: Array<{ title: string; url: string }>;
  error?: string;
}> {
  // Check cache first (AI answers are stable, can cache longer)
  const cacheKey = CacheKeys.slackAI(question);
  const cached = slackCache.get<ReturnType<typeof querySlackAI>>(cacheKey, CacheTTL.slackAI);
  if (cached) {
    return cached;
  }

  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    // Open search with Cmd+K
    await page.keyboard.press('Meta+k');
    await new Promise(resolve => setTimeout(resolve, 800));

    // Type the question
    await page.keyboard.type(question, { delay: 50 });
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Press Enter to submit query to Slack AI
    await page.keyboard.press('Enter');
    
    // Wait for AI response to load (Slack AI can take a few seconds)
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Extract the AI response from the page
    // Slack AI responses typically appear in specific containers
    const aiResponseSelectors = [
      '[data-qa="slack_ai_answer"]',
      '[data-qa="ai_answer"]',
      '.c-search_modal__ai_answer',
      '.c-slack_ai_answer',
      '[role="region"][aria-label*="AI"]',
    ];

    let answerText = '';
    let answerElement = null;

    for (const selector of aiResponseSelectors) {
      const element = await page.$(selector);
      if (element) {
        answerElement = element;
        answerText = await element.evaluate(el => (el as HTMLElement).innerText || '');
        if (answerText.trim()) break;
      }
    }

    // If no AI-specific selector worked, try to find answer in search results
    if (!answerText.trim()) {
      const searchResultsHtml = await page.evaluate(() => {
        const searchModal = document.querySelector('[role="dialog"], .c-search_modal, [data-qa="search_modal"]');
        return searchModal ? (searchModal as HTMLElement).innerHTML : '';
      });

      // Use LLM to extract AI answer from search results HTML
      const extracted = await llmExtract<{ answer: string; hasReferences: boolean }>(
        searchResultsHtml,
        'Extract the Slack AI answer from this search results page. Look for an AI-generated response (usually at the top, may say "AI" or have a special formatting). Return JSON with: { "answer": "the AI response text", "hasReferences": true/false }'
      );

      if (extracted && extracted.answer) {
        answerText = extracted.answer;
      }
    }

    if (!answerText.trim()) {
      await page.keyboard.press('Escape');
      return {
        success: false,
        error: 'No AI response found. Slack AI may not be available in this workspace or the question may not have triggered an AI response.',
      };
    }

    // Extract reference links
    const references: Array<{ title: string; url: string }> = [];
    
    // Look for links in the AI answer section
    if (answerElement) {
      const links = await answerElement.$$('a[href]');
      for (const link of links) {
        const title = await link.evaluate(el => (el as HTMLElement).innerText || '');
        const url = await link.evaluate(el => el.getAttribute('href') || '');
        if (title && url) {
          references.push({ title: title.trim(), url });
        }
      }
    }

    // Close the search modal
    await page.keyboard.press('Escape');

    const result = {
      success: true,
      answer: answerText.trim(),
      references: references.length > 0 ? references : undefined,
    };
    
    // Cache the result
    slackCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    try { await page.keyboard.press('Escape'); } catch {}
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to query Slack AI',
    };
  }
}

/**
 * Close the thread panel if open
 */
export async function closeThreadPanel(): Promise<boolean> {
  const page = slackBrowser.getPage();
  if (!page) return false;

  try {
    const closeButton = await page.$('[data-qa="close_flexpane"], [aria-label="Close"], .p-flexpane__header_close');
    if (closeButton) {
      await closeButton.click();
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if Slack extractor is ready (browser is open and authenticated)
 */
export function isExtractorReady(): boolean {
  return slackBrowser.isReady();
}

/**
 * Take a screenshot of the current Slack browser state
 * Saves to WORK_DIRS/slack-debug/
 */
export async function takeScreenshot(name: string = 'slack'): Promise<{ success: boolean; path?: string; error?: string }> {
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    const { mkdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    
    const debugDir = join(process.cwd(), 'WORK_DIRS', 'slack-debug');
    if (!existsSync(debugDir)) {
      mkdirSync(debugDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    const filepath = join(debugDir, filename);
    
    await page.screenshot({ path: filepath, fullPage: false });
    
    return { success: true, path: filepath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to take screenshot' };
  }
}

/**
 * Debug function to diagnose scroll issues
 * Returns information about scrollable elements in the page
 */
export async function debugScrollInfo(): Promise<{ 
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
  const page = slackBrowser.getPage();
  if (!page) return { success: false, error: 'Browser not ready' };

  try {
    const info = await page.evaluate(() => {
      const result = {
        scrollableElements: [] as Array<{
          selector: string;
          scrollTop: number;
          scrollHeight: number;
          clientHeight: number;
          canScroll: boolean;
        }>,
        messagePaneFound: false,
        virtualListFound: false,
      };

      // Check specific Slack selectors
      const selectors = [
        '.c-virtual_list__scroll_container',
        '[data-qa="message_pane"]',
        '[data-qa="slack_kit_list"]',
        '.p-message_pane__foreground',
        '[role="list"]',
        '[data-qa="channel_sidebar"]',
        '.p-channel_sidebar',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          result.scrollableElements.push({
            selector: sel,
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            canScroll: el.scrollHeight > el.clientHeight,
          });
          
          if (sel.includes('message_pane')) result.messagePaneFound = true;
          if (sel.includes('virtual_list')) result.virtualListFound = true;
        }
      }

      return result;
    });

    return {
      success: true,
      info: {
        url: page.url(),
        ...info,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get debug info' };
  }
}

