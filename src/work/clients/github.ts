// GitHub API Client - READ ONLY
// Uses GITHUB_TOKEN for authentication

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  author: string;
  url: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  head: {
    ref: string; // branch name
    sha: string;
  };
  base: {
    ref: string; // target branch
  };
  body?: string; // PR description
  labels: string[];
  reviewers: string[];
  assignees: string[];
}

interface GitHubConfig {
  token: string;
}

function getConfig(): GitHubConfig {
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error('GITHUB_TOKEN not found in environment');
  }
  
  return { token };
}

async function githubFetch(endpoint: string): Promise<unknown> {
  const { token } = getConfig();
  
  const response = await fetch(`https://api.github.com${endpoint}`, {
    method: 'GET', // READ ONLY
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

/**
 * Parse GitHub repo URL to extract owner and repo name
 * Supports both HTTPS and SSH formats
 */
function parseRepoUrl(url: string): { owner: string; repo: string } {
  // https://github.com/owner/repo or https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  
  throw new Error(`Invalid GitHub URL format: ${url}`);
}

/**
 * List pull requests for a repository
 */
export async function listPullRequests(
  repoUrl: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    author?: string;
    maxResults?: number;
  } = {}
): Promise<GitHubPullRequest[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const { state = 'open', author, maxResults = 30 } = options;
  
  try {
    // Build query params
    const params = new URLSearchParams({
      state,
      per_page: Math.min(maxResults, 100).toString(),
      sort: 'updated',
      direction: 'desc',
    });
    
    const data = await githubFetch(`/repos/${owner}/${repo}/pulls?${params}`) as Array<{
      number: number;
      title: string;
      state: string;
      user: { login: string };
      html_url: string;
      created_at: string;
      updated_at: string;
      draft: boolean;
      head: { ref: string; sha: string };
      base: { ref: string };
      body?: string;
      labels: Array<{ name: string }>;
      requested_reviewers: Array<{ login: string }>;
      assignees: Array<{ login: string }>;
    }>;
    
    // Filter by author if specified
    let filtered = data;
    if (author) {
      filtered = data.filter(pr => 
        pr.user.login.toLowerCase().includes(author.toLowerCase())
      );
    }
    
    return filtered.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state as 'open' | 'closed',
      author: pr.user.login,
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      draft: pr.draft,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
      },
      body: pr.body,
      labels: pr.labels.map(l => l.name),
      reviewers: pr.requested_reviewers.map(r => r.login),
      assignees: pr.assignees.map(a => a.login),
    }));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`GitHub list PRs failed: ${errMsg}`);
  }
}

/**
 * Get a specific pull request by number
 */
export async function getPullRequest(
  repoUrl: string,
  prNumber: number
): Promise<GitHubPullRequest | null> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  try {
    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`) as {
      number: number;
      title: string;
      state: string;
      user: { login: string };
      html_url: string;
      created_at: string;
      updated_at: string;
      draft: boolean;
      head: { ref: string; sha: string };
      base: { ref: string };
      body?: string;
      labels: Array<{ name: string }>;
      requested_reviewers: Array<{ login: string }>;
      assignees: Array<{ login: string }>;
    };
    
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state as 'open' | 'closed',
      author: pr.user.login,
      url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      draft: pr.draft,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
      },
      body: pr.body,
      labels: pr.labels.map(l => l.name),
      reviewers: pr.requested_reviewers.map(r => r.login),
      assignees: pr.assignees.map(a => a.login),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

// ===== PR Review Comments =====

export interface PRReviewComment {
  id: number;
  body: string;
  author: string;
  path: string;          // File path the comment is on
  line?: number;         // Line number (if applicable)
  created_at: string;
  updated_at: string;
  html_url: string;
  // Context
  diff_hunk?: string;    // The diff snippet this comment is on
  in_reply_to_id?: number;  // If this is a reply to another comment
}

export interface PRIssueComment {
  id: number;
  body: string;
  author: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface PRComments {
  reviewComments: PRReviewComment[];  // Inline code comments
  issueComments: PRIssueComment[];    // General PR comments
  totalCount: number;
}

/**
 * Get all review comments (inline code comments) on a PR
 * These are the comments attached to specific lines of code
 */
export async function getPRReviewComments(
  repoUrl: string,
  prNumber: number
): Promise<PRReviewComment[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  try {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments`
    ) as Array<{
      id: number;
      body: string;
      user: { login: string };
      path: string;
      line?: number;
      original_line?: number;
      created_at: string;
      updated_at: string;
      html_url: string;
      diff_hunk?: string;
      in_reply_to_id?: number;
    }>;
    
    return data.map(c => ({
      id: c.id,
      body: c.body,
      author: c.user.login,
      path: c.path,
      line: c.line || c.original_line,
      created_at: c.created_at,
      updated_at: c.updated_at,
      html_url: c.html_url,
      diff_hunk: c.diff_hunk,
      in_reply_to_id: c.in_reply_to_id,
    }));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get PR review comments: ${errMsg}`);
  }
}

/**
 * Get all issue comments (general discussion comments) on a PR
 * These are the comments in the main conversation, not attached to code
 */
export async function getPRIssueComments(
  repoUrl: string,
  prNumber: number
): Promise<PRIssueComment[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  try {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments`
    ) as Array<{
      id: number;
      body: string;
      user: { login: string };
      created_at: string;
      updated_at: string;
      html_url: string;
    }>;
    
    return data.map(c => ({
      id: c.id,
      body: c.body,
      author: c.user.login,
      created_at: c.created_at,
      updated_at: c.updated_at,
      html_url: c.html_url,
    }));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to get PR issue comments: ${errMsg}`);
  }
}

/**
 * Get all comments on a PR (both review comments and issue comments)
 */
export async function getPRComments(
  repoUrl: string,
  prNumber: number
): Promise<PRComments> {
  const [reviewComments, issueComments] = await Promise.all([
    getPRReviewComments(repoUrl, prNumber),
    getPRIssueComments(repoUrl, prNumber),
  ]);
  
  return {
    reviewComments,
    issueComments,
    totalCount: reviewComments.length + issueComments.length,
  };
}

/**
 * Search for pull requests by author across a repository
 * This is a convenience wrapper around listPullRequests
 */
export async function searchPullRequestsByAuthor(
  repoUrl: string,
  author: string,
  options: {
    state?: 'open' | 'closed' | 'all';
    maxResults?: number;
  } = {}
): Promise<GitHubPullRequest[]> {
  return listPullRequests(repoUrl, {
    ...options,
    author,
  });
}

// ===== PR Check Runs and Status =====

export interface CheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  // For external services like CircleCI
  external_id?: string;
  app?: {
    slug: string;  // e.g., 'circleci-checks', 'github-actions'
    name: string;
  };
  output?: {
    title: string | null;
    summary: string | null;
    text: string | null;
    annotations_count: number;
  };
}

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
  raw_details?: string;
}

export interface CombinedStatus {
  state: 'success' | 'failure' | 'pending' | 'error';
  total_count: number;
  statuses: Array<{
    state: 'success' | 'failure' | 'pending' | 'error';
    context: string;  // e.g., 'ci/circleci: build'
    description: string | null;
    target_url: string | null;
  }>;
}

export interface PRChecksResult {
  sha: string;
  checkRuns: CheckRun[];
  combinedStatus: CombinedStatus;
  // Computed summary
  summary: {
    total: number;
    pending: number;
    passing: number;
    failing: number;
    failedChecks: Array<{
      name: string;
      type: 'check_run' | 'status';
      url: string | null;
      app?: string;
    }>;
  };
}

/**
 * Get all check runs for a PR's head commit
 */
export async function getPRCheckRuns(
  repoUrl: string,
  prNumber: number
): Promise<CheckRun[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  // First get the PR to get the head SHA
  const pr = await getPullRequest(repoUrl, prNumber);
  if (!pr) {
    throw new Error(`PR #${prNumber} not found`);
  }
  
  const data = await githubFetch(
    `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`
  ) as {
    total_count: number;
    check_runs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      started_at: string | null;
      completed_at: string | null;
      html_url: string;
      external_id?: string;
      app?: { slug: string; name: string };
      output?: {
        title: string | null;
        summary: string | null;
        text: string | null;
        annotations_count: number;
      };
    }>;
  };
  
  return data.check_runs.map(cr => ({
    id: cr.id,
    name: cr.name,
    status: cr.status as CheckRun['status'],
    conclusion: cr.conclusion as CheckRun['conclusion'],
    started_at: cr.started_at,
    completed_at: cr.completed_at,
    html_url: cr.html_url,
    external_id: cr.external_id,
    app: cr.app,
    output: cr.output,
  }));
}

/**
 * Get combined commit status (for older status API - used by some CI systems)
 */
export async function getPRCombinedStatus(
  repoUrl: string,
  prNumber: number
): Promise<CombinedStatus> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  const pr = await getPullRequest(repoUrl, prNumber);
  if (!pr) {
    throw new Error(`PR #${prNumber} not found`);
  }
  
  const data = await githubFetch(
    `/repos/${owner}/${repo}/commits/${pr.head.sha}/status`
  ) as {
    state: string;
    total_count: number;
    statuses: Array<{
      state: string;
      context: string;
      description: string | null;
      target_url: string | null;
    }>;
  };
  
  return {
    state: data.state as CombinedStatus['state'],
    total_count: data.total_count,
    statuses: data.statuses.map(s => ({
      state: s.state as CombinedStatus['statuses'][0]['state'],
      context: s.context,
      description: s.description,
      target_url: s.target_url,
    })),
  };
}

/**
 * Get all checks for a PR (both check runs and commit statuses)
 * Returns a unified view with summary
 */
export async function getPRChecks(
  repoUrl: string,
  prNumber: number
): Promise<PRChecksResult> {
  const pr = await getPullRequest(repoUrl, prNumber);
  if (!pr) {
    throw new Error(`PR #${prNumber} not found`);
  }
  
  // Fetch both in parallel
  const [checkRuns, combinedStatus] = await Promise.all([
    getPRCheckRuns(repoUrl, prNumber),
    getPRCombinedStatus(repoUrl, prNumber),
  ]);
  
  // Compute summary
  const failedChecks: PRChecksResult['summary']['failedChecks'] = [];
  
  // Count check runs
  let checkRunsPending = 0;
  let checkRunsPassing = 0;
  let checkRunsFailing = 0;
  
  for (const cr of checkRuns) {
    if (cr.status !== 'completed') {
      checkRunsPending++;
    } else if (cr.conclusion === 'success' || cr.conclusion === 'skipped' || cr.conclusion === 'neutral') {
      checkRunsPassing++;
    } else {
      checkRunsFailing++;
      failedChecks.push({
        name: cr.name,
        type: 'check_run',
        url: cr.html_url,
        app: cr.app?.slug,
      });
    }
  }
  
  // Count statuses
  let statusesPending = 0;
  let statusesPassing = 0;
  let statusesFailing = 0;
  
  for (const s of combinedStatus.statuses) {
    if (s.state === 'pending') {
      statusesPending++;
    } else if (s.state === 'success') {
      statusesPassing++;
    } else {
      statusesFailing++;
      failedChecks.push({
        name: s.context,
        type: 'status',
        url: s.target_url,
      });
    }
  }
  
  return {
    sha: pr.head.sha,
    checkRuns,
    combinedStatus,
    summary: {
      total: checkRuns.length + combinedStatus.statuses.length,
      pending: checkRunsPending + statusesPending,
      passing: checkRunsPassing + statusesPassing,
      failing: checkRunsFailing + statusesFailing,
      failedChecks,
    },
  };
}

/**
 * Get annotations (error messages) from a check run
 * This provides detailed failure information
 */
export async function getCheckRunAnnotations(
  repoUrl: string,
  checkRunId: number
): Promise<CheckRunAnnotation[]> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  const data = await githubFetch(
    `/repos/${owner}/${repo}/check-runs/${checkRunId}/annotations`
  ) as Array<{
    path: string;
    start_line: number;
    end_line: number;
    annotation_level: string;
    message: string;
    title?: string;
    raw_details?: string;
  }>;
  
  return data.map(a => ({
    path: a.path,
    start_line: a.start_line,
    end_line: a.end_line,
    annotation_level: a.annotation_level as CheckRunAnnotation['annotation_level'],
    message: a.message,
    title: a.title,
    raw_details: a.raw_details,
  }));
}

/**
 * Get GitHub Actions workflow run logs
 * Note: This returns a URL to download logs as a zip file
 */
export async function getWorkflowRunLogs(
  repoUrl: string,
  runId: number
): Promise<{ downloadUrl: string } | null> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  try {
    // The logs endpoint returns a redirect to the download URL
    const { token } = getConfig();
    
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'manual', // Don't follow redirect, we want the URL
      }
    );
    
    if (response.status === 302) {
      const downloadUrl = response.headers.get('location');
      if (downloadUrl) {
        return { downloadUrl };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Get workflow run details (for GitHub Actions)
 */
export async function getWorkflowRun(
  repoUrl: string,
  runId: number
): Promise<{
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  jobs_url: string;
} | null> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  try {
    const data = await githubFetch(
      `/repos/${owner}/${repo}/actions/runs/${runId}`
    ) as {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      html_url: string;
      jobs_url: string;
    };
    
    return data;
  } catch {
    return null;
  }
}

/**
 * Get workflow run jobs (for GitHub Actions - shows individual job failures)
 */
export async function getWorkflowRunJobs(
  repoUrl: string,
  runId: number
): Promise<Array<{
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
  }>;
}>> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  
  const data = await githubFetch(
    `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
  ) as {
    jobs: Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      started_at: string;
      completed_at: string | null;
      steps: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        number: number;
      }>;
    }>;
  };
  
  return data.jobs;
}

// Export parseRepoUrl for use by other modules
export { parseRepoUrl };

export function isGitHubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

export function getGitHubConfigStatus(): { configured: boolean; error?: string } {
  if (!process.env.GITHUB_TOKEN) {
    return { configured: false, error: 'GITHUB_TOKEN not set' };
  }
  return { configured: true };
}

