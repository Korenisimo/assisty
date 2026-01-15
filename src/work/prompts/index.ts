// Modular prompt system - loads context on demand based on request type

import { PersonalityConfig, CharacterConfig } from '../types.js';
import { getCorePrompt } from './core.js';
import { cursorContext } from './cursor.js';
import { investigationContext } from './investigation.js';
import { datadogContext } from './datadog.js';
import { pdpContext } from './pdp.js';
import { infraContext } from './infra.js';
import { prTrackingContext } from './pr-tracking.js';
import { taskExecutorContext } from './task-executor.js';
import { linkedinCVContext } from './linkedin-cv.js';
import { getKnowledgeForPrompt } from '../tools/infrastructure.js';
import { getWorkspaceContextForPrompt } from '../storage.js';
import { getMemoriesForPrompt } from '../tools/memory.js';
import { getAdviceConfigForPrompt } from '../storage/advice.js';
import { 
  getBasePrompt, 
  getModuleContent, 
  PromptModule,
  greetingModule,
  tasksModule,
  jiraModule,
  filesModule,
  contextParsingModule,
  slackModule,
  cursorPatternsModule,
  cursorRecoveryModule,
  efficiencyRulesModule,
  taskDecompositionModule,
  prTrackingCoreModule,
  prTrackingExamplesModule,
  githubExamplesModule,
  workflowPatternsModule,
} from './modules/index.js';
import { classifyIntent, ClassificationResult } from './classifier.js';
import { getHeuristicModules } from './heuristics.js';

export type ContextType = 'cursor' | 'investigation' | 'datadog' | 'pdp' | 'infra' | 'pr_tracking' | 'task_executor' | 'linkedin_cv';

// Re-export classifier types
export { classifyIntent, ClassificationResult } from './classifier.js';
export { PromptModule } from './modules/index.js';
export { getHeuristicModules } from './heuristics.js';

/**
 * Detect what context modules are needed based on user message
 * IMPORTANT: When user explicitly asks for Cursor, minimize other modules
 */
export function detectContextTypes(message: string): ContextType[] {
  const types: ContextType[] = [];
  const lower = message.toLowerCase();
  
  // Explicit Cursor delegation request - HIGHEST PRIORITY
  // When user says "use cursor", that's THE intent - don't load other modules
  const isCursorFocused = /\b(use cursor|cursor.*look|have cursor|let cursor|cursor.*work)\b/i.test(lower);
  
  if (isCursorFocused) {
    types.push('cursor');
    // Return ONLY cursor when explicit - don't add investigation/infra/etc
    return types;
  }
  
  // Cursor/code context (implicit - code-related keywords)
  if (/\b(code|implement|refactor|codebase|source|grep|find.*function|class|method)\b/i.test(lower)) {
    types.push('cursor');
  }
  
  // Investigation context - only if not cursor-focused
  if (/\b(alert|incident|investigate|investigation|outage|error rate|success rate)\b/i.test(lower)) {
    types.push('investigation');
  }
  
  // PDP/achievements context
  if (/\b(pdp|goal|achievement|review|performance|receipt|promotion)\b/i.test(lower)) {
    types.push('pdp');
  }
  
  // Infrastructure context
  if (/\b(kube|kubernetes|pod|database|db|proxy|port.?forward|tsh|kubectl|namespace)\b/i.test(lower)) {
    types.push('infra');
  }
  
  // PR tracking context
  if (/\b(watch.*pr|pr.*watch|ci|cicd|ci\/cd|pipeline|check.*pr|pr.*check|circleci|github.?actions|squash|pr.?#?\d+|poll.*pr|verify.*pr|monitor.*pr|track.*pr)\b/i.test(lower)) {
    types.push('pr_tracking');
  }
  
  // Task executor context
  if (/\b(work.*on.*tasks?|do.*my.*tasks?|execute.*tasks?|complete.*tasks?|handle.*my.*tasks?|autonomous|start.*to.*finish)\b/i.test(lower)) {
    types.push('task_executor');
  }
  
  // LinkedIn & CV context
  if (/\b(linkedin|cv|resume|profile.*review|update.*profile|professional.*profile|career.*profile)\b/i.test(lower)) {
    types.push('linkedin_cv');
  }
  
  return types;
}

/**
 * Get context module content by type
 */
function getContextModule(type: ContextType): string {
  switch (type) {
    case 'cursor': return cursorContext;
    case 'investigation': return investigationContext;
    case 'datadog': return datadogContext;
    case 'pdp': return pdpContext;
    case 'infra': return infraContext;
    case 'pr_tracking': return prTrackingContext;
    case 'task_executor': return taskExecutorContext;
    case 'linkedin_cv': return linkedinCVContext;
  }
}

/**
 * Build the full system prompt with core + relevant context modules
 */
export async function buildSystemPrompt(
  personality: PersonalityConfig,
  character: CharacterConfig,
  contextTypes: ContextType[],
  includeDatadog: boolean
): Promise<string> {
  // Always start with core
  let prompt = await getCorePrompt(personality, character);
  
  // Add detected context modules
  for (const type of contextTypes) {
    prompt += '\n' + getContextModule(type);
  }
  
  // Add datadog context if enabled (regardless of detection)
  if (includeDatadog && !contextTypes.includes('datadog')) {
    prompt += '\n' + datadogContext;
  }
  
  // Add infrastructure knowledge if any
  const infraKnowledge = await getKnowledgeForPrompt();
  if (infraKnowledge) {
    prompt += '\n' + infraKnowledge;
  }
  
  // Add persisted workspace context (repos, PRs, investigations from previous sessions)
  const workspaceContext = await getWorkspaceContextForPrompt();
  if (workspaceContext) {
    prompt += '\n' + workspaceContext;
  }
  
  return prompt;
}

/**
 * Minimal system prompt for initialization (before we have a user message)
 * Only loads the minimal core (~100 tokens) - all other context loaded on demand
 */
export async function getInitialSystemPrompt(
  personality: PersonalityConfig,
  character: CharacterConfig,
  _includeDatadog: boolean  // kept for API compatibility
): Promise<string> {
  // MINIMAL: Just core prompt - modules loaded when we have user message
  return await getCorePrompt(personality, character);
}

/**
 * Build a focused system prompt using 3-tier loading strategy:
 * - Tier 1: Core base prompt (always loaded)
 * - Tier 2: Heuristic-detected modules (fast pattern matching)
 * - Tier 3: Classification-based modules (LLM-detected, skip if already loaded)
 * 
 * This approach ensures critical guidance is loaded even if classification misses intent,
 * while avoiding duplicate module loading and keeping token usage reasonable.
 */
export async function buildModularPrompt(
  personality: PersonalityConfig,
  character: CharacterConfig,
  userMessage: string,
  classification: ClassificationResult,
  includeDatadog: boolean
): Promise<string> {
  // TIER 1: Core base prompt (always loaded)
  let prompt = getBasePrompt(personality, character);
  
  // Track which modules we've already loaded to avoid duplicates
  const loadedModules = new Set<PromptModule>();
  
  // TIER 2: Heuristic modules (cheap pattern matching - catches obvious cases)
  const heuristicResult = getHeuristicModules(userMessage);
  for (const module of heuristicResult.modules) {
    const content = getModuleContentByName(module);
    if (content) {
      prompt += '\n' + content;
      loadedModules.add(module);
    }
  }
  
  // TIER 3: Classification modules (LLM-based - skip if already loaded)
  for (const module of classification.modules) {
    if (!loadedModules.has(module)) {
      const content = getModuleContentByName(module);
      if (content) {
        prompt += '\n' + content;
        loadedModules.add(module);
      }
    }
  }
  
  // Add datadog context ONLY if enabled AND (datadog module requested OR investigation intent)
  // Check both heuristic and classification results
  const needsDatadog = includeDatadog && (
    loadedModules.has('datadog') || 
    classification.intent === 'investigation'
  );
  
  if (needsDatadog && !loadedModules.has('datadog')) {
    prompt += '\n' + datadogContext;
  }
  
  // Add memories (kept minimal)
  const memoriesSection = await getMemoriesForPrompt();
  if (memoriesSection) {
    prompt += '\n' + memoriesSection;
  }
  
  // Add workspace context for non-greeting intents
  if (classification.intent !== 'greeting') {
    const workspaceContext = await getWorkspaceContextForPrompt();
    if (workspaceContext) {
      prompt += '\n' + workspaceContext;
    }
    
    // Add infrastructure knowledge only if infra module detected (from either tier)
    if (loadedModules.has('infra')) {
      const infraKnowledge = await getKnowledgeForPrompt();
      if (infraKnowledge) {
        prompt += '\n' + infraKnowledge;
      }
    }
    
    // Add advice monitoring configuration only if Slack module is loaded
    // This gives context about what channels are being monitored
    if (loadedModules.has('slack')) {
      const adviceContext = getAdviceConfigForPrompt();
      if (adviceContext) {
        prompt += '\n' + adviceContext;
      }
    }
  }
  
  return prompt;
}

/**
 * Get module content by name (includes both new modules and legacy context modules)
 * NOTE: efficiency and efficiency_rules now both use efficiencyRulesModule
 * NOTE: cursor_basics and cursor_cli consolidated into cursor (cursorContext)
 */
function getModuleContentByName(module: PromptModule): string {
  switch (module) {
    // New focused modules
    case 'greeting': return greetingModule;
    case 'tasks': return tasksModule;
    case 'jira': return jiraModule;
    case 'files': return filesModule;
    case 'efficiency': return efficiencyRulesModule;      // Consolidated
    case 'efficiency_rules': return efficiencyRulesModule;
    case 'task_decomposition': return taskDecompositionModule;
    case 'context_parsing': return contextParsingModule;
    case 'slack': return slackModule;
    case 'workflow_patterns': return workflowPatternsModule;
    
    // Cursor sub-modules (basics and cli consolidated into cursorContext)
    case 'cursor_basics': return cursorContext;  // Consolidated
    case 'cursor_patterns': return cursorPatternsModule;
    case 'cursor_cli': return cursorContext;     // Consolidated
    case 'cursor_recovery': return cursorRecoveryModule;
    
    // PR tracking sub-modules
    case 'pr_tracking_core': return prTrackingCoreModule;
    case 'pr_tracking_examples': return prTrackingExamplesModule;
    
    // GitHub sub-modules
    case 'github_examples': return githubExamplesModule;
    
    // Legacy context modules
    case 'cursor': return cursorContext;
    case 'investigation': return investigationContext;
    case 'datadog': return datadogContext;
    case 'pdp': return pdpContext;
    case 'infra': return infraContext;
    case 'pr_tracking': return prTrackingContext;
    case 'task_executor': return taskExecutorContext;
    case 'linkedin_cv': return linkedinCVContext;
    
    default: return '';
  }
}

