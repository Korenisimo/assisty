// Advice Generator - AI-powered analysis of Slack messages
// Generates relevant advice topics based on user context

import { GoogleGenerativeAI } from '@google/generative-ai';
import { ScannedMessage, ChannelScanResult } from './scanner.js';
import { addAdviceTopic, AdviceTopic } from '../storage/advice.js';
import { getTasks, Task } from '../tools/tasks.js';
import { getPDPGoals, PDPGoal } from '../tools/pdp.js';
import { getMemories, Memory } from '../tools/memory.js';
import { createStandardModel } from '../ai-config.js';

// Initialize Gemini
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

// Get user context for analysis
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

// Format user context for the prompt
function formatUserContext(context: {
  tasks: Task[];
  goals: PDPGoal[];
  memories: Memory[];
}): string {
  const parts: string[] = [];

  // Tasks
  if (context.tasks.length > 0) {
    parts.push('## Current Tasks');
    for (const task of context.tasks.slice(0, 10)) {
      parts.push(`- [${task.priority}] ${task.content} (${task.status})`);
      if (task.tags?.length) {
        parts.push(`  Tags: ${task.tags.join(', ')}`);
      }
    }
  }

  // PDP Goals
  if (context.goals.length > 0) {
    parts.push('\n## Development Goals');
    for (const goal of context.goals.slice(0, 5)) {
      parts.push(`- ${goal.title} (${goal.category}, ${goal.status})`);
      if (goal.description) {
        parts.push(`  ${goal.description.slice(0, 100)}...`);
      }
    }
  }

  // Memories (user preferences)
  if (context.memories.length > 0) {
    parts.push('\n## User Preferences & Context');
    for (const mem of context.memories.slice(0, 10)) {
      parts.push(`- [${mem.category}] ${mem.content}`);
    }
  }

  return parts.join('\n');
}

// Format messages for the prompt (with smart truncation)
function formatMessages(channelResults: ChannelScanResult[], maxTokens: number = 8000): string {
  const parts: string[] = [];
  let estimatedTokens = 0;
  
  for (const channel of channelResults) {
    if (channel.messages.length === 0) continue;

    const channelHeader = `\n### #${channel.channelName}`;
    parts.push(channelHeader);
    estimatedTokens += channelHeader.length / 4; // Rough token estimate
    
    const newMessages = channel.messages.filter(m => m.isNew);
    if (newMessages.length === 0) {
      parts.push('(No new messages)');
      continue;
    }

    for (const msg of newMessages) {
      // Format parent message
      let messageText = `[${msg.author}] ${msg.content}`;
      
      // Include VIP analysis if available
      if (msg.vipAnalysis) {
        messageText += `\n  VIP ANALYSIS: ${msg.vipAnalysis.importance.toUpperCase()} - ${msg.vipAnalysis.reason}`;
        if (msg.vipAnalysis.autoResponded) {
          messageText += `\n  ✓ Auto-responded to flag for Koren's attention`;
        }
        if (msg.vipAnalysis.urlInvestigations && msg.vipAnalysis.urlInvestigations.length > 0) {
          messageText += `\n  Links investigated:`;
          for (const urlInv of msg.vipAnalysis.urlInvestigations) {
            messageText += `\n    - ${urlInv.url}`;
            if (urlInv.title) messageText += `\n      "${urlInv.title}"`;
            if (urlInv.summary) messageText += `\n      Summary: ${urlInv.summary}`;
            if (urlInv.relevance) messageText += `\n      Why relevant: ${urlInv.relevance}`;
          }
        }
      }
      
      // Include thread content if available
      if (msg.threadReplies && msg.threadReplies.length > 0) {
        messageText += `\n  Thread (${msg.threadReplies.length} replies):`;
        // Include up to 5 thread replies (or less if approaching token limit)
        const replyLimit = Math.min(5, msg.threadReplies.length);
        for (let i = 0; i < replyLimit; i++) {
          const reply = msg.threadReplies[i];
          messageText += `\n    - [${reply.author}] ${reply.content.slice(0, 200)}${reply.content.length > 200 ? '...' : ''}`;
        }
        if (msg.threadReplies.length > replyLimit) {
          messageText += `\n    ... and ${msg.threadReplies.length - replyLimit} more replies`;
        }
      }
      
      // Check if adding this message would exceed limit
      const messageTokens = messageText.length / 4;
      if (estimatedTokens + messageTokens > maxTokens) {
        parts.push('(... more messages truncated to fit context limit)');
        break;
      }
      
      parts.push(messageText);
      estimatedTokens += messageTokens;
    }
    
    // Break if we've hit the limit
    if (estimatedTokens >= maxTokens) {
      break;
    }
  }

  return parts.join('\n');
}

// Parse AI response into topics
interface GeneratedTopic {
  title: string;
  summary: string;
  relevanceReason: string;
  sourceChannel: string;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  relatedTaskIds?: string[];
  relatedGoalIds?: string[];
}

// Generate advice topics from channel scan results
export async function generateAdviceTopics(
  channelResults: ChannelScanResult[]
): Promise<AdviceTopic[]> {
  // Filter to channels with new messages
  const channelsWithNew = channelResults.filter(
    ch => ch.success && ch.newMessageCount > 0
  );

  if (channelsWithNew.length === 0) {
    return [];
  }

  // Get user context
  const context = await getUserContext();
  
  // Prepare the prompt
  const userContextStr = formatUserContext(context);
  const messagesStr = formatMessages(channelsWithNew);

  const model = createStandardModel(0.3);

  const prompt = `Analyze Slack messages and identify 0-5 relevant discussion topics for the user.

## USER CONTEXT
${userContextStr || '(No specific context available - use general relevance)'}

## NEW SLACK MESSAGES
${messagesStr}

## REQUIREMENTS
Focus on:
- Announcements/updates affecting their work
- Discussions related to current tasks
- Technical topics matching interests
- Opportunities to contribute/learn
- Important team/company updates

Skip:
- Generic chit-chat or social messages
- Irrelevant topics
- Duplicates

For each topic:
- **Title**: Short, specific (max 50 chars)
- **Summary**: CONCISE, 1-2 sentences max. Be direct and to the point.
- **Relevance**: Brief reason why it matters to THIS user (1 sentence)
- **Priority**: high=urgent/action needed, medium=should know, low=might interest
- **Tags**: 2-3 categorization tags

Respond with JSON array (no markdown):
[
  {
    "title": "Specific topic title",
    "summary": "1-2 sentence concise summary",
    "relevanceReason": "Brief reason why relevant",
    "sourceChannel": "channel-name",
    "priority": "low|medium|high",
    "tags": ["tag1", "tag2"],
    "relatedTaskIds": ["task_id if relevant"],
    "relatedGoalIds": ["goal_id if relevant"]
  }
]

If no topics are worth surfacing, return: []`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Parse JSON response
    const cleanJson = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const generatedTopics: GeneratedTopic[] = JSON.parse(cleanJson);

    // Convert to AdviceTopic and save
    const savedTopics: AdviceTopic[] = [];

    for (const topic of generatedTopics) {
      // Find source messages for this topic
      const sourceChannel = channelsWithNew.find(
        ch => ch.channelName.toLowerCase() === topic.sourceChannel.toLowerCase()
      );

      const newMessages = sourceChannel?.messages.filter(m => m.isNew) || [];

      const sourceMessages = newMessages
        .slice(0, 5)
        .map(m => ({
          author: m.author,
          timestamp: m.timestamp,
          content: m.content,
          threadUrl: m.threadUrl,  // Include thread URL if available
        }));

      // Extract URL references from VIP analysis
      const references: Array<{
        url: string;
        title?: string;
        summary?: string;
        relevance?: string;
      }> = [];

      for (const msg of newMessages) {
        if (msg.vipAnalysis?.urlInvestigations) {
          for (const urlInv of msg.vipAnalysis.urlInvestigations) {
            references.push({
              url: urlInv.url,
              title: urlInv.title,
              summary: urlInv.summary,
              relevance: urlInv.relevance,
            });
          }
        }
      }

      const saved = addAdviceTopic({
        title: topic.title,
        summary: topic.summary,
        relevanceReason: topic.relevanceReason,
        sourceChannel: topic.sourceChannel,
        sourceMessages,
        references: references.length > 0 ? references : undefined,
        priority: topic.priority,
        tags: topic.tags,
        relatedTaskIds: topic.relatedTaskIds,
        relatedGoalIds: topic.relatedGoalIds,
      });

      savedTopics.push(saved);
    }

    return savedTopics;
  } catch (error) {
    // Silently fail - caller will handle empty array
    // TUI shouldn't be interrupted with console output
    return [];
  }
}

// Quick check if messages might be interesting (cheaper than full analysis)
export async function quickRelevanceCheck(
  messages: ScannedMessage[],
  channelName: string
): Promise<boolean> {
  if (messages.length === 0) return false;

  const context = await getUserContext();
  
  // If user has no context, everything might be interesting
  if (context.tasks.length === 0 && context.goals.length === 0 && context.memories.length === 0) {
    return messages.length > 2;  // Only if there's meaningful activity
  }

  const model = createStandardModel(0.1);

  // Simplified context
  const keywords = [
    ...context.tasks.map(t => t.content),
    ...context.goals.map(g => g.title),
    ...context.memories.filter(m => m.category === 'workflow').map(m => m.content),
  ].join(' ').toLowerCase();

  const messagesSummary = messages
    .slice(0, 5)
    .map(m => m.content.slice(0, 100))
    .join('\n');

  const prompt = `Quickly determine if these Slack messages from #${channelName} might be relevant to someone interested in: ${keywords.slice(0, 300)}

Messages:
${messagesSummary}

Answer ONLY with "yes" or "no"`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().toLowerCase().trim();
    return response.includes('yes');
  } catch {
    return true;  // Default to checking if unsure
  }
}

