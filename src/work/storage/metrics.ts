// Tone correction metrics storage
// Logs tone-related corrections to measure assistant improvement

import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// ===== TYPES =====

export type ToneCorrectionCategory = 'formality' | 'brevity' | 'style' | 'greeting';

export interface ToneCorrectionLog {
  timestamp: number;
  conversationId: string;
  draftContext: string; // "Slack message", "JIRA comment", etc.
  category: ToneCorrectionCategory;
  userCorrection: string; // Exact user message
  iterationNumber: number; // 1st, 2nd, 3rd correction
  assistantResponse: string; // Truncated draft that got corrected (max 500 chars)
}

export interface ToneDetectionResult {
  isCorrection: boolean;
  category?: ToneCorrectionCategory;
  matchedPattern?: string;
}

// ===== DETECTION PATTERNS =====

const TONE_PATTERNS: Record<ToneCorrectionCategory, RegExp> = {
  formality: /less formal|more casual|too formal|less professional|more laid.?back/i,
  brevity: /shorter|more concise|too long|too verbose|cut.*down|more brief|trim/i,
  style: /remove|skip|don't say|less.*sounding|more.*friendly|don't use/i,
  greeting: /no cheers|skip.*greeting|remove.*regards|no.*closing|skip.*signature/i,
};

/**
 * Detect if a user message contains tone correction feedback
 */
export function detectToneCorrection(userMessage: string): ToneDetectionResult {
  for (const [category, pattern] of Object.entries(TONE_PATTERNS)) {
    if (pattern.test(userMessage)) {
      return {
        isCorrection: true,
        category: category as ToneCorrectionCategory,
        matchedPattern: pattern.toString(),
      };
    }
  }
  
  return { isCorrection: false };
}

// ===== STORAGE =====

function getMetricsDir(): string {
  return join(process.cwd(), 'WORK_DIRS', 'metrics');
}

function getToneCorrectionLogPath(): string {
  return join(getMetricsDir(), 'tone-corrections.jsonl');
}

/**
 * Ensure metrics directory exists
 */
async function ensureMetricsDir(): Promise<void> {
  const metricsDir = getMetricsDir();
  if (!existsSync(metricsDir)) {
    await mkdir(metricsDir, { recursive: true });
  }
}

/**
 * Log a tone correction event
 */
export async function logToneCorrection(log: ToneCorrectionLog): Promise<void> {
  try {
    await ensureMetricsDir();
    const logPath = getToneCorrectionLogPath();
    
    // Truncate assistant response if too long
    const truncatedLog = {
      ...log,
      assistantResponse: log.assistantResponse.length > 500 
        ? log.assistantResponse.substring(0, 500) + '...[truncated]'
        : log.assistantResponse,
    };
    
    // Append as JSONL (one JSON object per line)
    const line = JSON.stringify(truncatedLog) + '\n';
    await appendFile(logPath, line, 'utf-8');
  } catch (error) {
    // Silent fail - don't disrupt normal operation
    console.error('[Metrics] Failed to log tone correction:', error);
  }
}

/**
 * Read all tone correction logs
 */
export async function readToneCorrectionLogs(): Promise<ToneCorrectionLog[]> {
  const logPath = getToneCorrectionLogPath();
  
  if (!existsSync(logPath)) {
    return [];
  }
  
  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((log): log is ToneCorrectionLog => log !== null);
  } catch (error) {
    console.error('[Metrics] Failed to read tone correction logs:', error);
    return [];
  }
}

/**
 * Get conversation-specific metrics
 * Tracks iteration count within a conversation
 */
export interface ConversationMetrics {
  conversationId: string;
  toneCorrections: ToneCorrectionLog[];
  iterationCount: number;
  lastCorrectionTime?: number;
}

const conversationMetricsCache = new Map<string, ConversationMetrics>();

/**
 * Get or create conversation metrics
 */
export function getConversationMetrics(conversationId: string): ConversationMetrics {
  if (!conversationMetricsCache.has(conversationId)) {
    conversationMetricsCache.set(conversationId, {
      conversationId,
      toneCorrections: [],
      iterationCount: 0,
    });
  }
  
  return conversationMetricsCache.get(conversationId)!;
}

/**
 * Record a tone correction for a conversation
 */
export async function recordToneCorrection(
  conversationId: string,
  category: ToneCorrectionCategory,
  userCorrection: string,
  assistantResponse: string,
  draftContext: string = 'unknown'
): Promise<void> {
  const metrics = getConversationMetrics(conversationId);
  metrics.iterationCount++;
  metrics.lastCorrectionTime = Date.now();
  
  const log: ToneCorrectionLog = {
    timestamp: Date.now(),
    conversationId,
    draftContext,
    category,
    userCorrection,
    iterationNumber: metrics.iterationCount,
    assistantResponse,
  };
  
  metrics.toneCorrections.push(log);
  
  // Persist to disk
  await logToneCorrection(log);
}

/**
 * Clear conversation metrics (e.g., on new conversation)
 */
export function clearConversationMetrics(conversationId: string): void {
  conversationMetricsCache.delete(conversationId);
}



