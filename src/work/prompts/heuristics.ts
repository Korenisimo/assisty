// Heuristic module detection for fast, cheap pattern matching
// Runs before LLM classification to catch obvious cases

import { PromptModule } from './modules/index.js';

export interface HeuristicResult {
  modules: PromptModule[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

/**
 * Fast pattern-based module detection using regex
 * Returns modules that should be loaded based on obvious signals in the message
 */
export function getHeuristicModules(message: string): HeuristicResult {
  const modules: PromptModule[] = [];
  const signals: string[] = [];
  
  // Check upfront if this is a Cursor-focused request (to skip irrelevant modules)
  const isCursorFocused = /\b(use cursor|cursor.*look|have cursor|let cursor)\b/i.test(message);
  
  // Slack signals - be conservative to avoid false positives on pasted conversations
  const slackPatterns = [
    /slack\.com/i,
    /\b(DM|direct message)\b/i,
    /(send|post|reply|write).*message/i,
    /(check|read|look|scan).*channel/i,
    /\bslack\b/i,
    // Only match "X asked/said" at START of message (not in pasted content)
    /^[^.]{0,50}\b(asked|said|mentioned)\b/i, // "Nikki asked" at start, not deep in pasted text
  ];
  // Skip Slack if message is primarily about Cursor handoff
  if (slackPatterns.some(p => p.test(message)) && !isCursorFocused) {
    modules.push('slack');
    signals.push('slack-related');
  }
  
  // JIRA signals - distinctive ticket pattern
  const jiraPatterns = [
    /\b[A-Z]+-\d+\b/, // JIRA-123, PROJ-456 format
    /atlassian\.net/i,
    /jira.*ticket/i,
    /(create|update|check).*ticket/i,
    /\bjira\b/i,
  ];
  if (jiraPatterns.some(p => p.test(message))) {
    modules.push('jira');
    signals.push('jira-related');
  }
  
  // GitHub signals
  const githubPatterns = [
    /github\.com/i,
    /\bPR\b|\bpull request\b/i,
    /github.*issue/i,
    /(merge|review).*pr/i,
  ];
  if (githubPatterns.some(p => p.test(message))) {
    modules.push('cursor'); // GitHub work often needs cursor (consolidated module)
    signals.push('github-related');
  }
  
  // Investigation signals - require STRONG indicators, not just "error" anywhere
  const investigationPatterns = [
    /\b(alert|incident|outage)\b/i,      // Strong: these specifically mean investigation
    /\bdatadog\b/i,                        // Strong: explicit Datadog mention
    /(search|query).*logs/i,               // Strong: explicitly asking for logs
    /\binvestigat(e|ion)\b/i,              // Strong: explicit investigation request
    /why.*(failing|broken|down)/i,         // Strong: asking about failure
    /error rate|success rate/i,            // Strong: metrics investigation
  ];
  // Skip investigation if message is primarily about Cursor handoff (isCursorFocused already defined above)
  if (investigationPatterns.some(p => p.test(message)) && !isCursorFocused) {
    modules.push('investigation');
    modules.push('datadog');
    signals.push('investigation-related');
  }
  
  // URL signals - need context-parsing module
  const hasUrl = /https?:\/\/\S+/.test(message);
  if (hasUrl && !modules.includes('context_parsing')) {
    modules.push('context_parsing');
    signals.push('contains-url');
  }
  
  // Cursor/codebase signals - explicit delegation, code work, OR code questions
  const cursorPatterns = [
    /\b(cursor|into cursor|to cursor|have cursor|let cursor|use cursor)\b/i,
    /(fix|implement|refactor|update).*code/i,
    /\bcodebase\b/i,
    /(grep|search).*function/i,
    /what.*(call|invoke|trigger)s?\b/i,     // "what calls X?", "what is calling Y?"
    /where.*(defined|used|called|implemented)/i, // "where is X defined?"
    /how does.*work/i,                       // "how does X work?"
    /find.*(code|function|method|class)/i,   // "find the code that..."
  ];
  if (cursorPatterns.some(p => p.test(message))) {
    modules.push('cursor'); // Consolidated cursor module (includes basics + cli)
    signals.push('codebase-work');
  }
  
  // PDP/performance review signals
  const pdpPatterns = [
    /\b(pdp|goal|achievement|review|performance|promotion)\b/i,
    /receipt/i,
  ];
  if (pdpPatterns.some(p => p.test(message))) {
    modules.push('pdp');
    signals.push('pdp-related');
  }
  
  // Infrastructure signals - require explicit infra commands, not just "db" in conversation
  const infraPatterns = [
    /\b(kube|kubernetes|pod)\b/i,           // Strong: k8s specific
    /\b(database|db).*(proxy|connect|login|forward)/i, // Strong: explicit DB operations
    /port.?forward/i,                        // Strong: explicit port forwarding
    /\b(tsh|kubectl)\b/i,                    // Strong: CLI tools
    /namespace/i,                            // Strong: k8s concept
  ];
  // Skip infra if Cursor-focused or if "db" appears in casual context (like "db error")
  if (infraPatterns.some(p => p.test(message)) && !isCursorFocused) {
    modules.push('infra');
    signals.push('infra-related');
  }
  
  // PR tracking signals
  const prTrackingPatterns = [
    /watch.*pr|pr.*watch/i,
    /\b(ci|cicd|ci\/cd|pipeline)\b/i,
    /(check|verify|monitor|track).*pr/i,
    /circleci|github.?actions/i,
  ];
  if (prTrackingPatterns.some(p => p.test(message))) {
    modules.push('pr_tracking_core');
    signals.push('pr-tracking-related');
  }
  
  // Task execution signals
  const taskExecutorPatterns = [
    /work.*on.*tasks?/i,
    /do.*my.*tasks?/i,
    /execute.*tasks?/i,
    /autonomous/i,
  ];
  if (taskExecutorPatterns.some(p => p.test(message))) {
    modules.push('task_executor');
    signals.push('task-execution-related');
  }
  
  // LinkedIn/CV signals
  const linkedinPatterns = [
    /\b(linkedin|cv|resume)\b/i,
    /profile.*review/i,
    /update.*profile/i,
    /professional.*profile/i,
  ];
  if (linkedinPatterns.some(p => p.test(message))) {
    modules.push('linkedin_cv');
    signals.push('linkedin-related');
  }
  
  // Determine confidence based on number of modules matched
  // More matches = higher confidence that we caught the intent
  const confidence = modules.length >= 2 ? 'high' : modules.length === 1 ? 'medium' : 'low';
  
  // Deduplicate modules
  const uniqueModules = [...new Set(modules)];
  
  return {
    modules: uniqueModules,
    confidence,
    reasoning: signals.length > 0 ? signals.join(', ') : 'no strong signals',
  };
}

