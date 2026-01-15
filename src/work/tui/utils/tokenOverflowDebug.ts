// Token Overflow Debug System
// Automatically captures and saves debug info when we hit token limits

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createTask } from '../../tools/tasks.js';
import { ensureConfigDir } from '../../../utils/platform.js';

interface DebugDumpData {
  timestamp: string;
  errorMessage: string;
  estimatedTokens: number;
  
  // Context about what triggered this
  trigger: 'chat' | 'restore' | 'task_create' | 'unknown';
  workstreamId?: string;
  workstreamName?: string;
  taskId?: string;
  
  // The actual data that caused the overflow
  systemPrompt?: string;
  userMessage?: string;
  conversationHistory?: Array<{
    type: string;
    contentLength: number;
    contentPreview: string; // First 500 chars
    toolCalls?: Array<{ name: string; argsLength: number }>;
  }>;
  
  // Raw sizes for analysis
  sizes: {
    systemPromptChars?: number;
    userMessageChars?: number;
    conversationHistoryChars?: number;
    totalChars: number;
  };
  
  // Any additional context
  metadata?: Record<string, unknown>;
}

function getDebugDir(): string {
  return join(ensureConfigDir(), 'token-overflow-dumps');
}

function generateDumpId(): string {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).substring(2, 8);
  return `overflow-${dateStr}-${random}`;
}

/**
 * Dump all debug info to a file and create a task to investigate
 */
export async function handleTokenOverflow(data: {
  errorMessage: string;
  estimatedTokens: number;
  trigger: DebugDumpData['trigger'];
  workstreamId?: string;
  workstreamName?: string;
  taskId?: string;
  systemPrompt?: string;
  userMessage?: string;
  conversationMessages?: Array<{ type: string; content: unknown; toolCalls?: unknown[] }>;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const dumpId = generateDumpId();
  const debugDir = getDebugDir();
  
  // Ensure debug directory exists
  if (!existsSync(debugDir)) {
    await mkdir(debugDir, { recursive: true });
  }
  
  // Calculate sizes
  const systemPromptChars = data.systemPrompt?.length || 0;
  const userMessageChars = data.userMessage?.length || 0;
  
  // Process conversation history
  let conversationHistoryChars = 0;
  const conversationHistory = data.conversationMessages?.map(msg => {
    const contentStr = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    conversationHistoryChars += contentStr.length;
    
    return {
      type: msg.type,
      contentLength: contentStr.length,
      contentPreview: contentStr.substring(0, 500) + (contentStr.length > 500 ? '...' : ''),
      toolCalls: msg.toolCalls?.map((tc: any) => ({
        name: tc.name || 'unknown',
        argsLength: JSON.stringify(tc.args || {}).length,
      })),
    };
  });
  
  const totalChars = systemPromptChars + userMessageChars + conversationHistoryChars;
  
  // Create the debug dump object
  const debugDump: DebugDumpData = {
    timestamp: new Date().toISOString(),
    errorMessage: data.errorMessage,
    estimatedTokens: data.estimatedTokens,
    trigger: data.trigger,
    workstreamId: data.workstreamId,
    workstreamName: data.workstreamName,
    taskId: data.taskId,
    systemPrompt: data.systemPrompt,
    userMessage: data.userMessage,
    conversationHistory,
    sizes: {
      systemPromptChars,
      userMessageChars,
      conversationHistoryChars,
      totalChars,
    },
    metadata: data.metadata,
  };
  
  // Write summary file (safe to read)
  const summaryPath = join(debugDir, `${dumpId}-summary.json`);
  const summary = {
    timestamp: debugDump.timestamp,
    errorMessage: debugDump.errorMessage,
    estimatedTokens: debugDump.estimatedTokens,
    trigger: debugDump.trigger,
    workstreamName: debugDump.workstreamName,
    sizes: debugDump.sizes,
    conversationMessageCount: conversationHistory?.length || 0,
    largestMessages: conversationHistory
      ?.sort((a, b) => b.contentLength - a.contentLength)
      .slice(0, 5)
      .map(m => ({ type: m.type, chars: m.contentLength })),
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  
  // Write full dump (DANGEROUS - do not read in full!)
  const fullDumpPath = join(debugDir, `${dumpId}-full.json`);
  await writeFile(fullDumpPath, JSON.stringify(debugDump, null, 2));
  
  // Write raw conversation for analysis (chunked into separate files if huge)
  if (data.conversationMessages && data.conversationMessages.length > 0) {
    const rawConversationPath = join(debugDir, `${dumpId}-conversation.json`);
    await writeFile(rawConversationPath, JSON.stringify(data.conversationMessages, null, 2));
  }
  
  // Create a task to investigate this
  const taskContent = `🚨 TOKEN OVERFLOW: ${data.estimatedTokens.toLocaleString()} tokens (${Math.round(totalChars / 1000)}k chars)`;
  
  const taskContext = `
## Token Overflow Incident

**Timestamp:** ${debugDump.timestamp}
**Estimated Tokens:** ${data.estimatedTokens.toLocaleString()}
**Trigger:** ${data.trigger}
**Workstream:** ${data.workstreamName || 'N/A'}
**Error:** ${data.errorMessage}

### Size Breakdown
- System Prompt: ${systemPromptChars.toLocaleString()} chars
- User Message: ${userMessageChars.toLocaleString()} chars  
- Conversation History: ${conversationHistoryChars.toLocaleString()} chars
- **Total:** ${totalChars.toLocaleString()} chars

### Debug Files
- Summary (safe to read): ${summaryPath}
- Full dump (⚠️ HUGE): ${fullDumpPath}
${data.conversationMessages ? `- Conversation dump: ${join(debugDir, `${dumpId}-conversation.json`)}` : ''}

### ⚠️ WARNING
The full dump file is extremely large. DO NOT attempt to read it in full - it will cause token overflow again!

To investigate:
1. Read the summary file first
2. If needed, read the full dump in small chunks (use head/tail or read specific line ranges)
3. Look for unusually large messages in the conversation history
4. Check if any tool calls returned massive data

### Investigation Questions
- What caused such a large context?
- Is there a bug in how we're accumulating messages?
- Is some tool returning excessive data?
- Should we implement automatic summarization for large contexts?
`;

  await createTask(taskContent, {
    priority: 'high',
    context: taskContext,
    tags: ['bug', 'token-overflow', 'auto-generated'],
  });
  
  console.error(`[TOKEN OVERFLOW] Debug dump saved to: ${debugDir}/${dumpId}-*`);
  console.error(`[TOKEN OVERFLOW] Investigation task created: ${taskContent}`);
  
  return dumpId;
}

/**
 * Check if an error is a token overflow error
 */
export function isTokenOverflowError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('token') && (
      msg.includes('exceed') || 
      msg.includes('limit') || 
      msg.includes('maximum') ||
      msg.includes('too long') ||
      msg.includes('too large')
    );
  }
  return false;
}

/**
 * Estimate token count from text
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4);
}



