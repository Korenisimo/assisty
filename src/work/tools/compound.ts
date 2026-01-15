// Compound tools that perform complete workflows atomically
// These tools handle multi-step operations so the AI doesn't need to chain tool calls

import { mkdir, writeFile, readFile, unlink, readdir } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { runShellCommand, getWorkspace } from './shell.js';
import {
  getTicket,
  searchTickets,
  getUnassignedTickets,
  getBacklogTickets,
  isJiraConfigured,
} from '../clients/index.js';

// ===== REPOSITORY METADATA =====

export interface RepoMetadata {
  url: string;
  name: string;
  path: string;
  clonedAt: string;
  lastAccessed: string;
  currentBranch?: string;
}

export interface RepoMetadataStore {
  repos: Record<string, RepoMetadata>;  // keyed by repo name
  version: number;
}

// Branch lock for multi-process safety
export interface BranchLock {
  branch: string;
  pid: number;
  lockedAt: string;
  lockedBy: string;  // description of what's using it
}

const METADATA_FILE = '.metadata.json';
const LOCK_FILE_PREFIX = '.lock_';
const LOCK_STALE_MS = 30 * 60 * 1000;  // 30 minutes - locks older than this are stale

/**
 * Get the path to the CLONED_REPOS directory
 */
function getClonedReposDir(): string {
  return join(getWorkspace(), 'CLONED_REPOS');
}

/**
 * Get the path to the metadata file
 */
function getMetadataPath(): string {
  return join(getClonedReposDir(), METADATA_FILE);
}

/**
 * Load repo metadata from disk
 */
async function loadRepoMetadata(): Promise<RepoMetadataStore> {
  const metadataPath = getMetadataPath();
  if (!existsSync(metadataPath)) {
    return { repos: {}, version: 1 };
  }
  try {
    const content = await readFile(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { repos: {}, version: 1 };
  }
}

/**
 * Save repo metadata to disk
 */
async function saveRepoMetadata(store: RepoMetadataStore): Promise<void> {
  const clonedReposDir = getClonedReposDir();
  if (!existsSync(clonedReposDir)) {
    await mkdir(clonedReposDir, { recursive: true });
  }
  await writeFile(getMetadataPath(), JSON.stringify(store, null, 2));
}

/**
 * Update metadata for a single repo
 */
async function updateRepoMetadata(repo: ClonedRepo, branch?: string): Promise<void> {
  const store = await loadRepoMetadata();
  const now = new Date().toISOString();
  
  if (store.repos[repo.name]) {
    store.repos[repo.name].lastAccessed = now;
    if (branch) store.repos[repo.name].currentBranch = branch;
  } else {
    store.repos[repo.name] = {
      url: repo.url,
      name: repo.name,
      path: repo.path,
      clonedAt: now,
      lastAccessed: now,
      currentBranch: branch,
    };
  }
  
  await saveRepoMetadata(store);
}

/**
 * List all cloned repositories with their metadata
 */
export async function listClonedRepos(): Promise<RepoMetadata[]> {
  const store = await loadRepoMetadata();
  const clonedReposDir = getClonedReposDir();
  
  // Also scan the directory to catch any repos not in metadata
  if (existsSync(clonedReposDir)) {
    try {
      const entries = await readdir(clonedReposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const repoPath = join(clonedReposDir, entry.name);
          if (existsSync(join(repoPath, '.git')) && !store.repos[entry.name]) {
            // Found a repo not in metadata, add it
            const stat = statSync(repoPath);
            store.repos[entry.name] = {
              url: 'unknown',  // Can't determine URL without git remote
              name: entry.name,
              path: repoPath,
              clonedAt: stat.birthtime.toISOString(),
              lastAccessed: stat.mtime.toISOString(),
            };
          }
        }
      }
      await saveRepoMetadata(store);
    } catch {
      // Ignore errors scanning directory
    }
  }
  
  return Object.values(store.repos).sort((a, b) => 
    new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime()
  );
}

/**
 * Search cloned repos by name or URL
 */
export async function searchClonedRepos(query: string): Promise<RepoMetadata[]> {
  const repos = await listClonedRepos();
  const lowerQuery = query.toLowerCase();
  return repos.filter(repo => 
    repo.name.toLowerCase().includes(lowerQuery) ||
    repo.url.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get metadata for a specific repo by name
 */
export async function getRepoMetadata(repoName: string): Promise<RepoMetadata | null> {
  const store = await loadRepoMetadata();
  return store.repos[repoName] || null;
}

// ===== BRANCH LOCKING =====

/**
 * Get the lock file path for a repo/branch
 */
function getLockFilePath(repoPath: string, branch: string): string {
  const safeBranch = branch.replace(/[^a-zA-Z0-9-_]/g, '_');
  return join(repoPath, `${LOCK_FILE_PREFIX}${safeBranch}`);
}

/**
 * Check if a lock is stale (older than LOCK_STALE_MS)
 */
function isLockStale(lock: BranchLock): boolean {
  const lockTime = new Date(lock.lockedAt).getTime();
  return Date.now() - lockTime > LOCK_STALE_MS;
}

/**
 * Check if a process is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);  // Signal 0 just checks if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock on a branch for a repo
 * Returns true if lock acquired, false if branch is locked by another process
 */
export async function acquireBranchLock(
  repoPath: string, 
  branch: string, 
  lockedBy: string
): Promise<{ acquired: boolean; existingLock?: BranchLock }> {
  const lockPath = getLockFilePath(repoPath, branch);
  
  // Check for existing lock
  if (existsSync(lockPath)) {
    try {
      const content = await readFile(lockPath, 'utf-8');
      const existingLock: BranchLock = JSON.parse(content);
      
      // Check if lock is stale or process is dead
      if (!isLockStale(existingLock) && isProcessRunning(existingLock.pid)) {
        // Lock is held by another active process
        if (existingLock.pid !== process.pid) {
          return { acquired: false, existingLock };
        }
        // We already hold this lock
        return { acquired: true };
      }
      
      // Lock is stale or process is dead, we can take it
    } catch {
      // Invalid lock file, we can take it
    }
  }
  
  // Create new lock
  const lock: BranchLock = {
    branch,
    pid: process.pid,
    lockedAt: new Date().toISOString(),
    lockedBy,
  };
  
  await writeFile(lockPath, JSON.stringify(lock, null, 2));
  return { acquired: true };
}

/**
 * Release a branch lock
 */
export async function releaseBranchLock(repoPath: string, branch: string): Promise<boolean> {
  const lockPath = getLockFilePath(repoPath, branch);
  
  if (!existsSync(lockPath)) {
    return true;  // Already unlocked
  }
  
  try {
    const content = await readFile(lockPath, 'utf-8');
    const lock: BranchLock = JSON.parse(content);
    
    // Only release if we own it
    if (lock.pid === process.pid) {
      await unlink(lockPath);
      return true;
    }
    return false;  // Someone else owns it
  } catch {
    // Error reading lock, try to delete anyway
    try {
      await unlink(lockPath);
    } catch { /* ignore */ }
    return true;
  }
}

/**
 * Check if a branch is locked by another process
 */
export async function isBranchLocked(
  repoPath: string, 
  branch: string
): Promise<{ locked: boolean; lock?: BranchLock }> {
  const lockPath = getLockFilePath(repoPath, branch);
  
  if (!existsSync(lockPath)) {
    return { locked: false };
  }
  
  try {
    const content = await readFile(lockPath, 'utf-8');
    const lock: BranchLock = JSON.parse(content);
    
    // Our own lock doesn't count
    if (lock.pid === process.pid) {
      return { locked: false };
    }
    
    // Check if stale or dead
    if (isLockStale(lock) || !isProcessRunning(lock.pid)) {
      return { locked: false };  // Stale lock
    }
    
    return { locked: true, lock };
  } catch {
    return { locked: false };  // Invalid lock
  }
}

/**
 * List all active locks in a repo
 */
export async function listBranchLocks(repoPath: string): Promise<BranchLock[]> {
  if (!existsSync(repoPath)) {
    return [];
  }
  
  const locks: BranchLock[] = [];
  
  try {
    const entries = await readdir(repoPath);
    for (const entry of entries) {
      if (entry.startsWith(LOCK_FILE_PREFIX)) {
        try {
          const content = await readFile(join(repoPath, entry), 'utf-8');
          const lock: BranchLock = JSON.parse(content);
          
          // Only include active locks
          if (!isLockStale(lock) && isProcessRunning(lock.pid)) {
            locks.push(lock);
          }
        } catch { /* skip invalid lock files */ }
      }
    }
  } catch { /* ignore errors */ }
  
  return locks;
}

export interface SavedTicket {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  assignee?: string;
  description?: string;
  savedTo: string;
}

export interface ClonedRepo {
  url: string;
  name: string;
  path: string;
  branch?: string;  // The branch this clone is on (if branch-specific)
}

// Extract repo name from git URL
function extractRepoName(url: string): string {
  // Handle URLs like:
  // https://github.com/org/repo.git
  // git@github.com:org/repo.git
  const match = url.match(/\/([^\/]+?)(\.git)?$/);
  if (match) {
    return match[1].replace('.git', '');
  }
  // Fallback: use last segment
  return url.split('/').pop()?.replace('.git', '') || 'repo';
}

// Sanitize branch name for use in directory names
function sanitizeBranchForDir(branch: string): string {
  // Replace slashes and other problematic chars with dashes
  return branch
    .replace(/\//g, '-')  // feature/foo -> feature-foo
    .replace(/[^a-zA-Z0-9._-]/g, '-')  // Remove other special chars
    .replace(/-+/g, '-')  // Collapse multiple dashes
    .replace(/^-|-$/g, '');  // Trim leading/trailing dashes
}

/**
 * Clone a repository into CLONED_REPOS/<repo-name> or CLONED_REPOS/<repo-name>-<branch>
 * 
 * If branch is specified, creates an ISOLATED clone for that branch:
 * - Directory: CLONED_REPOS/<repo>-<branch>
 * - Enables parallel workstreams without branch locking
 * 
 * If branch is not specified, uses shared clone (legacy behavior):
 * - Directory: CLONED_REPOS/<repo>
 * - May require branch locking for parallel access
 * 
 * Returns the path where it was cloned
 * Updates repo metadata for tracking
 */
export async function cloneRepoToWorkspace(
  url: string,
  options?: { branch?: string }
): Promise<ClonedRepo> {
  const workspace = getWorkspace();
  const clonedReposDir = join(workspace, 'CLONED_REPOS');
  const repoName = extractRepoName(url);
  const branch = options?.branch;
  
  // If branch specified, create isolated clone directory
  const dirName = branch 
    ? `${repoName}-${sanitizeBranchForDir(branch)}`
    : repoName;
  const repoPath = join(clonedReposDir, dirName);
  
  // Ensure CLONED_REPOS exists
  if (!existsSync(clonedReposDir)) {
    await mkdir(clonedReposDir, { recursive: true });
  }
  
  const repo: ClonedRepo = {
    url,
    name: dirName,
    path: repoPath,
    branch,
  };
  
  // Check if already cloned
  if (existsSync(repoPath)) {
    // Pull latest instead
    const pullResult = await runShellCommand('git pull', dirName);
    if (pullResult.exitCode !== 0) {
      // If pull fails, might be detached HEAD or other issue, ignore
    }
    // Update metadata with current branch
    const branchResult = await runShellCommand('git branch --show-current', dirName);
    const currentBranch = branchResult.stdout?.trim();
    await updateRepoMetadata(repo, currentBranch);
    return repo;
  }
  
  // Clone the repo - with branch if specified
  const cloneCmd = branch
    ? `git clone -b ${branch} ${url} ${dirName}`
    : `git clone ${url} ${dirName}`;
  
  const result = await runShellCommand(cloneCmd, 'CLONED_REPOS');
  
  if (result.exitCode !== 0 && !result.stderr.includes('already exists')) {
    throw new Error(`Failed to clone repo: ${result.stderr || result.stdout}`);
  }
  
  // Update metadata for the new repo
  await updateRepoMetadata(repo, branch || 'main');
  
  return repo;
}

/**
 * Checkout a branch in a repo with optional locking for multi-process safety
 * Returns success status and any lock conflicts
 */
export async function checkoutBranchSafe(
  repoPath: string,
  branch: string,
  options: {
    create?: boolean;       // Create branch if it doesn't exist
    acquireLock?: boolean;  // Acquire a lock on this branch (default: true)
    lockedBy?: string;      // Description for the lock
  } = {}
): Promise<{ success: boolean; error?: string; lockConflict?: BranchLock }> {
  const { create = false, acquireLock = true, lockedBy = 'work-agent' } = options;
  
  // Check for lock conflicts if not acquiring lock
  if (!acquireLock) {
    const lockStatus = await isBranchLocked(repoPath, branch);
    if (lockStatus.locked) {
      return {
        success: false,
        error: `Branch ${branch} is locked by another process`,
        lockConflict: lockStatus.lock,
      };
    }
  } else {
    // Try to acquire lock
    const lockResult = await acquireBranchLock(repoPath, branch, lockedBy);
    if (!lockResult.acquired) {
      return {
        success: false,
        error: `Branch ${branch} is locked by another process (PID: ${lockResult.existingLock?.pid})`,
        lockConflict: lockResult.existingLock,
      };
    }
  }
  
  // Get repo name for shell command
  const repoName = repoPath.split('/').pop() || '';
  
  // Try to checkout
  let checkoutCmd = create ? `git checkout -b ${branch}` : `git checkout ${branch}`;
  let result = await runShellCommand(checkoutCmd, repoName);
  
  // If checkout failed and we weren't creating, try creating
  if (result.exitCode !== 0 && !create && result.stderr?.includes('did not match')) {
    // Branch doesn't exist locally, try to fetch and checkout
    await runShellCommand(`git fetch origin ${branch}`, repoName);
    result = await runShellCommand(`git checkout ${branch}`, repoName);
    
    // If still fails, create the branch
    if (result.exitCode !== 0) {
      result = await runShellCommand(`git checkout -b ${branch}`, repoName);
    }
  }
  
  if (result.exitCode !== 0) {
    // Release lock if we acquired it
    if (acquireLock) {
      await releaseBranchLock(repoPath, branch);
    }
    return {
      success: false,
      error: `Failed to checkout branch ${branch}: ${result.stderr || result.stdout}`,
    };
  }
  
  // Update metadata
  const store = await loadRepoMetadata();
  if (store.repos[repoName]) {
    store.repos[repoName].currentBranch = branch;
    store.repos[repoName].lastAccessed = new Date().toISOString();
    await saveRepoMetadata(store);
  }
  
  return { success: true };
}

/**
 * Fetch JIRA tickets and save each to its own subdirectory
 * Each ticket gets: <targetDir>/<TICKET-KEY>/ticket.json and ticket.md
 */
export async function saveJiraTicketsToWorkspace(
  projectKey: string,
  targetDir: string,
  options: {
    type?: 'unassigned' | 'backlog' | 'search';
    query?: string;
    maxResults?: number;
  } = {}
): Promise<SavedTicket[]> {
  if (!isJiraConfigured()) {
    throw new Error('JIRA is not configured');
  }
  
  const { type = 'unassigned', query, maxResults = 50 } = options;
  
  // Fetch tickets based on type
  let tickets: Array<{
    key: string;
    summary: string;
    status: string;
    priority?: string;
    assignee?: string;
    description?: string;
    created?: string;
    updated?: string;
    labels?: string[];
    components?: string[];
  }>;
  
  switch (type) {
    case 'backlog':
      tickets = await getBacklogTickets(projectKey, maxResults);
      break;
    case 'search':
      if (!query) throw new Error('Query required for search type');
      const searchResult = await searchTickets(query, maxResults);
      tickets = searchResult.tickets;
      break;
    case 'unassigned':
    default:
      tickets = await getUnassignedTickets(projectKey, maxResults);
      break;
  }
  
  if (!tickets || tickets.length === 0) {
    return [];
  }
  
  // Ensure target directory exists
  const workspace = getWorkspace();
  const fullTargetDir = join(workspace, targetDir);
  if (!existsSync(fullTargetDir)) {
    await mkdir(fullTargetDir, { recursive: true });
  }
  
  const savedTickets: SavedTicket[] = [];
  
  for (const ticket of tickets) {
    const ticketDir = join(fullTargetDir, ticket.key);
    
    // Create ticket directory
    if (!existsSync(ticketDir)) {
      await mkdir(ticketDir, { recursive: true });
    }
    
    // Save as JSON
    await writeFile(
      join(ticketDir, 'ticket.json'),
      JSON.stringify(ticket, null, 2)
    );
    
    // Save as Markdown for easy reading
    const markdown = formatTicketMarkdown(ticket);
    await writeFile(join(ticketDir, 'ticket.md'), markdown);
    
    savedTickets.push({
      key: ticket.key,
      summary: ticket.summary,
      status: ticket.status,
      priority: ticket.priority,
      assignee: ticket.assignee,
      description: ticket.description,
      savedTo: ticketDir,
    });
  }
  
  // Also save a summary file
  const summaryPath = join(fullTargetDir, '_tickets_summary.md');
  const summaryMd = formatTicketsSummary(savedTickets, projectKey, type);
  await writeFile(summaryPath, summaryMd);
  
  return savedTickets;
}

/**
 * Get a single JIRA ticket and save it to workspace
 */
export async function saveJiraTicketToWorkspace(
  ticketKey: string,
  targetDir: string
): Promise<SavedTicket | null> {
  if (!isJiraConfigured()) {
    throw new Error('JIRA is not configured');
  }
  
  const ticket = await getTicket(ticketKey);
  if (!ticket) {
    return null;
  }
  
  const workspace = getWorkspace();
  const ticketDir = join(workspace, targetDir, ticketKey);
  
  // Create ticket directory
  if (!existsSync(ticketDir)) {
    await mkdir(ticketDir, { recursive: true });
  }
  
  // Save as JSON
  await writeFile(
    join(ticketDir, 'ticket.json'),
    JSON.stringify(ticket, null, 2)
  );
  
  // Save as Markdown
  const markdown = formatTicketMarkdown(ticket);
  await writeFile(join(ticketDir, 'ticket.md'), markdown);
  
  return {
    key: ticket.key,
    summary: ticket.summary,
    status: ticket.status,
    priority: ticket.priority,
    assignee: ticket.assignee,
    description: ticket.description,
    savedTo: ticketDir,
  };
}

// Format a ticket as markdown
function formatTicketMarkdown(ticket: {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  assignee?: string;
  description?: string;
  created?: string;
  updated?: string;
  labels?: string[];
  components?: string[];
}): string {
  const lines = [
    `# ${ticket.key}: ${ticket.summary}`,
    '',
    '## Details',
    '',
    `- **Status:** ${ticket.status}`,
    `- **Priority:** ${ticket.priority || 'Not set'}`,
    `- **Assignee:** ${ticket.assignee || 'Unassigned'}`,
  ];
  
  if (ticket.created) {
    lines.push(`- **Created:** ${ticket.created}`);
  }
  if (ticket.updated) {
    lines.push(`- **Updated:** ${ticket.updated}`);
  }
  if (ticket.labels?.length) {
    lines.push(`- **Labels:** ${ticket.labels.join(', ')}`);
  }
  if (ticket.components?.length) {
    lines.push(`- **Components:** ${ticket.components.join(', ')}`);
  }
  
  if (ticket.description) {
    lines.push('', '## Description', '', ticket.description);
  }
  
  return lines.join('\n');
}

// Format summary of all saved tickets
function formatTicketsSummary(
  tickets: SavedTicket[],
  projectKey: string,
  type: string
): string {
  const lines = [
    `# ${projectKey} Tickets (${type})`,
    '',
    `*Saved ${tickets.length} tickets on ${new Date().toISOString()}*`,
    '',
    '## Tickets',
    '',
  ];
  
  for (const ticket of tickets) {
    lines.push(`- **[${ticket.key}](./${ticket.key}/ticket.md)**: ${ticket.summary}`);
    lines.push(`  - Status: ${ticket.status} | Priority: ${ticket.priority || 'N/A'}`);
  }
  
  return lines.join('\n');
}

// === INVESTIGATION TOOLS ===

export interface InvestigationWorkspace {
  path: string;
  name: string;
  createdAt: string;
  alertFile: string;
  logsDir: string;
  findingsFile: string;
  reused?: boolean; // True if an existing directory was reused
}

/**
 * Find existing investigation directories that match the given name (fuzzy match)
 * Returns the most recent matching directory, or null if none found
 */
export function findExistingInvestigation(name: string): string | null {
  const workspace = getWorkspace();
  if (!existsSync(workspace)) return null;
  
  const normalizedName = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const entries = require('fs').readdirSync(workspace, { withFileTypes: true });
    const matchingDirs: string[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const dirName = entry.name.toUpperCase();
      // Match if:
      // 1. Exact match with today's date
      // 2. Fuzzy match: contains significant words from the name (at least 2 matching words)
      const exactMatch = dirName === `${normalizedName}_${today}`;
      
      // Fuzzy match: extract words and check overlap
      const nameWords = normalizedName.split('_').filter((w: string) => w.length > 2);
      const dirWords = dirName.split('_').filter((w: string) => w.length > 2);
      const matchingWords = nameWords.filter((w: string) => dirWords.includes(w));
      const fuzzyMatch = matchingWords.length >= 2 && dirName.includes(today);
      
      if (exactMatch || fuzzyMatch) {
        matchingDirs.push(entry.name);
      }
    }
    
    // Return the most recently modified matching directory
    if (matchingDirs.length > 0) {
      // Sort by modification time (most recent first)
      matchingDirs.sort((a, b) => {
        const statA = require('fs').statSync(join(workspace, a));
        const statB = require('fs').statSync(join(workspace, b));
        return statB.mtimeMs - statA.mtimeMs;
      });
      return join(workspace, matchingDirs[0]);
    }
  } catch {
    // Ignore errors, return null
  }
  
  return null;
}

/**
 * Create an investigation workspace with standard structure
 * If existingDir is provided, reuse that directory instead of creating new
 * If a similar directory exists from today, reuse it (prevents duplicates on interruption)
 */
export async function createInvestigationWorkspace(
  name: string,
  alertContent: string,
  existingDir?: string
): Promise<InvestigationWorkspace> {
  const workspace = getWorkspace();
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const folderName = `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${date}`;
  
  let investigationPath: string;
  let reused = false;
  
  // Priority 1: Use explicitly provided existing directory
  if (existingDir) {
    investigationPath = existingDir.startsWith('/') ? existingDir : join(workspace, existingDir);
    reused = true;
  } else {
    // Priority 2: Check for existing similar investigation from today
    const existingPath = findExistingInvestigation(name);
    if (existingPath) {
      investigationPath = existingPath;
      reused = true;
    } else {
      // Priority 3: Create new directory
      investigationPath = join(workspace, folderName);
    }
  }
  
  // Create the investigation directory if it doesn't exist
  if (!existsSync(investigationPath)) {
    await mkdir(investigationPath, { recursive: true });
  }
  
  // Save the alert/problem statement
  const alertFile = join(investigationPath, 'alert.txt');
  await writeFile(alertFile, `# Alert/Problem Statement\n\nReceived: ${new Date().toISOString()}\n\n${alertContent}`);
  
  // Create logs directory
  const logsDir = join(investigationPath, 'logs');
  await mkdir(logsDir, { recursive: true });
  
  // Create findings file with template
  const findingsFile = join(investigationPath, 'findings.md');
  const findingsTemplate = `# Investigation: ${name}

**Started:** ${new Date().toISOString()}
**Status:** In Progress

## Summary

(To be updated as investigation progresses)

## Alert Analysis

**Metric Type:** (e.g., success rate, error rate, latency)
**Measurement Point:** (Where is this metric measured? Caller side? Service side? Gateway?)
**Possible Causes:** (What could cause this metric to change?)

## Timeline

- ${new Date().toISOString()} - Investigation started

## Findings

(Findings will be added here)

## Search Coverage

### Logs Searched
(List what log sources were searched and what was found)

### Logs NOT Searched (Potential Gaps)
(List log sources that might be relevant but weren't searched, and why they might matter)
- Gateway/ingress logs: (if applicable)
- Caller service logs: (if applicable)
- Other related services: (if applicable)

### Questions for Further Investigation
(What questions remain unanswered? What should Cursor look for?)

## Related Resources

- Logs: [logs/](./logs/) (each search saved as separate file)
- Alert: [alert.txt](./alert.txt)

## Next Steps

(Action items)
`;
  await writeFile(findingsFile, findingsTemplate);
  
  // Get the actual folder name from the path (in case we reused an existing one)
  const actualFolderName = investigationPath.split('/').pop() || folderName;
  
  return {
    path: investigationPath,
    name: actualFolderName,
    createdAt: new Date().toISOString(),
    alertFile,
    logsDir,
    findingsFile,
    reused,
  };
}

/**
 * Save logs to an investigation's logs/ directory
 * Each save creates a new timestamped file
 * IMPORTANT: Does NOT save empty log arrays - returns early with count: 0
 */
export async function appendLogsToInvestigation(
  investigationPath: string,
  logs: unknown[],
  source: string,
  options?: {
    query?: string;  // Original query for metadata
    error?: string;  // Error message if search failed
    skipEmpty?: boolean;  // If true, don't save empty results (default: true)
  }
): Promise<{ count: number; filename: string; skipped?: boolean }> {
  const skipEmpty = options?.skipEmpty !== false; // Default to true
  
  // Don't save empty log files unless explicitly requested
  if (skipEmpty && logs.length === 0 && !options?.error) {
    return { count: 0, filename: '', skipped: true };
  }
  
  // Resolve path relative to workspace if not absolute
  const workspace = getWorkspace();
  const fullPath = investigationPath.startsWith('/') 
    ? investigationPath 
    : join(workspace, investigationPath);
  const logsDir = join(fullPath, 'logs');
  
  // Ensure logs directory exists
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true });
  }
  
  // Create a filename from timestamp and source
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeSource = source.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
  const filename = `${timestamp}_${safeSource}.json`;
  const logsFile = join(logsDir, filename);
  
  // Add metadata to the log file
  const logData = {
    _metadata: {
      source,
      savedAt: new Date().toISOString(),
      count: logs.length,
      query: options?.query || source,
      ...(options?.error && { error: options.error }),
    },
    logs,
  };
  
  await writeFile(logsFile, JSON.stringify(logData, null, 2));
  
  return { count: logs.length, filename };
}

/**
 * Add a finding to the investigation
 */
export async function addFindingToInvestigation(
  investigationPath: string,
  finding: string
): Promise<void> {
  // Resolve path relative to workspace if not absolute
  const workspace = getWorkspace();
  const fullPath = investigationPath.startsWith('/') 
    ? investigationPath 
    : join(workspace, investigationPath);
  const findingsFile = join(fullPath, 'findings.md');
  
  if (!existsSync(findingsFile)) {
    throw new Error(`Investigation findings file not found at ${findingsFile}`);
  }
  
  const content = await readFile(findingsFile, 'utf-8');
  const timestamp = new Date().toISOString();
  
  // Add to Timeline section
  const timelineMarker = '## Timeline\n';
  const findingsMarker = '## Findings\n';
  
  let updatedContent = content;
  
  // Add to timeline
  const timelineIdx = content.indexOf(timelineMarker);
  if (timelineIdx !== -1) {
    const afterTimeline = timelineIdx + timelineMarker.length;
    const nextSection = content.indexOf('\n##', afterTimeline);
    const insertPoint = nextSection !== -1 ? nextSection : content.length;
    
    updatedContent = 
      updatedContent.slice(0, insertPoint) + 
      `- ${timestamp} - ${finding.split('\n')[0]}\n` + 
      updatedContent.slice(insertPoint);
  }
  
  // Add detailed finding
  const findingsIdx = updatedContent.indexOf(findingsMarker);
  if (findingsIdx !== -1) {
    const afterFindings = findingsIdx + findingsMarker.length;
    const nextSection = updatedContent.indexOf('\n##', afterFindings);
    const insertPoint = nextSection !== -1 ? nextSection : updatedContent.length;
    
    updatedContent = 
      updatedContent.slice(0, insertPoint) + 
      `\n### ${timestamp}\n\n${finding}\n` + 
      updatedContent.slice(insertPoint);
  }
  
  await writeFile(findingsFile, updatedContent);
}

/**
 * Create a handoff directory for Cursor with task instructions and gathered context
 * This is for complex tasks that require deeper codebase work
 */
export async function createCursorHandoff(
  taskName: string,
  taskDescription: string,
  context: {
    gatheredInfo?: string[];
    relatedFiles?: string[];
    nextSteps?: string[];
    references?: Array<{ type: string; content: string }>;
    existingDir?: string; // Optional: use an existing directory instead of creating new one
  }
): Promise<{ path: string; name: string }> {
  const workspace = getWorkspace();
  
  // If an existing directory is provided, use it; otherwise create a new one
  let handoffPath: string;
  let folderName: string;
  
  if (context.existingDir) {
    // Use existing directory (can be relative to workspace or absolute)
    handoffPath = context.existingDir.startsWith('/') 
      ? context.existingDir 
      : join(workspace, context.existingDir);
    folderName = context.existingDir.split('/').pop() || context.existingDir;
  } else {
    // Create new directory with standard naming
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const safeName = taskName.replace(/[^a-zA-Z0-9-]/g, '_').toLowerCase();
    folderName = `cursor_${safeName}_${date}`;
    handoffPath = join(workspace, folderName);
  }
  
  // Create directory
  if (!existsSync(handoffPath)) {
    await mkdir(handoffPath, { recursive: true });
  }
  
  // Create TASK.md with instructions for Cursor
  const taskMd = `# Task: ${taskName}

**Created:** ${new Date().toISOString()}
**Status:** Ready for Cursor Agent

---

## Task Description

${taskDescription}

---

## Context Gathered

${context.gatheredInfo && context.gatheredInfo.length > 0 
  ? context.gatheredInfo.map((info, i) => `${i + 1}. ${info}`).join('\n')
  : '(No preliminary context gathered yet)'}

---

## Related Files/Resources

${context.relatedFiles && context.relatedFiles.length > 0
  ? context.relatedFiles.map(f => `- \`${f}\``).join('\n')
  : '(To be determined)'}

---

## Recommended Next Steps

${context.nextSteps && context.nextSteps.length > 0
  ? context.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')
  : `1. Review the task description above
2. Search the codebase for relevant files
3. Implement the required changes
4. Test and validate the solution`}

---

## Instructions for Cursor

This task has been prepared by the Work Mode assistant. The initial research and context gathering has been done.
Your job is to:

1. Review the context and gathered information above
2. Use Cursor's codebase search and tools to locate relevant code
3. Implement the required changes following the recommended steps
4. Ensure all changes are tested and working

**Workspace:** This directory is in \`WORK_DIRS/${folderName}\`

You can use this directory to:
- Store additional research notes
- Save code snippets or examples
- Track progress on sub-tasks

---

## Additional References

${context.references && context.references.length > 0
  ? context.references.map((ref, i) => {
      return `### Reference ${i + 1}: ${ref.type}\n\n\`\`\`\n${ref.content}\n\`\`\`\n`;
    }).join('\n')
  : '(No additional references)'}
`;

  await writeFile(join(handoffPath, 'TASK.md'), taskMd);
  
  // Create a NOTES.md for Cursor to add findings
  const notesMd = `# Notes for ${taskName}

Use this file to track your progress and findings as you work on this task.

## Progress Log

- ${new Date().toISOString()} - Task handed off from Work Mode assistant

## Findings

(Add your findings here as you investigate)

## Changes Made

(Document changes as you make them)

## Testing

(Document test results)
`;

  await writeFile(join(handoffPath, 'NOTES.md'), notesMd);
  
  return {
    path: handoffPath,
    name: folderName,
  };
}

// ===== LOG ANALYSIS =====

export interface LogAnalysisResult {
  totalLogs: number;
  timeRange: {
    earliest: string;
    latest: string;
    durationMs: number;
  };
  requestRate: {
    perSecond: number;
    perMinute: number;
  };
  durations: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  statusCodes: Record<number, number>;
  endpoints: Record<string, { count: number; avgDuration: number }>;
  methods: Record<string, number>;
  topEndpoints: Array<{ path: string; count: number; avgDuration: number }>;
}

/**
 * Analyze structured logs from a JSON file to extract metrics
 * Expects logs in format: { logs: Array<{ timestamp, attributes: { 'targets-services': { duration, statusCode, path, method } } }> }
 */
export async function analyzeLogsStructured(logFilePath: string): Promise<LogAnalysisResult> {
  const fullPath = logFilePath.startsWith('/') 
    ? logFilePath 
    : join(getWorkspace(), logFilePath);
  
  if (!existsSync(fullPath)) {
    throw new Error(`Log file not found: ${fullPath}`);
  }
  
  const content = await readFile(fullPath, 'utf-8');
  const data = JSON.parse(content);
  const logs = data.logs || [];
  
  if (logs.length === 0) {
    throw new Error('No logs found in file');
  }
  
  // Extract timestamps and metrics
  const timestamps: number[] = [];
  const durations: number[] = [];
  const statusCodes: Record<number, number> = {};
  const endpoints: Record<string, { durations: number[]; count: number }> = {};
  const methods: Record<string, number> = {};
  
  for (const log of logs) {
    const timestamp = new Date(log.timestamp).getTime();
    timestamps.push(timestamp);
    
    // Extract structured data from attributes
    const attrs = log.attributes;
    if (attrs && attrs['targets-services']) {
      const svcData = attrs['targets-services'];
      
      // Duration
      if (typeof svcData.duration === 'number') {
        durations.push(svcData.duration);
      }
      
      // Status code
      if (typeof svcData.statusCode === 'number') {
        statusCodes[svcData.statusCode] = (statusCodes[svcData.statusCode] || 0) + 1;
      }
      
      // Path/endpoint
      if (typeof svcData.path === 'string') {
        const path = svcData.path;
        if (!endpoints[path]) {
          endpoints[path] = { durations: [], count: 0 };
        }
        endpoints[path].count++;
        if (typeof svcData.duration === 'number') {
          endpoints[path].durations.push(svcData.duration);
        }
      }
      
      // Method
      if (typeof svcData.method === 'string') {
        methods[svcData.method] = (methods[svcData.method] || 0) + 1;
      }
    }
  }
  
  // Calculate time range and request rate
  timestamps.sort((a, b) => a - b);
  const earliest = new Date(timestamps[0]);
  const latest = new Date(timestamps[timestamps.length - 1]);
  const durationMs = latest.getTime() - earliest.getTime();
  const durationSeconds = durationMs / 1000;
  
  // Calculate duration percentiles
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
  const avgDuration = durations.length > 0 
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length 
    : 0;
  
  // Calculate endpoint averages and sort by count
  const topEndpoints = Object.entries(endpoints)
    .map(([path, data]) => ({
      path,
      count: data.count,
      avgDuration: data.durations.length > 0
        ? data.durations.reduce((sum, d) => sum + d, 0) / data.durations.length
        : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return {
    totalLogs: logs.length,
    timeRange: {
      earliest: earliest.toISOString(),
      latest: latest.toISOString(),
      durationMs,
    },
    requestRate: {
      perSecond: durationSeconds > 0 ? logs.length / durationSeconds : 0,
      perMinute: durationSeconds > 0 ? (logs.length / durationSeconds) * 60 : 0,
    },
    durations: {
      min: durations[0] || 0,
      max: durations[durations.length - 1] || 0,
      avg: avgDuration,
      p50,
      p95,
      p99,
    },
    statusCodes,
    endpoints: Object.fromEntries(
      Object.entries(endpoints).map(([path, data]) => [
        path,
        {
          count: data.count,
          avgDuration: data.durations.length > 0
            ? data.durations.reduce((sum, d) => sum + d, 0) / data.durations.length
            : 0,
        },
      ])
    ),
    methods,
    topEndpoints,
  };
}

