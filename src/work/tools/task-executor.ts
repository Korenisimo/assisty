// Task Executor - Autonomous task completion from start to finish
// Handles JIRA tickets and PRs, orchestrates Cursor, monitors CI

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  Task,
  getActiveTasks,
  getTasks,
  updateTask,
  completeTask,
  getTaskWithContext,
} from './tasks.js';
import {
  getTicket,
  isJiraConfigured,
} from '../clients/jira.js';
import {
  getPullRequest,
  listPullRequests,
  getPRChecks,
  isGitHubConfigured,
  GitHubPullRequest,
} from '../clients/github.js';
import {
  parsePRUrl,
  squashSessionCommits,
} from './pr-tracking.js';
import { prWatchManager } from './pr-watch-manager.js';
import { PRWatchEvent } from './pr-watch-types.js';
import {
  startCursorSessionWithProgress,
  getCursorSessionStatus,
} from './cursor.js';
import { cloneRepoToWorkspace } from './compound.js';
import { getWorkspace, runShellCommand } from './shell.js';

const execAsync = promisify(exec);

// ===== Types =====

export type TaskType = 'jira' | 'pr' | 'generic';

export interface AnalyzedTask {
  task: Task;
  type: TaskType;
  // For JIRA tasks
  jiraKey?: string;
  jiraTicket?: {
    key: string;
    summary: string;
    description?: string;
    status: string;
  };
  // For PR tasks
  prUrl?: string;
  pr?: GitHubPullRequest;
  // Detected/suggested repo
  suggestedRepo?: string;
  repoConfidence: 'high' | 'medium' | 'low' | 'none';
  // Execution readiness
  isActionable: boolean;
  missingInfo?: string[];
}

export interface ExecutionState {
  status: 'idle' | 'analyzing' | 'executing' | 'waiting_ci' | 'awaiting_user' | 'completed' | 'failed';
  currentTask?: AnalyzedTask;
  repoPath?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  startedAt?: number;
  error?: string;
  // For user choices
  pendingChoice?: 'prioritization' | 'repo_selection' | 'continue';
  choices?: string[];
}

export type ExecutionEvent =
  | { type: 'started'; task: AnalyzedTask }
  | { type: 'analyzing'; message: string }
  | { type: 'repo_detected'; repo: string; confidence: string }
  | { type: 'need_repo'; suggestions: string[] }
  | { type: 'cloning'; repo: string }
  | { type: 'branching'; branch: string }
  | { type: 'sending_to_cursor'; prompt: string }
  | { type: 'cursor_complete'; success: boolean }
  | { type: 'creating_pr'; title: string }
  | { type: 'pr_created'; url: string }
  | { type: 'watching_ci'; prNumber: number }
  | { type: 'ci_passed'; commitCount: number }
  | { type: 'ci_failed'; failure: string }
  | { type: 'task_complete'; task: Task }
  | { type: 'ask_continue'; nextTasks: Task[] }
  | { type: 'error'; error: string }
  | { type: 'stopped'; reason: string };

export type ExecutionCallback = (event: ExecutionEvent) => void;

// ===== Module State =====

let executionState: ExecutionState = { status: 'idle' };
let onEvent: ExecutionCallback | null = null;

// Known repos (can be expanded via memory/config)
const KNOWN_REPOS: Record<string, string> = {
  // Map keywords/project names to repo URLs
  // Add your repos here, e.g.:
  // 'my-service': 'https://github.com/acme/my-service',
};

// ===== Public API =====

/**
 * Get current execution state
 */
export function getExecutionState(): ExecutionState {
  return { ...executionState };
}

/**
 * Start task execution flow
 * Returns immediately - execution happens async
 */
export async function startTaskExecution(
  options: {
    taskId?: string;  // Specific task to execute
    userPrioritizes?: boolean;  // Let user pick task
    onEvent?: ExecutionCallback;
  } = {}
): Promise<{ started: boolean; error?: string; needsChoice?: 'prioritization' | 'task_selection' }> {
  if (executionState.status !== 'idle' && executionState.status !== 'completed' && executionState.status !== 'failed') {
    return { started: false, error: `Already executing (status: ${executionState.status})` };
  }

  onEvent = options.onEvent || null;

  // If no task specified and user wants to prioritize, return the choice
  if (!options.taskId && options.userPrioritizes) {
    const tasks = await getActiveTasks();
    if (tasks.length === 0) {
      return { started: false, error: 'No active tasks to work on' };
    }
    executionState = {
      status: 'awaiting_user',
      pendingChoice: 'prioritization',
      choices: tasks.map(t => t.id),
    };
    return { started: true, needsChoice: 'task_selection' };
  }

  // Get task to execute
  let task: Task | undefined;
  
  if (options.taskId) {
    const tasks = await getTasks();
    task = tasks.find(t => t.id === options.taskId);
    if (!task) {
      return { started: false, error: `Task ${options.taskId} not found` };
    }
  } else {
    // Auto-prioritize: urgent/high priority first, then by due date
    const tasks = await getActiveTasks();
    if (tasks.length === 0) {
      return { started: false, error: 'No active tasks to work on' };
    }
    task = tasks[0]; // Already sorted by priority in getTasks
  }

  // Start execution
  executeTask(task);
  
  return { started: true };
}

/**
 * Provide user choice (repo selection, task selection, etc.)
 */
export async function provideChoice(choice: string): Promise<{ success: boolean; error?: string }> {
  if (executionState.status !== 'awaiting_user') {
    return { success: false, error: 'Not awaiting user input' };
  }

  if (executionState.pendingChoice === 'repo_selection') {
    // User selected a repo
    if (executionState.currentTask) {
      executionState.currentTask.suggestedRepo = choice;
      executionState.currentTask.repoConfidence = 'high';
      executionState.status = 'executing';
      // Continue execution
      continueExecution();
    }
    return { success: true };
  }

  if (executionState.pendingChoice === 'prioritization') {
    // User selected a task
    const tasks = await getTasks();
    const task = tasks.find(t => t.id === choice);
    if (!task) {
      return { success: false, error: `Task ${choice} not found` };
    }
    executeTask(task);
    return { success: true };
  }

  if (executionState.pendingChoice === 'continue') {
    if (choice === 'yes' || choice === 'continue') {
      // Continue with next task
      const tasks = await getActiveTasks();
      if (tasks.length > 0) {
        executeTask(tasks[0]);
      } else {
        executionState = { status: 'idle' };
        emit({ type: 'stopped', reason: 'No more tasks' });
      }
    } else {
      executionState = { status: 'idle' };
      emit({ type: 'stopped', reason: 'User stopped' });
    }
    return { success: true };
  }

  return { success: false, error: 'Unknown choice type' };
}

/**
 * Stop current execution
 */
export function stopExecution(reason: string = 'User requested'): { stopped: boolean } {
  if (executionState.status === 'idle') {
    return { stopped: false };
  }

  // Stop any active PR watch
  prWatchManager.stopAll(reason);

  const prevState = executionState;
  executionState = { status: 'idle' };
  
  emit({ type: 'stopped', reason });
  
  return { stopped: true };
}

// ===== Internal Execution Logic =====

async function executeTask(task: Task): Promise<void> {
  executionState = {
    status: 'analyzing',
    startedAt: Date.now(),
  };

  // Mark task as in progress
  await updateTask(task.id, { status: 'in_progress' });

  // Analyze the task
  emit({ type: 'analyzing', message: 'Analyzing task type and requirements...' });
  const analyzed = await analyzeTask(task);
  executionState.currentTask = analyzed;

  emit({ type: 'started', task: analyzed });

  if (!analyzed.isActionable) {
    executionState.status = 'failed';
    executionState.error = `Task not actionable: ${analyzed.missingInfo?.join(', ')}`;
    emit({ type: 'error', error: executionState.error });
    return;
  }

  // Check if we need repo selection
  if (analyzed.repoConfidence === 'none' || analyzed.repoConfidence === 'low') {
    // Try to detect repo
    const suggestions = await detectRepoSuggestions(analyzed);
    if (suggestions.length === 0) {
      executionState.status = 'awaiting_user';
      executionState.pendingChoice = 'repo_selection';
      emit({ type: 'need_repo', suggestions: [] });
      return;
    } else if (suggestions.length === 1 && analyzed.repoConfidence !== 'none') {
      analyzed.suggestedRepo = suggestions[0];
      analyzed.repoConfidence = 'medium';
    } else {
      executionState.status = 'awaiting_user';
      executionState.pendingChoice = 'repo_selection';
      executionState.choices = suggestions;
      emit({ type: 'need_repo', suggestions });
      return;
    }
  }

  emit({ type: 'repo_detected', repo: analyzed.suggestedRepo!, confidence: analyzed.repoConfidence });

  executionState.status = 'executing';
  await continueExecution();
}

async function continueExecution(): Promise<void> {
  const analyzed = executionState.currentTask;
  if (!analyzed) return;

  try {
    if (analyzed.type === 'pr') {
      await executePRTask(analyzed);
    } else if (analyzed.type === 'jira') {
      await executeJiraTask(analyzed);
    } else {
      await executeGenericTask(analyzed);
    }
  } catch (error) {
    executionState.status = 'failed';
    executionState.error = error instanceof Error ? error.message : 'Unknown error';
    emit({ type: 'error', error: executionState.error });
  }
}

async function executePRTask(analyzed: AnalyzedTask): Promise<void> {
  if (!analyzed.prUrl || !analyzed.pr) {
    throw new Error('PR task missing PR URL or details');
  }

  const parsed = parsePRUrl(analyzed.prUrl);
  if (!parsed) {
    throw new Error('Invalid PR URL');
  }

  // Clone repo with branch for isolation (each workstream gets its own directory)
  const prBranch = analyzed.pr.head.ref;
  emit({ type: 'cloning', repo: parsed.repoUrl });
  const cloned = await cloneRepoToWorkspace(parsed.repoUrl, { branch: prBranch });
  executionState.repoPath = cloned.path;
  executionState.branch = prBranch;

  // Ensure we're on the correct branch (clone should already be on it)
  emit({ type: 'branching', branch: prBranch });
  await checkoutBranch(cloned.path, prBranch);

  // Check current CI status
  const checks = await getPRChecks(parsed.repoUrl, parsed.prNumber);
  
  if (checks.summary.failing > 0) {
    // There are failures - send to Cursor to fix
    const prompt = buildPRFixPrompt(analyzed.pr, checks);
    emit({ type: 'sending_to_cursor', prompt: prompt.substring(0, 200) + '...' });
    
    const response = await startCursorSessionWithProgress(prompt, cloned.path, { force: true });
    emit({ type: 'cursor_complete', success: response.success });

    if (response.success) {
      // Commit and push
      await commitAndPush(cloned.path, analyzed.pr.head.ref, `fix: address CI failures`);
    }
  } else if (checks.summary.pending > 0) {
    // CI still running - just start watching
    emit({ type: 'watching_ci', prNumber: parsed.prNumber });
  } else {
    // Already green!
    emit({ type: 'ci_passed', commitCount: 0 });
    await handleTaskComplete(analyzed.task);
    return;
  }

  // Start PR watch
  executionState.prNumber = parsed.prNumber;
  executionState.prUrl = analyzed.prUrl;
  executionState.status = 'waiting_ci';

  await prWatchManager.addPRWatch(parsed.repoUrl, parsed.prNumber, handlePREvent);
}

async function executeJiraTask(analyzed: AnalyzedTask): Promise<void> {
  if (!analyzed.jiraTicket || !analyzed.suggestedRepo) {
    throw new Error('JIRA task missing ticket or repo');
  }

  // Create branch name from JIRA key first (needed for isolated clone)
  const branchName = createBranchName(analyzed.jiraTicket.key, analyzed.jiraTicket.summary);

  // Clone repo with branch for isolation (each workstream gets its own directory)
  emit({ type: 'cloning', repo: analyzed.suggestedRepo });
  const cloned = await cloneRepoToWorkspace(analyzed.suggestedRepo, { branch: branchName });
  executionState.repoPath = cloned.path;
  executionState.branch = branchName;

  // Create/checkout branch (creates if doesn't exist, or checks out if it does)
  emit({ type: 'branching', branch: branchName });
  await createAndCheckoutBranch(cloned.path, branchName);

  // Build prompt for Cursor
  const prompt = buildJiraTaskPrompt(analyzed.jiraTicket);
  emit({ type: 'sending_to_cursor', prompt: prompt.substring(0, 200) + '...' });

  // Send to Cursor
  const response = await startCursorSessionWithProgress(prompt, cloned.path, { force: true });
  emit({ type: 'cursor_complete', success: response.success });

  if (!response.success) {
    throw new Error(`Cursor failed: ${response.error || 'Unknown error'}`);
  }

  // Commit changes
  await commitAndPush(cloned.path, branchName, `feat: ${analyzed.jiraTicket.key.toLowerCase()}: implement ${analyzed.jiraTicket.summary.toLowerCase().substring(0, 50)}`);

  // Create PR
  emit({ type: 'creating_pr', title: `${analyzed.jiraTicket.key}: ${analyzed.jiraTicket.summary}` });
  const prUrl = await createPullRequest(cloned.path, branchName, analyzed.jiraTicket);
  
  if (prUrl) {
    emit({ type: 'pr_created', url: prUrl });
    executionState.prUrl = prUrl;

    // Parse and start watching
    const parsed = parsePRUrl(prUrl);
    if (parsed) {
      executionState.prNumber = parsed.prNumber;
      executionState.status = 'waiting_ci';
      await prWatchManager.addPRWatch(parsed.repoUrl, parsed.prNumber, handlePREvent);
    }
  } else {
    // No PR created (maybe no changes?)
    await handleTaskComplete(analyzed.task);
  }
}

async function executeGenericTask(analyzed: AnalyzedTask): Promise<void> {
  // For generic tasks without clear JIRA/PR context
  // Just send to Cursor with task description
  
  if (!analyzed.suggestedRepo) {
    throw new Error('Generic task requires a repo');
  }

  // Generate branch name from task for isolation
  const taskSlug = analyzed.task.content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 30)
    .replace(/-+$/, '');
  const branchName = `task/${taskSlug}-${Date.now().toString(36).slice(-4)}`;

  emit({ type: 'cloning', repo: analyzed.suggestedRepo });
  const cloned = await cloneRepoToWorkspace(analyzed.suggestedRepo, { branch: branchName });
  executionState.repoPath = cloned.path;
  executionState.branch = branchName;

  const prompt = buildGenericTaskPrompt(analyzed.task);
  emit({ type: 'sending_to_cursor', prompt: prompt.substring(0, 200) + '...' });

  const response = await startCursorSessionWithProgress(prompt, cloned.path, { force: true, timeout: 600000 });
  emit({ type: 'cursor_complete', success: response.success });

  if (response.success) {
    await handleTaskComplete(analyzed.task);
  } else {
    throw new Error(`Cursor failed: ${response.error}`);
  }
}

// ===== Task Analysis =====

async function analyzeTask(task: Task): Promise<AnalyzedTask> {
  const analyzed: AnalyzedTask = {
    task,
    type: 'generic',
    repoConfidence: 'none',
    isActionable: false,
    missingInfo: [],
  };

  const content = task.content.toLowerCase();
  const fullContext = (await getTaskWithContext(task.id))?.fullContext || '';

  // Check for PR URL
  const prMatch = task.content.match(/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/) ||
                  fullContext.match(/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+/);
  if (prMatch) {
    analyzed.type = 'pr';
    analyzed.prUrl = `https://${prMatch[0]}`;
    const parsed = parsePRUrl(analyzed.prUrl);
    if (parsed) {
      try {
        const pr = await getPullRequest(parsed.repoUrl, parsed.prNumber);
        if (pr) {
          analyzed.pr = pr;
          analyzed.suggestedRepo = parsed.repoUrl;
          analyzed.repoConfidence = 'high';
          analyzed.isActionable = true;
        }
      } catch {
        analyzed.missingInfo = analyzed.missingInfo || [];
        analyzed.missingInfo.push('Could not fetch PR details');
      }
    }
    return analyzed;
  }

  // Check for JIRA key
  const jiraMatch = task.content.match(/([A-Z]+-\d+)/i) ||
                    fullContext.match(/([A-Z]+-\d+)/i);
  if (jiraMatch && isJiraConfigured()) {
    const jiraKey = jiraMatch[1].toUpperCase();
    try {
      const ticket = await getTicket(jiraKey);
      if (ticket) {
        analyzed.type = 'jira';
        analyzed.jiraKey = jiraKey;
        analyzed.jiraTicket = {
          key: ticket.key,
          summary: ticket.summary,
          description: ticket.description,
          status: ticket.status,
        };
        analyzed.isActionable = true;

        // Try to detect repo from ticket content
        const repoFromTicket = detectRepoFromText(ticket.summary + ' ' + (ticket.description || ''));
        if (repoFromTicket) {
          analyzed.suggestedRepo = repoFromTicket;
          analyzed.repoConfidence = 'medium';
        }
      }
    } catch {
      analyzed.missingInfo = analyzed.missingInfo || [];
      analyzed.missingInfo.push('Could not fetch JIRA ticket');
    }
    return analyzed;
  }

  // Generic task - try to find repo hints
  const repoFromContent = detectRepoFromText(task.content + ' ' + fullContext);
  if (repoFromContent) {
    analyzed.suggestedRepo = repoFromContent;
    analyzed.repoConfidence = 'low';
    analyzed.isActionable = true;
  } else {
    analyzed.missingInfo = analyzed.missingInfo || [];
    analyzed.missingInfo.push('Could not determine target repository');
  }

  return analyzed;
}

function detectRepoFromText(text: string): string | null {
  const lower = text.toLowerCase();
  
  // Check for GitHub URLs
  const urlMatch = text.match(/github\.com\/([\w-]+)\/([\w-]+)/);
  if (urlMatch) {
    return `https://github.com/${urlMatch[1]}/${urlMatch[2]}`;
  }

  // Check known repo keywords
  for (const [keyword, url] of Object.entries(KNOWN_REPOS)) {
    if (lower.includes(keyword)) {
      return url;
    }
  }

  return null;
}

async function detectRepoSuggestions(analyzed: AnalyzedTask): Promise<string[]> {
  const suggestions: string[] = [];

  // Add any already detected repo
  if (analyzed.suggestedRepo) {
    suggestions.push(analyzed.suggestedRepo);
  }

  // Check cloned repos
  const workspace = getWorkspace();
  const clonedReposDir = join(workspace, 'CLONED_REPOS');
  if (existsSync(clonedReposDir)) {
    try {
      const { stdout } = await execAsync('ls -1', { cwd: clonedReposDir });
      const repos = stdout.trim().split('\n').filter(r => r);
      for (const repo of repos) {
        // Try to get the remote URL
        try {
          const { stdout: remoteUrl } = await execAsync('git remote get-url origin', {
            cwd: join(clonedReposDir, repo)
          });
          const url = remoteUrl.trim();
          if (url && !suggestions.includes(url)) {
            suggestions.push(url);
          }
        } catch {
          // Ignore repos without remotes
        }
      }
    } catch {
      // Ignore errors
    }
  }

  return suggestions;
}

// ===== Git Operations =====

async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
  await execAsync('git fetch origin', { cwd: repoPath });
  try {
    await execAsync(`git checkout ${branch}`, { cwd: repoPath });
  } catch {
    await execAsync(`git checkout -b ${branch} origin/${branch}`, { cwd: repoPath });
  }
  await execAsync('git pull', { cwd: repoPath });
}

async function createAndCheckoutBranch(repoPath: string, branch: string): Promise<void> {
  await execAsync('git fetch origin', { cwd: repoPath });
  await execAsync('git checkout main || git checkout master', { cwd: repoPath });
  await execAsync('git pull', { cwd: repoPath });
  try {
    await execAsync(`git checkout -b ${branch}`, { cwd: repoPath });
  } catch {
    // Branch might exist
    await execAsync(`git checkout ${branch}`, { cwd: repoPath });
  }
}

async function commitAndPush(repoPath: string, branch: string, message: string): Promise<void> {
  const { stdout: status } = await execAsync('git status --porcelain', { cwd: repoPath });
  if (!status.trim()) {
    return; // Nothing to commit
  }
  
  await execAsync('git add .', { cwd: repoPath });
  await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: repoPath });
  await execAsync(`git push -u origin ${branch}`, { cwd: repoPath });
}

async function createPullRequest(
  repoPath: string,
  branch: string,
  jiraTicket: { key: string; summary: string; description?: string }
): Promise<string | null> {
  // Use gh CLI to create PR
  const title = `${jiraTicket.key}: ${jiraTicket.summary}`;
  const body = `## Summary\n\n${jiraTicket.description || jiraTicket.summary}\n\n---\n\nJIRA: ${jiraTicket.key}`;
  
  try {
    const { stdout } = await execAsync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head ${branch}`,
      { cwd: repoPath }
    );
    // gh pr create outputs the PR URL
    const prUrl = stdout.trim();
    return prUrl || null;
  } catch (error) {
    // PR creation might fail if no changes or other issues
    console.error('PR creation failed:', error);
    return null;
  }
}

function createBranchName(jiraKey: string, summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 40)
    .replace(/-+$/, '');
  return `feat/${jiraKey.toLowerCase()}-${slug}`;
}

// ===== Prompt Building =====

function buildPRFixPrompt(pr: GitHubPullRequest, checks: Awaited<ReturnType<typeof getPRChecks>>): string {
  const parts = [
    `You are fixing CI failures on PR #${pr.number}: "${pr.title}"`,
    '',
    `Branch: ${pr.head.ref}`,
    `Target: ${pr.base.ref}`,
    '',
  ];

  if (checks.summary.failedChecks.length > 0) {
    parts.push('Failed checks:');
    for (const check of checks.summary.failedChecks) {
      parts.push(`  - ${check.name} (${check.app || 'unknown'})`);
    }
    parts.push('');
  }

  parts.push(
    'Please:',
    '1. Analyze the failure by looking at the code and running tests locally',
    '2. Fix the issue',
    '3. Commit with a clear message',
    '',
    'Do not ask for confirmation - analyze, fix, and commit.'
  );

  return parts.join('\n');
}

function buildJiraTaskPrompt(ticket: { key: string; summary: string; description?: string }): string {
  const parts = [
    `You are implementing JIRA ticket ${ticket.key}: "${ticket.summary}"`,
    '',
  ];

  if (ticket.description) {
    parts.push('Description:', ticket.description, '');
  }

  parts.push(
    'Please:',
    '1. Analyze the requirements',
    '2. Search the codebase to understand the context',
    '3. Implement the required changes',
    '4. Add/update tests as needed',
    '5. Run tests to verify',
    '6. Commit with message format: feat: <jira-key>: <description>',
    '',
    'Do not ask for confirmation - implement and commit.'
  );

  return parts.join('\n');
}

function buildGenericTaskPrompt(task: Task): string {
  return `Task: ${task.content}

Please analyze, implement, test, and commit the changes needed for this task.
Do not ask for confirmation - just complete the task.`;
}

// ===== Event Handling =====

function emit(event: ExecutionEvent): void {
  console.log(`[TaskExecutor] ${event.type}:`, JSON.stringify(event).substring(0, 200));
  onEvent?.(event);
}

function handlePREvent(prEvent: PRWatchEvent): void {
  if (prEvent.type === 'success') {
    emit({ type: 'ci_passed', commitCount: prEvent.commitCount });
    if (executionState.currentTask) {
      handleTaskComplete(executionState.currentTask.task);
    }
  } else if (prEvent.type === 'max_attempts') {
    emit({ type: 'ci_failed', failure: prEvent.failure.checkName });
    executionState.status = 'awaiting_user';
    executionState.pendingChoice = 'continue';
  }
}

async function handleTaskComplete(task: Task): Promise<void> {
  await completeTask(task.id);
  emit({ type: 'task_complete', task });

  // Check for more tasks
  const remainingTasks = await getActiveTasks();
  
  executionState.status = 'awaiting_user';
  executionState.pendingChoice = 'continue';
  executionState.choices = remainingTasks.map(t => t.id);
  
  emit({ type: 'ask_continue', nextTasks: remainingTasks });
}


