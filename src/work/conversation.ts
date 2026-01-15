// Conversation management with token tracking

import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

export interface ConversationState {
  messages: BaseMessage[];
  tokenEstimate: number;
  turnCount: number;
}

// Rough token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageToText(msg: BaseMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  return JSON.stringify(msg.content);
}

export function createConversation(systemPrompt: string): ConversationState {
  const systemMessage = new SystemMessage(systemPrompt);
  return {
    messages: [systemMessage],
    tokenEstimate: estimateTokens(systemPrompt),
    turnCount: 0,
  };
}

export function addUserMessage(state: ConversationState, content: string): ConversationState {
  const message = new HumanMessage(content);
  const tokens = estimateTokens(content);
  
  return {
    messages: [...state.messages, message],
    tokenEstimate: state.tokenEstimate + tokens,
    turnCount: state.turnCount,
  };
}

export function addAssistantMessage(state: ConversationState, message: AIMessage): ConversationState {
  const tokens = estimateTokens(messageToText(message));
  
  return {
    messages: [...state.messages, message],
    tokenEstimate: state.tokenEstimate + tokens,
    turnCount: state.turnCount + 1,
  };
}

export function addMessages(state: ConversationState, messages: BaseMessage[]): ConversationState {
  let totalTokens = 0;
  let aiMessageCount = 0;
  for (const msg of messages) {
    totalTokens += estimateTokens(messageToText(msg));
    // Count AI messages for turn tracking
    if (msg._getType?.() === 'ai' || msg.constructor?.name === 'AIMessage') {
      aiMessageCount++;
    }
  }
  
  return {
    messages: [...state.messages, ...messages],
    tokenEstimate: state.tokenEstimate + totalTokens,
    turnCount: state.turnCount + (aiMessageCount > 0 ? 1 : 0),
  };
}

export function resetConversation(systemPrompt: string): ConversationState {
  return createConversation(systemPrompt);
}

export function getTokenStats(state: ConversationState): {
  estimated: number;
  turns: number;
  messageCount: number;
} {
  return {
    estimated: state.tokenEstimate,
    turns: state.turnCount,
    messageCount: state.messages.length,
  };
}

// Helper to check if a message is a tool message using _getType (cross-module safe)
function isToolMessage(msg: BaseMessage): boolean {
  return msg._getType?.() === 'tool';
}

// Helper to check if a message is an AI message with tool calls
function isAIWithToolCalls(msg: BaseMessage): boolean {
  if (msg._getType?.() !== 'ai') return false;
  const aiMsg = msg as AIMessage;
  return !!(aiMsg.tool_calls && aiMsg.tool_calls.length > 0);
}

// Find a safe cut point that doesn't leave orphan tool messages
// Returns the index where we should start keeping messages (after system message)
function findSafeCutPoint(messages: BaseMessage[], targetCutIndex: number): number {
  // If target is at start, nothing to cut
  if (targetCutIndex <= 1) return 1;
  
  // Scan from target cut point backwards to find if we're in the middle of an AI+Tool sequence
  // We need to check if the message at targetCutIndex is a Tool message
  // If so, we need to either include the preceding AI message or skip the tools
  
  let cutIndex = targetCutIndex;
  
  // If starting with tool messages, scan backwards to find the AI message that triggered them
  while (cutIndex < messages.length && isToolMessage(messages[cutIndex])) {
    // We're starting with orphan tools - move forward to skip them
    cutIndex++;
  }
  
  // If we moved past all remaining messages, there's nothing valid to keep
  if (cutIndex >= messages.length) {
    // Fall back to keeping at least some messages - find the last complete sequence
    cutIndex = targetCutIndex;
  }
  
  // Now verify we're not cutting in the middle of a sequence
  // Check if the message BEFORE our cut point is an AI with unanswered tool_calls
  if (cutIndex > 1) {
    const prevMsg = messages[cutIndex - 1];
    if (isAIWithToolCalls(prevMsg)) {
      // The AI message before our cut has tool_calls
      // Check if those tool_calls are answered by messages after the cut
      const aiMsg = prevMsg as AIMessage;
      const expectedToolIds = new Set(aiMsg.tool_calls?.map(tc => tc.id || '') || []);
      
      // Count how many tool responses follow
      let toolResponseCount = 0;
      for (let i = cutIndex; i < messages.length && isToolMessage(messages[i]); i++) {
        toolResponseCount++;
      }
      
      // If the tools after our cut belong to the AI before, we need to include the AI
      if (toolResponseCount > 0 && toolResponseCount <= expectedToolIds.size) {
        // Move cut point back to include the AI message
        cutIndex--;
      }
    }
  }
  
  return cutIndex;
}

// Trim conversation if it gets too long (keep system + last N messages)
// IMPORTANT: Respects message boundaries - never cuts between AI(with tool_calls) and its Tool responses
export function trimConversation(
  state: ConversationState,
  maxMessages: number = 50
): ConversationState {
  if (state.messages.length <= maxMessages) {
    return state;
  }
  
  // Calculate where we ideally want to cut (keeping last N-1 messages after system)
  const idealCutIndex = state.messages.length - (maxMessages - 1);
  
  // Find a safe cut point that respects message boundaries
  const safeCutIndex = findSafeCutPoint(state.messages, idealCutIndex);
  
  // Keep system message + messages from safe cut point onwards
  const systemMessage = state.messages[0];
  const recentMessages = state.messages.slice(safeCutIndex);
  const trimmedMessages = [systemMessage, ...recentMessages];
  
  // Recalculate tokens
  let tokens = 0;
  for (const msg of trimmedMessages) {
    tokens += estimateTokens(messageToText(msg));
  }
  
  return {
    messages: trimmedMessages,
    tokenEstimate: tokens,
    turnCount: state.turnCount,
  };
}




