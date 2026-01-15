// Module exports for dynamic prompt assembly
// NOTE: efficiency.ts deleted - efficiencyRulesModule is the single source now

import { getBasePrompt } from './base.js';
import { greetingModule } from './greeting.js';
import { tasksModule } from './tasks.js';
import { jiraModule } from './jira.js';
import { filesModule } from './files.js';
import { contextParsingModule } from './context-parsing.js';
import { cursorPatternsModule } from './cursor-patterns.js';
import { cursorRecoveryModule } from './cursor-recovery.js';
import { efficiencyRulesModule } from './efficiency-rules.js';
import { taskDecompositionModule } from './task-decomposition.js';
import { prTrackingCoreModule } from './pr-tracking-core.js';
import { prTrackingExamplesModule } from './pr-tracking-examples.js';
import { slackModule } from './slack.js';
import { slackScrollingModule } from './slack-scrolling.js';
import { githubExamplesModule } from './github-examples.js';
import { workflowPatternsModule } from './workflow-patterns.js';
import { webModule } from './web.js';

// Re-export all modules
// NOTE: efficiencyModule removed (use efficiencyRulesModule)
// NOTE: cursorBasicsModule and cursorCLIModule removed (consolidated into cursor.ts)
export { 
  getBasePrompt, 
  greetingModule, 
  tasksModule, 
  jiraModule, 
  filesModule, 
  contextParsingModule,
  cursorPatternsModule,
  cursorRecoveryModule,
  efficiencyRulesModule,
  taskDecompositionModule,
  prTrackingCoreModule,
  prTrackingExamplesModule,
  slackModule,
  slackScrollingModule,
  githubExamplesModule,
  workflowPatternsModule,
  webModule
};

// Module type for classifier output
// NOTE: 'efficiency' now maps to efficiencyRulesModule
// NOTE: 'cursor_basics' and 'cursor_cli' consolidated into 'cursor' (loaded from cursor.ts)
export type PromptModule = 
  | 'greeting'
  | 'tasks' 
  | 'jira'
  | 'files'
  | 'efficiency'
  | 'efficiency_rules'
  | 'task_decomposition'
  | 'context_parsing'
  | 'slack'
  | 'cursor'
  | 'cursor_basics'  // Maps to cursor (consolidated)
  | 'cursor_patterns'
  | 'cursor_cli'     // Maps to cursor (consolidated)
  | 'cursor_recovery'
  | 'investigation'
  | 'datadog'
  | 'pdp'
  | 'infra'
  | 'pr_tracking'
  | 'pr_tracking_core'
  | 'pr_tracking_examples'
  | 'github_examples'
  | 'task_executor'
  | 'linkedin_cv'
  | 'workflow_patterns'
  | 'web';

// Get module content by name
export function getModuleContent(module: PromptModule): string {
  switch (module) {
    case 'greeting': return greetingModule;
    case 'tasks': return tasksModule;
    case 'jira': return jiraModule;
    case 'files': return filesModule;
    case 'efficiency': return efficiencyRulesModule;  // Consolidated
    case 'efficiency_rules': return efficiencyRulesModule;
    case 'task_decomposition': return taskDecompositionModule;
    case 'context_parsing': return contextParsingModule;
    case 'slack': return slackModule + '\n\n' + slackScrollingModule;
    case 'cursor_patterns': return cursorPatternsModule;
    case 'cursor_recovery': return cursorRecoveryModule;
    case 'pr_tracking_core': return prTrackingCoreModule;
    case 'pr_tracking_examples': return prTrackingExamplesModule;
    case 'github_examples': return githubExamplesModule;
    case 'workflow_patterns': return workflowPatternsModule;
    case 'web': return webModule;
    // cursor_basics and cursor_cli are consolidated - handled in prompts/index.ts
    default:
      // Other modules are loaded from their own files in prompts/
      return '';
  }
}

