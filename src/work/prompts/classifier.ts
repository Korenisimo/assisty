// Intent classifier for dynamic prompt injection
// Uses minimal LLM call to determine what prompt modules are needed

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { PromptModule } from './modules/index.js';

export interface ClassificationResult {
  intent: 'greeting' | 'task_query' | 'code_task' | 'investigation' | 'api_query' | 'general';
  needsTools: boolean;
  modules: PromptModule[];
  confidence: number;
}

// Minimal classifier prompt (~250 tokens)
const CLASSIFIER_PROMPT = `Analyze this user message and respond with JSON only. No explanation.

{
  "intent": "greeting" | "task_query" | "code_task" | "investigation" | "api_query" | "general",
  "needs_tools": boolean,
  "modules": ["module_name", ...]
}

Available modules:
- greeting, tasks, jira, files, context_parsing
- efficiency_rules, task_decomposition
- slack
- cursor_basics, cursor_patterns, cursor_cli, cursor_recovery
- pr_tracking_core, pr_tracking_examples
- investigation, datadog, pdp, infra, task_executor

Rules:
- Casual greetings ("hey", "hi", "how are you") → {"intent": "greeting", "needs_tools": false, "modules": ["greeting"]}
- Slack/advice mentions ("scan slack", "watch channel", "advice") → include "slack"
- "cursor" explicitly mentioned → include cursor_basics + cursor_cli (always needed)
- "track and fix PR" → cursor_basics + cursor_patterns + cursor_cli + pr_tracking_core
- Complex multi-step tasks → include task_decomposition
- Simple "use Cursor" → just cursor_basics + cursor_cli (skip patterns)
- PR tracking questions → pr_tracking_core (skip examples unless confused)
- Tasks/todos/reminders → include "tasks"
- JIRA/ticket/investigate → include "jira", "investigation"  
- Code/implement/refactor → include cursor_basics, cursor_cli, files
- Most work requests → include efficiency_rules

Message: `;

// Cache recent classifications to avoid redundant calls
const classificationCache = new Map<string, { result: ClassificationResult; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Classify user message to determine needed prompt modules
 * Uses fast LLM call with minimal prompt
 */
export async function classifyIntent(
  message: string,
  model?: ChatGoogleGenerativeAI
): Promise<ClassificationResult> {
  // Check cache first
  const cacheKey = message.toLowerCase().trim();
  const cached = classificationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // Fast keyword-based fallback for very obvious cases
  const fastResult = fastClassify(message);
  if (fastResult.confidence >= 0.9) {
    classificationCache.set(cacheKey, { result: fastResult, timestamp: Date.now() });
    return fastResult;
  }

  // Use LLM for ambiguous cases
  if (!model) {
    // If no model provided, use fast classification
    return fastResult;
  }

  try {
    const response = await model.invoke(CLASSIFIER_PROMPT + message);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fastResult;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result: ClassificationResult = {
      intent: parsed.intent || 'general',
      needsTools: parsed.needs_tools ?? true,
      modules: (parsed.modules || []) as PromptModule[],
      confidence: 0.8,
    };

    // Ensure we always have efficiency_rules for non-greeting intents
    if (result.intent !== 'greeting' && !result.modules.includes('efficiency_rules')) {
      result.modules.push('efficiency_rules');
    }

    classificationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch {
    // Fallback to keyword-based on error
    return fastResult;
  }
}

/**
 * Fast keyword-based classification for obvious cases
 * Returns high confidence for clear patterns, lower for ambiguous
 */
function fastClassify(message: string): ClassificationResult {
  const lower = message.toLowerCase().trim();
  
  // Greeting patterns - very high confidence
  if (/^(hey|hi|hello|yo|sup|what'?s up|how are you|good morning|good afternoon|good evening|howdy)[\s\.,!?]*$/i.test(lower) ||
      /^(hey|hi|hello)\s+(there|mate|buddy|friend)[\s\.,!?]*$/i.test(lower)) {
    return {
      intent: 'greeting',
      needsTools: false,
      modules: ['greeting'],
      confidence: 0.95,
    };
  }

  // Explicit cursor request - high confidence
  if (/\b(cursor|into cursor|to cursor|have cursor|let cursor|use cursor)\b/i.test(lower)) {
    // Check if it's a complex task that needs patterns
    const needsPatterns = /\b(track.*fix|fix.*pr|implement.*push|complex|multi-step)\b/i.test(lower);
    const modules: PromptModule[] = needsPatterns 
      ? ['cursor_basics', 'cursor_patterns', 'cursor_cli', 'files', 'efficiency_rules']
      : ['cursor_basics', 'cursor_cli', 'files', 'efficiency_rules'];
    
    return {
      intent: 'code_task',
      needsTools: true,
      modules,
      confidence: 0.9,
    };
  }

  // Task-related - high confidence
  if (/\b(task|todo|reminder|my tasks|list tasks|update task|complete task)\b/i.test(lower)) {
    // Check if it's about complex task execution
    const needsDecomposition = /\b(work.*on.*tasks?|do.*my.*tasks?|execute.*tasks?|autonomous)\b/i.test(lower);
    const modules: PromptModule[] = needsDecomposition
      ? ['tasks', 'task_decomposition', 'efficiency_rules']
      : ['tasks', 'efficiency_rules'];
    
    return {
      intent: 'task_query',
      needsTools: true,
      modules,
      confidence: 0.85,
    };
  }

  // Investigation/incident - high confidence
  if (/\b(investigate|investigation|incident|alert|outage|error rate)\b/i.test(lower)) {
    return {
      intent: 'investigation',
      needsTools: true,
      modules: ['investigation', 'jira', 'datadog', 'efficiency_rules', 'context_parsing'],
      confidence: 0.85,
    };
  }

  // JIRA/ticket - medium-high confidence
  if (/\b(jira|ticket|backlog|sprint)\b/i.test(lower)) {
    return {
      intent: 'api_query',
      needsTools: true,
      modules: ['jira', 'efficiency_rules'],
      confidence: 0.8,
    };
  }

  // Code-related - medium confidence
  if (/\b(code|implement|refactor|codebase|source|grep|function|class|method|pr|pull request)\b/i.test(lower)) {
    // Check if it's a track-and-fix pattern
    const isTrackAndFix = /\b(track.*fix|fix.*pr|monitor.*pr)\b/i.test(lower);
    const modules: PromptModule[] = isTrackAndFix
      ? ['cursor_basics', 'cursor_patterns', 'cursor_cli', 'pr_tracking_core', 'files', 'efficiency_rules']
      : ['cursor_basics', 'cursor_cli', 'files', 'efficiency_rules'];
    
    return {
      intent: 'code_task',
      needsTools: true,
      modules,
      confidence: 0.75,
    };
  }

  // PDP/achievements - medium confidence  
  if (/\b(pdp|goal|achievement|review|performance|receipt|promotion)\b/i.test(lower)) {
    return {
      intent: 'api_query',
      needsTools: true,
      modules: ['pdp', 'efficiency_rules'],
      confidence: 0.8,
    };
  }

  // Infrastructure - medium confidence
  if (/\b(kube|kubernetes|pod|database|db|proxy|port.?forward|tsh|kubectl)\b/i.test(lower)) {
    return {
      intent: 'api_query',
      needsTools: true,
      modules: ['infra', 'efficiency_rules'],
      confidence: 0.8,
    };
  }
  
  // PR tracking - medium confidence
  if (/\b(watch.*pr|pr.*watch|ci|cicd|ci\/cd|pipeline|check.*pr|pr.*check)\b/i.test(lower)) {
    // Check if needs examples (first-time user or confusion)
    const needsExamples = /\b(how|what|explain|example)\b/i.test(lower);
    const modules: PromptModule[] = needsExamples
      ? ['pr_tracking_core', 'pr_tracking_examples', 'efficiency_rules']
      : ['pr_tracking_core', 'efficiency_rules'];
    
    return {
      intent: 'api_query',
      needsTools: true,
      modules,
      confidence: 0.8,
    };
  }

  // Slack/advice - medium-high confidence
  if (/\b(slack|advice|watch.*channel|scan.*slack|dm|slack.*channel|advice.*topic)\b/i.test(lower)) {
    return {
      intent: 'api_query',
      needsTools: true,
      modules: ['slack', 'efficiency_rules'],
      confidence: 0.85,
    };
  }

  // URL or link provided - add context parsing
  if (/https?:\/\/|www\./.test(lower)) {
    return {
      intent: 'general',
      needsTools: true,
      modules: ['context_parsing', 'efficiency_rules'],
      confidence: 0.7,
    };
  }

  // Default - general intent, needs LLM classification
  return {
    intent: 'general',
    needsTools: true,
    modules: ['efficiency_rules'],
    confidence: 0.5, // Low confidence triggers LLM call
  };
}

/**
 * Clear classification cache (useful for testing)
 */
export function clearClassificationCache(): void {
  classificationCache.clear();
}

