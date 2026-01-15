// PR Tracking - Helper functions for PR watch operations
// Refactored to support multi-session management via PRWatchManager

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  getPullRequest,
  getPRChecks,
  getCheckRunAnnotations,
  getWorkflowRunJobs,
  parseRepoUrl,
  PRChecksResult,
  CheckRunAnnotation,
  GitHubPullRequest,
} from '../clients/github.js';
import {
  startCursorSessionWithProgress,
  continueCursorSessionWithProgress,
  getCursorSessionStatus,
  CursorResponse,
} from './cursor.js';
import { getWorkspace } from './shell.js';
import {
  PRWatchSession,
  PRWatchCallback,
  PRWatchEvent,
  FailureInfo,
  FixAttempt,
} from './pr-watch-types.js';

const execAsync = promisify(exec);

const MAX_FIX_ATTEMPTS = 3;

// ===== Exported Functions for Manager =====

/**
 * Create an isolated workspace for a specific PR
 * Each PR gets its own clone to prevent branch confusion
 */
export async function createPRWorkspace(
  repoUrl: string,
  prNumber: number,
  branch: string
): Promise<string> {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    throw new Error(`Invalid repo URL: ${repoUrl}`);
  }

  const workspacePath = join(
    getWorkspace(),
    'CLONED_REPOS',
    `${parsed.repo}-pr-${prNumber}`
  );

  if (!existsSync(workspacePath)) {
    // Fresh clone - this will take a while, but no need to log to console
    const parentDir = join(getWorkspace(), 'CLONED_REPOS');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    await execAsync(`git clone ${repoUrl} "${workspacePath}"`);
  } else {
    // Update existing - silent operation
    await execAsync('git fetch origin', { cwd: workspacePath });
  }

  // Checkout the PR branch
  await checkoutBranch(workspacePath, branch);

  return workspacePath;
}

/**
 * Ensure we're on the correct branch before any operation
 * CRITICAL for preventing branch confusion in multi-PR scenarios
 */
export async function ensureCorrectBranch(session: PRWatchSession): Promise<boolean> {
  try {
    const currentBranch = await getCurrentBranch(session.localRepoPath);
    if (currentBranch !== session.branch) {
      // Branch mismatch - will be reported through events, not console
      await checkoutBranch(session.localRepoPath, session.branch);
      await execAsync('git pull', { cwd: session.localRepoPath });
      return false; // Had to switch
    }
    return true; // Already correct
  } catch (error) {
    // Error will be caught and reported by caller
    throw error;
  }
}

/**
 * Extract failure information from CI check results
 */
export async function extractFailureInfo(
  checksResult: PRChecksResult,
  session: PRWatchSession
): Promise<FailureInfo> {
  const firstFailed = checksResult.summary.failedChecks[0];
  if (!firstFailed) {
    return {
      checkName: 'Unknown',
      checkType: 'check_run',
      checkUrl: null,
    };
  }

  const failure: FailureInfo = {
    checkName: firstFailed.name,
    checkType: firstFailed.type,
    checkUrl: firstFailed.url,
    app: firstFailed.app,
  };

  // Try to get more details based on check type
  if (firstFailed.type === 'check_run' && firstFailed.app === 'github-actions') {
    // For GitHub Actions, try to get annotations and failed steps
    const checkRun = checksResult.checkRuns.find(cr => cr.name === firstFailed.name);
    if (checkRun) {
      // Get annotations
      try {
        const annotations = await getCheckRunAnnotations(session.repoUrl, checkRun.id);
        failure.annotations = annotations;
      } catch {
        // Annotations may not be available
      }

      // Try to get workflow run ID from external_id or URL
      const runIdMatch = checkRun.html_url.match(/runs\/(\d+)/);
      if (runIdMatch) {
        try {
          const jobs = await getWorkflowRunJobs(session.repoUrl, parseInt(runIdMatch[1]));
          const failedSteps: string[] = [];
          for (const job of jobs) {
            if (job.conclusion === 'failure') {
              for (const step of job.steps) {
                if (step.conclusion === 'failure') {
                  failedSteps.push(`${job.name} > ${step.name}`);
                }
              }
            }
          }
          failure.failedSteps = failedSteps;
        } catch {
          // Jobs may not be available
        }
      }
    }
  }

  return failure;
}

/**
 * Handle a detected failure - orchestrate the fix process
 */
export async function handleSessionFailure(
  session: PRWatchSession,
  failure: FailureInfo,
  emitEvent: (event: PRWatchEvent) => void
): Promise<void> {
  session.fixAttempts++;
  const attemptNumber = getAttemptNumberForFailure(session, failure);

  if (attemptNumber > MAX_FIX_ATTEMPTS) {
    // Max attempts reached for this failure type
    session.status = 'awaiting_user';
    emitEvent({ type: 'max_attempts', sessionId: session.sessionId, failure });
    return;
  }

  session.status = 'fixing';

  // CRITICAL: Ensure we're on the right branch before invoking Cursor
  await ensureCorrectBranch(session);

  if (attemptNumber === 1) {
    // First attempt: templated prompt directly to Cursor
    await handleFailureWithTemplate(session, failure, attemptNumber, emitEvent);
  } else if (attemptNumber === 2) {
    // Second attempt: ask for LLM analysis
    await handleFailureWithLLM(session, failure, emitEvent);
  } else {
    // Third attempt: need manual logs
    if (failure.app && failure.app.includes('circleci') && !failure.logs) {
      session.status = 'awaiting_user';
      emitEvent({ type: 'max_attempts', sessionId: session.sessionId, failure });
    } else {
      await handleFailureWithLLM(session, failure, emitEvent);
    }
  }
}

/**
 * Handle successful PR - all checks passing
 */
export async function handleSessionSuccess(
  session: PRWatchSession,
  emitEvent: (event: PRWatchEvent) => void
): Promise<void> {
  session.status = 'success';

  // Count commits since watch started
  const commitCount = await getCommitCountSince(
    session.localRepoPath,
    session.initialCommitSha
  );

  emitEvent({ type: 'success', sessionId: session.sessionId, commitCount });
}

// ===== Git Operations =====

async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
  // Fetch first to ensure we have the branch
  await execAsync('git fetch origin', { cwd: repoPath });

  // Try to checkout, create tracking branch if needed
  try {
    await execAsync(`git checkout ${branch}`, { cwd: repoPath });
  } catch {
    await execAsync(`git checkout -b ${branch} origin/${branch}`, { cwd: repoPath });
  }

  // Pull latest
  await execAsync('git pull', { cwd: repoPath });
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
  return stdout.trim();
}

export async function getCurrentCommitSha(repoPath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return stdout.trim();
}

async function pushChanges(repoPath: string, branch: string): Promise<void> {
  await execAsync(`git push origin ${branch}`, { cwd: repoPath });
}

async function getCommitCountSince(repoPath: string, sinceSha: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `git rev-list ${sinceSha}..HEAD --count`,
      { cwd: repoPath }
    );
    return parseInt(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Squash all commits since watch started into one
 */
export async function squashSessionCommits(
  session: PRWatchSession,
  message: string
): Promise<{ success: boolean; error?: string }> {
  if (session.status !== 'success') {
    return { success: false, error: `Cannot squash while status is '${session.status}'` };
  }

  try {
    const { localRepoPath, initialCommitSha, branch } = session;

    // Ensure we're on correct branch
    await ensureCorrectBranch(session);

    // Reset to initial commit but keep changes staged
    await execAsync(`git reset --soft ${initialCommitSha}`, { cwd: localRepoPath });

    // Create single commit
    await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: localRepoPath });

    // Force push
    await execAsync(`git push --force origin ${branch}`, { cwd: localRepoPath });

    // Update session SHA
    session.currentSha = await getCurrentCommitSha(localRepoPath);

    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errMsg };
  }
}

// ===== Private Failure Handling =====

function getAttemptNumberForFailure(session: PRWatchSession, failure: FailureInfo): number {
  // Count previous attempts for the same check
  const previousAttempts = session.fixHistory.filter(
    h => h.failure.checkName === failure.checkName
  );
  return previousAttempts.length + 1;
}

async function handleFailureWithTemplate(
  session: PRWatchSession,
  failure: FailureInfo,
  attemptNumber: number,
  emitEvent: (event: PRWatchEvent) => void
): Promise<void> {
  try {
    // NEW: Check if Cursor is busy with another workspace
    const cursorStatus = getCursorSessionStatus();
    if (cursorStatus.active && cursorStatus.workspace !== session.localRepoPath) {
      emitEvent({
        type: 'fix_skipped',
        sessionId: session.sessionId,
        reason: `Cursor is busy with another workspace: ${cursorStatus.workspace}`,
      });
      return;
    }

    emitEvent({
      type: 'fixing',
      sessionId: session.sessionId,
      attempt: attemptNumber,
      method: 'templated',
    });

    // Build templated prompt
    const prompt = buildTemplatedFixPrompt(failure);

    // CRITICAL: Verify branch before invoking Cursor
    await ensureCorrectBranch(session);

    // Run Cursor (removed force: true to let validation happen)
    const response = await startCursorSessionWithProgress(
      prompt,
      session.localRepoPath,
      { timeout: 600000 } // 10 min timeout for fixes
    );

    // Record the attempt
    const attempt: FixAttempt = {
      timestamp: Date.now(),
      failure,
      attemptNumber,
      method: 'templated',
      cursorResponse: response,
      success: response.success,
    };

    if (response.success) {
      // Check if Cursor made commits
      const newSha = await getCurrentCommitSha(session.localRepoPath);
      if (newSha !== session.currentSha) {
        attempt.commitSha = newSha;
        session.currentSha = newSha; // Update tracking
        emitEvent({ type: 'fix_committed', sessionId: session.sessionId, sha: newSha });

        // Push the fix
        await pushChanges(session.localRepoPath, session.branch);
      }
    }

    session.fixHistory.push(attempt);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    emitEvent({
      type: 'error',
      sessionId: session.sessionId,
      error: `Fix attempt failed: ${errMsg}`,
    });
  } finally {
    // ALWAYS reset status back to watching, even if error occurred
    if (session.status === 'fixing') {
      session.status = 'watching';
    }
  }
}

async function handleFailureWithLLM(
  session: PRWatchSession,
  failure: FailureInfo,
  emitEvent: (event: PRWatchEvent) => void
): Promise<void> {
  try {
    const attemptNumber = getAttemptNumberForFailure(session, failure);
    
    // NEW: Check if Cursor is busy with another workspace
    const cursorStatus = getCursorSessionStatus();
    if (cursorStatus.active && cursorStatus.workspace !== session.localRepoPath) {
      emitEvent({
        type: 'fix_skipped',
        sessionId: session.sessionId,
        reason: `Cursor is busy with another workspace: ${cursorStatus.workspace}`,
      });
      return;
    }

    emitEvent({
      type: 'fixing',
      sessionId: session.sessionId,
      attempt: attemptNumber,
      method: 'llm',
    });

    // Build a more detailed prompt for the LLM
    const prompt = buildLLMFixPrompt(session, failure);

    // CRITICAL: Verify branch before invoking Cursor
    await ensureCorrectBranch(session);

    // Use continuation if we have an existing session, otherwise start new
    let response: CursorResponse;

    if (cursorStatus.active && cursorStatus.workspace === session.localRepoPath) {
      response = await continueCursorSessionWithProgress(prompt, {
        timeout: 600000,
      });
    } else {
      response = await startCursorSessionWithProgress(prompt, session.localRepoPath, {
        timeout: 600000,
      });
    }

    // Record the attempt
    const attempt: FixAttempt = {
      timestamp: Date.now(),
      failure,
      attemptNumber,
      method: 'llm',
      cursorResponse: response,
      success: response.success,
    };

    if (response.success) {
      const newSha = await getCurrentCommitSha(session.localRepoPath);
      if (newSha !== session.currentSha) {
        attempt.commitSha = newSha;
        session.currentSha = newSha; // Update tracking
        emitEvent({ type: 'fix_committed', sessionId: session.sessionId, sha: newSha });
        await pushChanges(session.localRepoPath, session.branch);
      }
    }

    session.fixHistory.push(attempt);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    emitEvent({
      type: 'error',
      sessionId: session.sessionId,
      error: `Fix attempt failed: ${errMsg}`,
    });
  } finally {
    // ALWAYS reset status back to watching, even if error occurred
    if (session.status === 'fixing') {
      session.status = 'watching';
    }
  }
}

// ===== Prompt Building =====

function buildTemplatedFixPrompt(failure: FailureInfo): string {
  const parts: string[] = [`CI check "${failure.checkName}" failed on this PR.`, ''];

  if (failure.failedSteps && failure.failedSteps.length > 0) {
    parts.push('Failed steps:');
    for (const step of failure.failedSteps) {
      parts.push(`  - ${step}`);
    }
    parts.push('');
  }

  if (failure.annotations && failure.annotations.length > 0) {
    parts.push('Error annotations:');
    for (const ann of failure.annotations.slice(0, 5)) {
      // Limit to 5
      parts.push(`  - ${ann.path}:${ann.start_line}: ${ann.message}`);
    }
    if (failure.annotations.length > 5) {
      parts.push(`  ... and ${failure.annotations.length - 5} more`);
    }
    parts.push('');
  }

  parts.push(
    'Please fix this issue. After fixing:',
    '1. Run relevant tests locally to verify',
    '2. Commit with message: fix: ' +
      failure.checkName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    '',
    'Do not ask for confirmation - just fix and commit.'
  );

  return parts.join('\n');
}

function buildLLMFixPrompt(session: PRWatchSession, failure: FailureInfo): string {
  const parts: string[] = [
    `CI check "${failure.checkName}" is still failing after a previous fix attempt.`,
    '',
    'This is attempt #' +
      getAttemptNumberForFailure(session, failure) +
      '. Please analyze more carefully.',
    '',
  ];

  if (failure.app) {
    parts.push(`CI System: ${failure.app}`);
  }

  if (failure.checkUrl) {
    parts.push(`Check URL: ${failure.checkUrl}`);
  }

  if (failure.failedSteps && failure.failedSteps.length > 0) {
    parts.push('', 'Failed steps:');
    for (const step of failure.failedSteps) {
      parts.push(`  - ${step}`);
    }
  }

  if (failure.annotations && failure.annotations.length > 0) {
    parts.push('', 'Error details:');
    for (const ann of failure.annotations) {
      parts.push(`File: ${ann.path}`);
      parts.push(`Line: ${ann.start_line}`);
      parts.push(`Level: ${ann.annotation_level}`);
      parts.push(`Message: ${ann.message}`);
      if (ann.raw_details) {
        parts.push(`Details: ${ann.raw_details}`);
      }
      parts.push('');
    }
  }

  if (failure.logs) {
    parts.push('', 'CI Logs (provided by user):');
    parts.push('```');
    parts.push(failure.logs.slice(0, 5000)); // Limit log size
    if (failure.logs.length > 5000) {
      parts.push('... [truncated]');
    }
    parts.push('```');
  }

  parts.push(
    '',
    'Please:',
    '1. Analyze the failure carefully',
    '2. Search the codebase to understand the context',
    '3. Make the necessary fix',
    '4. Run tests locally if possible',
    '5. Commit with a descriptive message',
    '',
    'Do not ask for confirmation - analyze, fix, and commit.'
  );

  return parts.join('\n');
}

// ===== Utility =====

/**
 * Parse a PR URL to extract repo URL and PR number
 * Supports formats like:
 * - https://github.com/owner/repo/pull/123
 * - owner/repo#123
 */
export function parsePRUrl(input: string): { repoUrl: string; prNumber: number } | null {
  // Full URL format
  const urlMatch = input.match(/github\.com\/([\w-]+)\/([\w-]+)\/pull\/(\d+)/);
  if (urlMatch) {
    return {
      repoUrl: `https://github.com/${urlMatch[1]}/${urlMatch[2]}`,
      prNumber: parseInt(urlMatch[3]),
    };
  }

  // Short format: owner/repo#123
  const shortMatch = input.match(/^([\w-]+)\/([\w-]+)#(\d+)$/);
  if (shortMatch) {
    return {
      repoUrl: `https://github.com/${shortMatch[1]}/${shortMatch[2]}`,
      prNumber: parseInt(shortMatch[3]),
    };
  }

  return null;
}
