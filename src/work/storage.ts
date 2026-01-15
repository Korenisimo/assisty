// Work mode storage - saves investigation results to WORK_DIRS/

import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { WorkSession, WorkInput, RelevantData } from './types.js';
import { ensureConfigDir } from '../utils/platform.js';

// ===== WORKSPACE STATE PERSISTENCE =====

export interface WorkspaceState {
  version: number;
  lastUpdated: string;
  
  // Active work context
  activeInvestigation?: {
    path: string;
    name: string;
    startedAt: string;
  };
  
  // PR tracking
  activePRs: Array<{
    repoUrl: string;
    prNumber: number;
    branch: string;
    localPath: string;
    lastActivity: string;
  }>;
  
  // Recent repo context
  recentRepos: Array<{
    name: string;
    url: string;
    path: string;
    currentBranch: string;
    lastUsed: string;
  }>;
  
  // Session summary for startup
  lastSessionSummary?: string;
}

const WORKSPACE_STATE_VERSION = 1;
const STATE_FILE = '.workspace-state.json';

function getStateFilePath(): string {
  // Store in platform-appropriate config dir so it persists across different WORK_DIRS
  return join(ensureConfigDir(), STATE_FILE);
}

/**
 * Load workspace state from disk
 */
export async function loadWorkspaceState(): Promise<WorkspaceState> {
  const statePath = getStateFilePath();
  
  if (!existsSync(statePath)) {
    return createEmptyState();
  }
  
  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content);
    
    // Migrate if needed
    if (state.version !== WORKSPACE_STATE_VERSION) {
      return createEmptyState();
    }
    
    return state;
  } catch {
    return createEmptyState();
  }
}

function createEmptyState(): WorkspaceState {
  return {
    version: WORKSPACE_STATE_VERSION,
    lastUpdated: new Date().toISOString(),
    activePRs: [],
    recentRepos: [],
  };
}

/**
 * Save workspace state to disk
 */
export async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  const statePath = getStateFilePath();
  const stateDir = statePath.substring(0, statePath.lastIndexOf('/'));
  
  if (!existsSync(stateDir)) {
    await mkdir(stateDir, { recursive: true });
  }
  
  state.lastUpdated = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Set the active investigation
 */
export async function setActiveInvestigation(
  path: string | null,
  name?: string
): Promise<void> {
  const state = await loadWorkspaceState();
  
  if (path) {
    state.activeInvestigation = {
      path,
      name: name || path.split('/').pop() || 'unknown',
      startedAt: new Date().toISOString(),
    };
  } else {
    state.activeInvestigation = undefined;
  }
  
  await saveWorkspaceState(state);
}

/**
 * Track a PR being worked on
 */
export async function trackActivePR(
  repoUrl: string,
  prNumber: number,
  branch: string,
  localPath: string
): Promise<void> {
  const state = await loadWorkspaceState();
  
  // Remove any existing entry for this PR
  state.activePRs = state.activePRs.filter(
    pr => !(pr.repoUrl === repoUrl && pr.prNumber === prNumber)
  );
  
  // Add new entry at the front
  state.activePRs.unshift({
    repoUrl,
    prNumber,
    branch,
    localPath,
    lastActivity: new Date().toISOString(),
  });
  
  // Keep only last 10 PRs
  state.activePRs = state.activePRs.slice(0, 10);
  
  await saveWorkspaceState(state);
}

/**
 * Remove a PR from tracking
 */
export async function untrackPR(repoUrl: string, prNumber: number): Promise<void> {
  const state = await loadWorkspaceState();
  state.activePRs = state.activePRs.filter(
    pr => !(pr.repoUrl === repoUrl && pr.prNumber === prNumber)
  );
  await saveWorkspaceState(state);
}

/**
 * Track a recently used repo
 */
export async function trackRecentRepo(
  name: string,
  url: string,
  path: string,
  currentBranch: string
): Promise<void> {
  const state = await loadWorkspaceState();
  
  // Remove any existing entry for this repo
  state.recentRepos = state.recentRepos.filter(r => r.name !== name);
  
  // Add at the front
  state.recentRepos.unshift({
    name,
    url,
    path,
    currentBranch,
    lastUsed: new Date().toISOString(),
  });
  
  // Keep only last 10 repos
  state.recentRepos = state.recentRepos.slice(0, 10);
  
  await saveWorkspaceState(state);
}

/**
 * Save a session summary for next startup
 */
export async function saveSessionSummary(summary: string): Promise<void> {
  const state = await loadWorkspaceState();
  state.lastSessionSummary = summary;
  await saveWorkspaceState(state);
}

/**
 * Get workspace context for system prompt injection
 */
export async function getWorkspaceContextForPrompt(): Promise<string | null> {
  const state = await loadWorkspaceState();
  const lines: string[] = [];
  
  // Add active investigation
  if (state.activeInvestigation) {
    lines.push(`ACTIVE INVESTIGATION: ${state.activeInvestigation.name}`);
    lines.push(`  Path: ${state.activeInvestigation.path}`);
    lines.push(`  Started: ${state.activeInvestigation.startedAt}`);
    lines.push('');
  }
  
  // Add active PRs
  if (state.activePRs.length > 0) {
    lines.push('ACTIVE PRs:');
    for (const pr of state.activePRs.slice(0, 5)) {
      lines.push(`  - PR #${pr.prNumber} on ${pr.repoUrl.split('/').slice(-2).join('/')}`);
      lines.push(`    Branch: ${pr.branch}, Local: ${pr.localPath}`);
    }
    lines.push('');
  }
  
  // Add recent repos
  if (state.recentRepos.length > 0) {
    lines.push('RECENT REPOS (already cloned):');
    for (const repo of state.recentRepos.slice(0, 5)) {
      lines.push(`  - ${repo.name}: ${repo.path} (${repo.currentBranch})`);
    }
    lines.push('');
  }
  
  // Add last session summary if exists
  if (state.lastSessionSummary) {
    lines.push('LAST SESSION SUMMARY:');
    lines.push(state.lastSessionSummary);
    lines.push('');
  }
  
  if (lines.length === 0) {
    return null;
  }
  
  return `=== PERSISTED WORKSPACE CONTEXT ===\n${lines.join('\n')}\n=== END WORKSPACE CONTEXT ===`;
}

// Get the WORK_DIRS path (in current working directory)
function getWorkDirsPath(): string {
  return join(process.cwd(), 'WORK_DIRS');
}

// Generate a session ID from the input
function generateSessionId(input: WorkInput): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  
  if (input.jiraTicketId) {
    return `${input.jiraTicketId}_${timestamp}`;
  }
  if (input.alertId) {
    return `alert_${input.alertId}_${timestamp}`;
  }
  if (input.datadogRequestId) {
    return `dd_${input.datadogRequestId.substring(0, 12)}_${timestamp}`;
  }
  if (input.problemStatement) {
    // Create a slug from problem statement
    const slug = input.problemStatement
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .substring(0, 30)
      .replace(/-+$/, '');
    return `${slug}_${timestamp}`;
  }
  
  return `session_${timestamp}`;
}

// Create a new work session directory
export async function createWorkSession(input: WorkInput): Promise<WorkSession> {
  const workDirs = getWorkDirsPath();
  
  // Ensure WORK_DIRS exists
  if (!existsSync(workDirs)) {
    await mkdir(workDirs, { recursive: true });
  }
  
  const sessionId = generateSessionId(input);
  const outputDir = join(workDirs, sessionId);
  
  // Create session directory
  await mkdir(outputDir, { recursive: true });
  
  const session: WorkSession = {
    id: sessionId,
    createdAt: Date.now(),
    input,
    outputDir,
  };
  
  // Save session metadata
  await writeFile(
    join(outputDir, 'session.json'),
    JSON.stringify(session, null, 2)
  );
  
  return session;
}

// Save investigation results
export async function saveResults(
  session: WorkSession,
  results: RelevantData
): Promise<void> {
  const { outputDir } = session;
  
  // Save the main summary
  await writeFile(
    join(outputDir, 'summary.md'),
    formatSummaryMarkdown(session, results)
  );
  
  // Save raw JSON data
  await writeFile(
    join(outputDir, 'results.json'),
    JSON.stringify(results, null, 2)
  );
  
  // Save individual sections if they have data
  if (results.jira?.tickets.length) {
    await writeFile(
      join(outputDir, 'jira.json'),
      JSON.stringify(results.jira.tickets, null, 2)
    );
  }
  
  if (results.confluence?.pages.length) {
    await writeFile(
      join(outputDir, 'confluence.json'),
      JSON.stringify(results.confluence.pages, null, 2)
    );
  }
  
  if (results.firehydrant?.incidents?.length || results.firehydrant?.alerts?.length) {
    await writeFile(
      join(outputDir, 'firehydrant.json'),
      JSON.stringify(results.firehydrant, null, 2)
    );
  }
  
  if (results.datadog?.logs?.length || results.datadog?.monitors?.length) {
    await writeFile(
      join(outputDir, 'datadog.json'),
      JSON.stringify(results.datadog, null, 2)
    );
  }
}

// Format results as markdown summary
function formatSummaryMarkdown(session: WorkSession, results: RelevantData): string {
  const lines: string[] = [
    '# Investigation Summary',
    '',
    `**Session ID:** ${session.id}`,
    `**Created:** ${new Date(session.createdAt).toISOString()}`,
    '',
    '## Input',
    '',
  ];
  
  if (session.input.jiraTicketId) {
    lines.push(`- **JIRA Ticket:** ${session.input.jiraTicketId}`);
  }
  if (session.input.problemStatement) {
    lines.push(`- **Problem Statement:** ${session.input.problemStatement}`);
  }
  if (session.input.alertId) {
    lines.push(`- **Alert ID:** ${session.input.alertId}`);
  }
  if (session.input.datadogRequestId) {
    lines.push(`- **Datadog Request ID:** ${session.input.datadogRequestId}`);
  }
  
  lines.push('', '## Summary', '', results.summary, '');
  
  if (results.jira?.tickets.length) {
    lines.push('## JIRA Tickets', '', `*${results.jira.relevanceNotes}*`, '');
    for (const ticket of results.jira.tickets) {
      lines.push(`### ${ticket.key}: ${ticket.summary}`);
      lines.push(`- **Status:** ${ticket.status}`);
      if (ticket.assignee) lines.push(`- **Assignee:** ${ticket.assignee}`);
      if (ticket.priority) lines.push(`- **Priority:** ${ticket.priority}`);
      if (ticket.description) {
        lines.push('', '**Description:**', ticket.description.substring(0, 500));
        if (ticket.description.length > 500) lines.push('...');
      }
      lines.push('');
    }
  }
  
  if (results.confluence?.pages.length) {
    lines.push('## Confluence Pages', '', `*${results.confluence.relevanceNotes}*`, '');
    for (const page of results.confluence.pages) {
      lines.push(`### [${page.title}](${page.url})`);
      lines.push(`- **Space:** ${page.space}`);
      lines.push(`- **Last Modified:** ${page.lastModified}`);
      if (page.excerpt) {
        lines.push('', page.excerpt.substring(0, 300));
        if (page.excerpt.length > 300) lines.push('...');
      }
      lines.push('');
    }
  }
  
  if (results.firehydrant?.incidents?.length) {
    lines.push('## FireHydrant Incidents', '', `*${results.firehydrant.relevanceNotes}*`, '');
    for (const incident of results.firehydrant.incidents) {
      lines.push(`### ${incident.name}`);
      lines.push(`- **ID:** ${incident.id}`);
      lines.push(`- **Severity:** ${incident.severity}`);
      lines.push(`- **Status:** ${incident.currentMilestone}`);
      if (incident.summary) lines.push(`- **Summary:** ${incident.summary}`);
      if (incident.services.length) lines.push(`- **Services:** ${incident.services.join(', ')}`);
      lines.push('');
    }
  }
  
  if (results.datadog?.logs?.length) {
    lines.push('## Datadog Logs', '', `*${results.datadog.relevanceNotes}*`, '');
    lines.push(`Found ${results.datadog.logs.length} log entries. See datadog.json for details.`);
    lines.push('');
  }
  
  if (results.datadog?.monitors?.length) {
    lines.push('## Datadog Monitors', '');
    for (const monitor of results.datadog.monitors) {
      lines.push(`- **${monitor.name}** (${monitor.state})`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

// List existing work sessions
export async function listWorkSessions(): Promise<string[]> {
  const workDirs = getWorkDirsPath();
  
  if (!existsSync(workDirs)) {
    return [];
  }
  
  const entries = await readdir(workDirs, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
    .reverse(); // Most recent first
}




