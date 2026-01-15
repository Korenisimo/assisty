// Checkpoint storage - saves and loads chat sessions
// Checkpoints are stored in WORK_DIRS/.checkpoints/

import { mkdir, writeFile, readFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';

export interface Checkpoint {
  id: string;
  name: string;
  summary: string;
  createdAt: number;
  turnCount: number;
  tokenEstimate: number;
  personality: string;
  character: string;
  datadogEnabled: boolean;
  // Serialized messages
  messages: SerializedMessage[];
}

export interface SerializedMessage {
  type: 'human' | 'ai' | 'system' | 'tool';
  content: string;
  // For tool messages
  toolCallId?: string;
  name?: string;
  // For AI messages with tool calls
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
  }>;
}

function getCheckpointsDir(): string {
  return join(process.cwd(), 'WORK_DIRS', '.checkpoints');
}

export async function ensureCheckpointsDir(): Promise<void> {
  const dir = getCheckpointsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Serialize LangChain messages to JSON-compatible format
 * Uses _getType() instead of instanceof for cross-module safety
 */
function serializeMessages(messages: BaseMessage[]): SerializedMessage[] {
  return messages.map(msg => {
    const content = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    
    const msgType = msg._getType?.();
    
    if (msgType === 'human') {
      return { type: 'human' as const, content };
    } else if (msgType === 'ai') {
      const aiMsg = msg as AIMessage;
      const serialized: SerializedMessage = { type: 'ai' as const, content };
      
      // Preserve tool calls if present
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        serialized.toolCalls = aiMsg.tool_calls.map(tc => ({
          name: tc.name,
          args: tc.args as Record<string, unknown>,
          id: tc.id || '',
        }));
      }
      
      return serialized;
    } else if (msgType === 'system') {
      return { type: 'system' as const, content };
    } else if (msgType === 'tool') {
      const toolMsg = msg as ToolMessage;
      return {
        type: 'tool' as const,
        content,
        toolCallId: toolMsg.tool_call_id,
        name: toolMsg.name,
      };
    }
    
    // Default to human if unknown
    return { type: 'human' as const, content };
  });
}

/**
 * Deserialize JSON messages back to LangChain messages
 * Validates message ordering for Gemini compatibility (tool responses must follow tool calls)
 */
export function deserializeMessages(serialized: SerializedMessage[]): BaseMessage[] {
  // First pass: convert to LangChain messages
  const messages = serialized.map(msg => {
    switch (msg.type) {
      case 'human':
        return new HumanMessage(msg.content);
      case 'ai': {
        const aiMsg = new AIMessage(msg.content);
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          aiMsg.tool_calls = msg.toolCalls.map(tc => ({
            name: tc.name,
            args: tc.args,
            id: tc.id,
            type: 'tool_call' as const,
          }));
        }
        return aiMsg;
      }
      case 'system':
        return new SystemMessage(msg.content);
      case 'tool':
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
          name: msg.name || 'tool',  // Fallback for old messages without name (Gemini requires it)
        });
      default:
        return new HumanMessage(msg.content);
    }
  });
  
  // Second pass: validate and fix message ordering for Gemini
  // Tool messages must immediately follow an AI message with tool_calls
  return sanitizeMessageOrder(messages);
}

/**
 * Sanitize message order to ensure Gemini compatibility
 * Gemini requires: tool response turns must immediately follow function call turns
 * Uses _getType() instead of instanceof for cross-module safety
 * 
 * Valid sequence:
 *   AI (with tool_calls) -> Tool -> Tool -> ... -> Human/AI
 * 
 * Invalid sequences we need to fix:
 *   AI (with tool_calls) -> Human -> Tool (orphan tool)
 *   AI (with tool_calls) -> AI -> Tool (orphan tool)
 *   Tool without any preceding AI tool_calls
 */
export function sanitizeMessageOrder(messages: BaseMessage[]): BaseMessage[] {
  const result: BaseMessage[] = [];
  let expectingToolResponses = false;
  let expectedToolCallIds: Set<string> = new Set();
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgType = msg._getType?.();
    
    if (msgType === 'tool') {
      const toolMsg = msg as ToolMessage;
      // Only accept tool messages if we're expecting them and have matching ID
      if (expectingToolResponses && expectedToolCallIds.has(toolMsg.tool_call_id)) {
        result.push(msg);
        expectedToolCallIds.delete(toolMsg.tool_call_id);
        // If all tool calls answered, stop expecting more
        if (expectedToolCallIds.size === 0) {
          expectingToolResponses = false;
        }
      } else {
        // Orphan tool message - skip it silently
      }
    } else if (msgType === 'ai') {
      const aiMsg = msg as AIMessage;
      
      // If we were expecting tool responses but got another AI/Human message,
      // we need to clean up the previous AI's tool_calls
      if (expectingToolResponses && result.length > 0) {
        // Find the last AI message and remove its unanswered tool_calls
        for (let j = result.length - 1; j >= 0; j--) {
          if (result[j]._getType?.() === 'ai') {
            const prevAi = result[j] as AIMessage;
            if (prevAi.tool_calls && prevAi.tool_calls.length > 0) {
              // Remove unanswered tool_calls
              prevAi.tool_calls = prevAi.tool_calls.filter(tc => !expectedToolCallIds.has(tc.id || ''));
            }
            break;
          }
        }
      }
      
      result.push(msg);
      
      // Check if this AI message has tool_calls
      if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
        expectingToolResponses = true;
        expectedToolCallIds = new Set(aiMsg.tool_calls.map(tc => tc.id || ''));
      } else {
        expectingToolResponses = false;
        expectedToolCallIds.clear();
      }
    } else {
      // Human or System message
      
      // If we were expecting tool responses, clean up the previous AI's tool_calls
      if (expectingToolResponses && result.length > 0) {
        for (let j = result.length - 1; j >= 0; j--) {
          if (result[j]._getType?.() === 'ai') {
            const prevAi = result[j] as AIMessage;
            if (prevAi.tool_calls && prevAi.tool_calls.length > 0) {
              prevAi.tool_calls = prevAi.tool_calls.filter(tc => !expectedToolCallIds.has(tc.id || ''));
            }
            break;
          }
        }
        expectingToolResponses = false;
        expectedToolCallIds.clear();
      }
      
      result.push(msg);
    }
  }
  
  // Final cleanup: if we end with unanswered tool_calls, remove them
  if (expectingToolResponses && result.length > 0) {
    for (let j = result.length - 1; j >= 0; j--) {
      if (result[j]._getType?.() === 'ai') {
        const prevAi = result[j] as AIMessage;
        if (prevAi.tool_calls && prevAi.tool_calls.length > 0) {
          prevAi.tool_calls = [];
        }
        break;
      }
    }
  }
  
  return result;
}

/**
 * Save a checkpoint
 */
export async function saveCheckpoint(
  name: string,
  summary: string,
  messages: BaseMessage[],
  stats: { tokenEstimate: number; turnCount: number },
  config: { personality: string; character: string; datadogEnabled: boolean }
): Promise<Checkpoint> {
  await ensureCheckpointsDir();
  
  const id = `checkpoint_${Date.now()}`;
  const checkpoint: Checkpoint = {
    id,
    name,
    summary,
    createdAt: Date.now(),
    turnCount: stats.turnCount,
    tokenEstimate: stats.tokenEstimate,
    personality: config.personality,
    character: config.character,
    datadogEnabled: config.datadogEnabled,
    messages: serializeMessages(messages),
  };
  
  const filepath = join(getCheckpointsDir(), `${id}.json`);
  await writeFile(filepath, JSON.stringify(checkpoint, null, 2));
  
  return checkpoint;
}

/**
 * List all checkpoints
 */
export async function listCheckpoints(): Promise<Checkpoint[]> {
  await ensureCheckpointsDir();
  const dir = getCheckpointsDir();
  
  const files = await readdir(dir);
  const checkpoints: Checkpoint[] = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const checkpoint = JSON.parse(content) as Checkpoint;
      checkpoints.push(checkpoint);
    } catch {
      // Skip invalid files
    }
  }
  
  // Sort by creation date, newest first
  return checkpoints.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Load a checkpoint by ID
 */
export async function loadCheckpoint(id: string): Promise<Checkpoint | null> {
  const filepath = join(getCheckpointsDir(), `${id}.json`);
  
  if (!existsSync(filepath)) {
    return null;
  }
  
  try {
    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content) as Checkpoint;
  } catch {
    return null;
  }
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(id: string): Promise<boolean> {
  const filepath = join(getCheckpointsDir(), `${id}.json`);
  
  if (!existsSync(filepath)) {
    return false;
  }
  
  try {
    await unlink(filepath);
    return true;
  } catch {
    return false;
  }
}


