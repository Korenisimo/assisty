// Slack Scanner - Checks watched channels for new messages
// Used by the advice system to detect updates

import { slackBrowser, SlackMessage } from '../clients/slack.js';
import { extractMessages, searchForChannelAndGetResults, selectSearchResult, isExtractorReady, readThread, closeThreadPanel, scrollToLoadMore } from '../clients/slack-extractor.js';
import {
  loadAdviceConfig,
  updateChannelScanTimestamp,
  WatchedChannel,
} from '../storage/advice.js';
import { analyzeVipMessage, handleVipAutoResponse } from './vip-handler.js';
import { createStandardModel } from '../ai-config.js';
import type { Page } from 'playwright';

export interface ScannedMessage {
  author: string;
  timestamp: string;
  content: string;
  isNew: boolean;  // Whether this message is newer than last scan
  threadReplies?: SlackMessage[];  // Thread content if available
  threadUrl?: string;
  vipAnalysis?: {  // Deep analysis for VIP channels
    importance: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    autoResponded: boolean;
    urlInvestigations?: Array<{
      url: string;
      title?: string;
      summary?: string;
      relevance?: string;
    }>;
  };
}

export interface ChannelScanResult {
  channelName: string;
  success: boolean;
  error?: string;
  messages: ScannedMessage[];
  newMessageCount: number;
  lastScannedAt: string;
}

export interface ScanResult {
  success: boolean;
  error?: string;
  channels: ChannelScanResult[];
  totalNewMessages: number;
  scannedAt: string;
}

// Intelligently determine how many times to scroll based on channel activity
async function determineScrollCount(channel: WatchedChannel, page: Page | null): Promise<number> {
  if (!page) {
    // Fallback to conservative defaults if no page
    return channel.isVip ? 2 : 1;
  }

  try {
    // First, extract a few visible messages without scrolling
    const { messages, error } = await extractMessages(10);
    
    if (error || messages.length === 0) {
      // If we can't see messages, use conservative default
      return 1;
    }

    // Check the timestamps of visible messages
    const now = new Date();
    const oldestMessage = messages[messages.length - 1];
    const oldestTime = new Date(oldestMessage.timestamp);
    const hoursSinceOldest = (now.getTime() - oldestTime.getTime()) / (1000 * 60 * 60);

    // If the oldest visible message is very recent (< 6 hours), we probably don't need to scroll much
    if (hoursSinceOldest < 6) {
      return 0; // No scrolling needed - recent messages visible
    }

    // If it's been a while, use LLM to decide if we need to go back further
    // This is only for VIP channels or if the last scan was a long time ago
    if (!channel.isVip && hoursSinceOldest < 24) {
      return 1; // One scroll for regular channels with moderate age
    }

    // For VIP or older channels, use model to decide if we need to scroll more
    const model = createStandardModel(0.2);

    const messagesSummary = messages.slice(0, 5).map(m => 
      `[${m.timestamp}] ${m.author}: ${m.content.substring(0, 100)}`
    ).join('\n');

    const prompt = `You are helping scan a Slack channel (${channel.isVip ? 'VIP' : 'regular'}).
Currently visible messages:
${messagesSummary}

The oldest visible message is from ${hoursSinceOldest.toFixed(1)} hours ago.
Last scan of this channel was: ${channel.lastScannedAt || 'never'}

Question: Should we scroll up to load MORE message history before scanning?
Consider:
- If messages are very recent (< 6h), probably don't need more
- If there's active conversation visible, recent context might be enough
- VIP channels might need more depth for important discussions
- But don't scroll excessively - most important messages are recent

Respond with ONLY a number 0-3 indicating how many times to scroll up:
0 = don't scroll (current view is sufficient)
1 = scroll once (load ~1 page of older messages)
2 = scroll twice (load ~2 pages)
3 = scroll three times (deep history for critical channels)`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    const scrolls = parseInt(response.match(/\d+/)?.[0] || '1');
    
    // Cap at reasonable limits
    return Math.min(Math.max(0, scrolls), channel.isVip ? 3 : 2);
  } catch {
    // On error, fall back to conservative defaults
    return channel.isVip ? 2 : 1;
  }
}

// Intelligently select the best search result using LLM
export async function selectBestSearchResult(
  searchQuery: string,
  results: Array<{ index: number; text: string; type: string }>
): Promise<number> {
  // If only one result, no need for LLM
  if (results.length === 1) {
    return 0;
  }

  // If exact match found (case-insensitive), use it
  const exactMatch = results.find(r => 
    r.text.toLowerCase().includes(searchQuery.toLowerCase()) &&
    r.text.toLowerCase().replace(/[#@\s]/g, '') === searchQuery.toLowerCase().replace(/[#@\s]/g, '')
  );
  if (exactMatch) {
    return exactMatch.index;
  }

  try {
    const model = createStandardModel(0.1);

    const resultsStr = results.map(r => `${r.index}: ${r.text} (${r.type})`).join('\n');

    const prompt = `You searched Slack for: "${searchQuery}"

Search results:
${resultsStr}

Which result best matches what was searched for?
Consider:
- Exact name matches are best
- DMs vs channels: if searching for a person name, prefer DM
- If searching for channel name, prefer channel
- Shorter names that match are better than longer approximate matches

Respond with ONLY the index number (0, 1, 2, etc.) of the best match.`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    const selectedIndex = parseInt(response.match(/\d+/)?.[0] || '0');
    
    // Validate the index
    if (selectedIndex >= 0 && selectedIndex < results.length) {
      return selectedIndex;
    }
    
    // Fallback to first result if invalid
    return 0;
  } catch {
    // On error, fall back to first result
    return 0;
  }
}

// Scan a single channel for messages
async function scanChannel(channel: WatchedChannel, scanOnlyMode: boolean = true): Promise<ChannelScanResult> {
  const result: ChannelScanResult = {
    channelName: channel.name,
    success: false,
    messages: [],
    newMessageCount: 0,
    lastScannedAt: new Date().toISOString(),
  };

  try {
    // Navigate to the channel using search - use intelligent selection
    const searchResult = await searchForChannelAndGetResults(channel.name);
    if (!searchResult.success || searchResult.results.length === 0) {
      throw new Error(searchResult.error || 'Failed to navigate to channel');
    }
    
    // Smart selection: Use LLM to pick the best match from search results
    const selectedIndex = await selectBestSearchResult(channel.name, searchResult.results);
    const selectResult = await selectSearchResult(selectedIndex);
    if (!selectResult.success) {
      throw new Error(selectResult.error || 'Failed to select channel');
    }
    
    // Wait for channel to load
    const page = slackBrowser.getPage();
    if (page) {
      await page.waitForTimeout(2000);
    }
    
    // Intelligent scrolling: Only scroll if we need more context
    // Start with recent messages (no scroll), then decide if we need more
    const scrollCount = await determineScrollCount(channel, page);
    for (let i = 0; i < scrollCount; i++) {
      await scrollToLoadMore('up');
      if (page) {
        await page.waitForTimeout(1000);
      }
    }
    
    // Extract messages (increase limit to capture the scrolled content)
    const messageLimit = channel.isVip ? 100 : 50;
    const { messages, error } = await extractMessages(messageLimit);
    
    if (error) {
      throw new Error(error);
    }
    
    // Determine which messages are new and read their threads
    const lastMessageTs = channel.lastMessageTimestamp;
    let latestTs: string | undefined;
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const isNew = !lastMessageTs || msg.timestamp > lastMessageTs;
      
      const scannedMsg: ScannedMessage = {
        author: msg.author,
        timestamp: msg.timestamp,
        content: msg.content,
        isNew,
      };
      
      // If message has thread replies and is new, read the thread
      if (isNew && msg.threadReplies && msg.threadReplies > 0) {
        try {
          const threadResult = await readThread(i);
          if (threadResult.messages && threadResult.messages.length > 0) {
            scannedMsg.threadReplies = threadResult.messages;
            scannedMsg.threadUrl = threadResult.threadUrl;
          }
          
          // Close thread panel after reading
          await closeThreadPanel();
          
          // Brief pause to let UI settle
          const page = slackBrowser.getPage();
          if (page) {
            await page.waitForTimeout(500);
          }
        } catch (threadError) {
          // Continue even if thread reading fails
          // Better to have the parent message than nothing
        }
      }
      
      // VIP HANDLING: Deep investigation and potential auto-response
      if (isNew && channel.isVip) {
        try {
          const vipAnalysis = await analyzeVipMessage(scannedMsg, channel.name, i);
          
          // Store analysis result
          scannedMsg.vipAnalysis = {
            importance: vipAnalysis.importance,
            reason: vipAnalysis.reason,
            autoResponded: false,
            urlInvestigations: vipAnalysis.urlInvestigations?.filter(u => !u.error),
          };
          
          // ONLY auto-respond if scan-only mode is disabled AND analysis suggests it
          // Default behavior (scanOnlyMode=true) is to analyze but NOT respond
          if (!scanOnlyMode && vipAnalysis.shouldRespond && vipAnalysis.suggestedResponse) {
            const responseResult = await handleVipAutoResponse(
              channel.name,
              i,
              {
                shouldRespond: vipAnalysis.shouldRespond,
                suggestedResponse: vipAnalysis.suggestedResponse,
              },
              true  // We're already in the channel, no need to navigate again
            );
            
            if (responseResult.success && responseResult.responded) {
              scannedMsg.vipAnalysis.autoResponded = true;
            }
          }
        } catch (vipError) {
          // VIP analysis is optional - don't fail the whole scan
          // Just skip the deep analysis for this message
        }
      }
      
      result.messages.push(scannedMsg);
      
      if (isNew) {
        result.newMessageCount++;
      }
      
      // Track latest timestamp
      if (!latestTs || msg.timestamp > latestTs) {
        latestTs = msg.timestamp;
      }
    }
    
    // Update scan timestamp
    updateChannelScanTimestamp(channel.name, result.lastScannedAt, latestTs);
    
    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

// Scan all enabled watched channels
export async function scanWatchedChannels(options?: { 
  vipOnly?: boolean;
  scanOnlyMode?: boolean; // Default: true (safe mode - analyze but don't auto-respond)
}): Promise<ScanResult> {
  const config = loadAdviceConfig();
  const result: ScanResult = {
    success: false,
    channels: [],
    totalNewMessages: 0,
    scannedAt: new Date().toISOString(),
  };

  if (!config.enabled) {
    result.error = 'Advice feature is disabled';
    return result;
  }

  // Default to scan-only mode for safety
  const scanOnlyMode = options?.scanOnlyMode ?? true;

  let enabledChannels = config.watchedChannels.filter(ch => ch.enabled);
  
  // Filter to VIP-only if requested
  if (options?.vipOnly) {
    enabledChannels = enabledChannels.filter(ch => ch.isVip);
    if (enabledChannels.length === 0) {
      result.error = 'No VIP channels being watched';
      return result;
    }
  } else if (enabledChannels.length === 0) {
    result.error = 'No channels being watched';
    return result;
  }

  try {
    // Check if browser/extractor is ready
    if (!isExtractorReady()) {
      result.error = 'Slack browser not ready. Please open Slack first with the assistant.';
      return result;
    }

    // Check login status
    const status = await slackBrowser.getStatus();
    if (!status.isLoggedIn) {
      result.error = 'Not logged in to Slack. Please log in first.';
      return result;
    }

    // Scan each channel
    for (const channel of enabledChannels) {
      const channelResult = await scanChannel(channel, scanOnlyMode);
      result.channels.push(channelResult);
      result.totalNewMessages += channelResult.newMessageCount;
      
      // Brief pause between channels to avoid rate limiting
      const page = slackBrowser.getPage();
      if (page) {
        await page.waitForTimeout(1000);
      }
    }

    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

// Check if there are any new messages without doing a full scan
export async function hasNewMessages(): Promise<boolean> {
  const scanResult = await scanWatchedChannels();
  return scanResult.totalNewMessages > 0;
}

// Get messages from a specific channel
export async function getChannelMessages(channelName: string, limit?: number): Promise<ScannedMessage[]> {
  const config = loadAdviceConfig();
  const channel = config.watchedChannels.find(
    ch => ch.name.toLowerCase() === channelName.toLowerCase()
  );
  
  if (!channel) {
    return [];
  }

  const result = await scanChannel(channel);
  
  if (!result.success) {
    return [];
  }

  return limit ? result.messages.slice(0, limit) : result.messages;
}
