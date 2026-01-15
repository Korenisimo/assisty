// VIP Message Handler - Deep investigation and auto-response for important messages
// For VIP channels/DMs, analyzes messages more deeply, follows links, and can respond

import { ScannedMessage, selectBestSearchResult } from './scanner.js';
import { replyToMessage, sendMessage, searchForChannelAndGetResults, selectSearchResult } from '../clients/slack-extractor.js';
import { slackBrowser } from '../clients/slack.js';
import { getTasks, Task } from '../tools/tasks.js';
import { getPDPGoals, PDPGoal } from '../tools/pdp.js';
import { getMemories, Memory } from '../tools/memory.js';
import { createExternalCommsModel, createStandardModel, getPersonalityContext } from '../ai-config.js';
import { PersonalityConfig, CharacterConfig } from '../types.js';

// Extract URLs from message content
function extractUrls(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  return content.match(urlRegex) || [];
}

// Fetch and analyze a URL's content
async function investigateUrl(url: string): Promise<{
  url: string;
  title?: string;
  summary?: string;
  relevance?: string;
  error?: string;
}> {
  try {
    // Use a simple fetch to get the page content
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SlackBot/1.0)',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return { url, error: `HTTP ${response.status}` };
    }

    const html = await response.text();

    // Extract title using simple regex (good enough for most pages)
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // Use LLM to summarize the page content (use standard model for URL investigation)
    const model = createStandardModel(0.2);

    // Clean HTML for analysis (remove scripts, styles)
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .substring(0, 50000); // Limit to prevent token overflow

    const prompt = `Analyze this webpage and provide:
1. A 1-2 sentence summary of what this page is about
2. Why this might be relevant/important (business impact, technical details, action needed, etc.)

HTML Content:
${cleanHtml}

Respond with JSON only (no markdown):
{
  "summary": "Brief summary",
  "relevance": "Why this matters"
}`;

    const result = await model.generateContent(prompt);
    const response_text = result.response.text().trim();
    
    let cleanJson = response_text;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const analysis = JSON.parse(cleanJson);

    return {
      url,
      title,
      summary: analysis.summary,
      relevance: analysis.relevance,
    };
  } catch (error) {
    return {
      url,
      error: error instanceof Error ? error.message : 'Failed to investigate',
    };
  }
}

// Get user context for decision making
async function getUserContext(): Promise<{
  tasks: Task[];
  goals: PDPGoal[];
  memories: Memory[];
}> {
  const [tasks, goals, memories] = await Promise.all([
    getTasks({ status: ['pending', 'in_progress'] }),
    getPDPGoals(),
    getMemories(),
  ]);

  return { tasks, goals, memories };
}

// Filter context to only relevant items based on message content
// This prevents hallucinations from unrelated context
async function filterRelevantContext(
  message: ScannedMessage,
  context: { tasks: Task[]; goals: PDPGoal[]; memories: Memory[] }
): Promise<{ tasks: Task[]; goals: PDPGoal[]; memories: Memory[] }> {
  // For efficiency, use a quick keyword-based filter first
  const messageText = message.content.toLowerCase();
  const messageWords = new Set(messageText.split(/\s+/).filter(w => w.length > 3));
  
  // Helper to calculate relevance score
  const getRelevanceScore = (text: string): number => {
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    for (const word of words) {
      if (word.length > 3 && messageWords.has(word)) {
        score++;
      }
    }
    return score;
  };
  
  // Score and filter tasks (top 3 most relevant)
  const scoredTasks = context.tasks
    .map(t => ({ item: t, score: getRelevanceScore(t.content) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter(t => t.score > 0) // Only include if at least some relevance
    .map(t => t.item);
  
  // Score and filter goals (top 2 most relevant)
  const scoredGoals = context.goals
    .map(g => ({ item: g, score: getRelevanceScore(`${g.title} ${g.description || ''}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter(g => g.score > 0)
    .map(g => g.item);
  
  // For memories, take top 5 relevant ones
  const scoredMemories = context.memories
    .map(m => ({ item: m, score: getRelevanceScore(m.content) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .filter(m => m.score > 0)
    .map(m => m.item);
  
  return {
    tasks: scoredTasks,
    goals: scoredGoals,
    memories: scoredMemories,
  };
}

// Analyze VIP message deeply
export async function analyzeVipMessage(
  message: ScannedMessage,
  channelName: string,
  messageIndex: number
): Promise<{
  shouldRespond: boolean;
  importance: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  suggestedResponse?: string;
  urlInvestigations?: Array<{
    url: string;
    title?: string;
    summary?: string;
    relevance?: string;
    error?: string;
  }>;
}> {
  const urls = extractUrls(message.content);
  
  // Investigate all URLs in parallel
  const urlInvestigations = urls.length > 0
    ? await Promise.all(urls.slice(0, 3).map(url => investigateUrl(url))) // Max 3 URLs
    : undefined;

  // Get user context and filter to relevant items only
  const fullContext = await getUserContext();
  const context = await filterRelevantContext(message, fullContext);

  // Use best model for analysis (this is important for VIP messages)
  const model = createExternalCommsModel(0.3);

  // Build context string with ONLY relevant items (prevents hallucinations)
  const contextStr = `
USER TASKS (only those relevant to this message):
${context.tasks.map(t => `- [${t.priority}] ${t.content}`).join('\n') || 'None relevant'}

USER GOALS (only those relevant to this message):
${context.goals.map(g => `- ${g.title} (${g.category})`).join('\n') || 'None relevant'}

USER PREFERENCES (only those relevant to this message):
${context.memories.map(m => `- ${m.content}`).join('\n') || 'None relevant'}
`;

  const urlContext = urlInvestigations
    ? `\nLINKS IN MESSAGE:
${urlInvestigations.map(u => `- ${u.url}
  Title: ${u.title || 'Unknown'}
  Summary: ${u.summary || 'N/A'}
  Relevance: ${u.relevance || 'N/A'}
  Error: ${u.error || 'None'}`).join('\n')}`
    : '';

  // Check if message has thread replies from Koren already
  const korenReplied = message.threadReplies?.some(reply => 
    reply.author.toLowerCase().includes('koren') || 
    reply.author.toLowerCase().includes('ben ezri')
  );

  const prompt = `You are analyzing a VIP Slack message for importance. Your PRIMARY role is assessment, NOT response.

CONTEXT ABOUT KOREN:
${contextStr}

VIP MESSAGE TO ANALYZE:
Channel: #${channelName}
From: ${message.author}
Time: ${message.timestamp}
Content: ${message.content}
${message.threadReplies ? `Thread Replies: ${message.threadReplies.length}` : 'No thread'}
${korenReplied ? '⚠️ KOREN ALREADY REPLIED TO THIS THREAD' : ''}
${urlContext}

YOUR TASK:
1. Assess importance level (critical/high/medium/low) based on urgency and impact
2. Determine if an AI flag/response is warranted
3. If warranted, provide ONLY a brief flagging message

STRICT RESPONSE CRITERIA - ALL THREE MUST BE TRUE:
✓ Message EXPLICITLY mentions @korenbe OR @koren OR is a DM to him
✓ Message requires IMMEDIATE action/decision (not "FYI", "heads up", "just sharing")
✓ Koren has NOT already replied (check thread replies above)

NEVER RESPOND TO (even if important):
✗ General team discussions (even if related to Koren's work)
✗ Informational updates ("FYI", "just so you know", "sharing for awareness")
✗ Questions NOT explicitly directed at Koren (tagged or in DM)
✗ Messages Koren already replied to in the thread
✗ Social/casual conversation, greetings, thanks
✗ Messages where waiting a few hours is acceptable
✗ Thread discussions where Koren is not the next expected responder

ONLY RESPOND TO:
✓ Direct @mention with urgent question requiring Koren's answer NOW
✓ Critical incident/outage requiring Koren's immediate input
✓ Deadline in next 24 hours that Koren hasn't acknowledged
✓ Direct escalation explicitly requesting Koren's decision/approval

IF ALL CRITERIA MET AND YOU RESPOND:
- Format: "🤖 Flagging for @korenbe: [ONE sentence summary of what needs attention]"
- Do NOT engage in discussion
- Do NOT answer questions on Koren's behalf
- Do NOT provide solutions - only flag the need for attention
- Keep it to ONE sentence maximum

WHEN IN DOUBT: Mark as important/high but set shouldRespond=false. It's MUCH better to skip a flag than to spam.

Respond with JSON only (no markdown):
{
  "importance": "critical|high|medium|low",
  "shouldRespond": true/false,
  "reason": "Brief explanation of importance assessment and specific reason for respond decision",
  "suggestedResponse": "ONLY if shouldRespond=true: '🤖 Flagging for @korenbe: [one sentence]', otherwise null"
}`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    let cleanJson = response;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    const analysis = JSON.parse(cleanJson);

    return {
      importance: analysis.importance,
      shouldRespond: analysis.shouldRespond,
      reason: analysis.reason,
      suggestedResponse: analysis.suggestedResponse,
      urlInvestigations,
    };
  } catch (error) {
    // Default to not responding on error
    return {
      importance: 'low',
      shouldRespond: false,
      reason: `Analysis error: ${error instanceof Error ? error.message : 'Unknown'}`,
      urlInvestigations,
    };
  }
}

// Auto-respond to a VIP message if appropriate
// Note: Assumes we're already in the correct channel (called during scanning)
export async function handleVipAutoResponse(
  channelName: string,
  messageIndex: number,
  analysis: {
    shouldRespond: boolean;
    suggestedResponse?: string;
  },
  alreadyInChannel: boolean = false
): Promise<{
  success: boolean;
  responded: boolean;
  error?: string;
}> {
  if (!analysis.shouldRespond || !analysis.suggestedResponse) {
    return { success: true, responded: false };
  }

  try {
    // Only navigate if we're not already in the channel
    if (!alreadyInChannel) {
      const searchResult = await searchForChannelAndGetResults(channelName);
      if (!searchResult.success || searchResult.results.length === 0) {
        return { 
          success: false, 
          responded: false,
          error: `Failed to navigate to channel: ${searchResult.error}` 
        };
      }

      // Smart selection: Use LLM to pick the best match
      const selectedIndex = await selectBestSearchResult(channelName, searchResult.results);
      await selectSearchResult(selectedIndex);
      
      const page = slackBrowser.getPage();
      if (page) {
        await page.waitForTimeout(2000);
      }
    }

    // Reply to the message in a thread (keeps the channel clean)
    const replyResult = await replyToMessage(
      messageIndex,
      analysis.suggestedResponse,
      { skipDisclaimer: false } // Always include AI disclaimer
    );

    if (!replyResult.success) {
      return {
        success: false,
        responded: false,
        error: `Failed to reply: ${replyResult.error}`,
      };
    }

    return { success: true, responded: true };
  } catch (error) {
    return {
      success: false,
      responded: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

