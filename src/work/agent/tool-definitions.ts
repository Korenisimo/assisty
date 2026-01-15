// Tool definitions for the work agent
// These define the schema and description for each tool

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Define ALL tools for the agent

export const jiraGetTicketTool = tool(
  async () => '', // Placeholder - actual execution in executeTool
  {
    name: 'jira_get_ticket',
    description: 'Get a specific JIRA ticket by its key (e.g., PROJ-123). Returns ticket details including summary, description, status, and comments.',
    schema: z.object({
      ticketKey: z.string().describe('The JIRA ticket key (e.g., PROJ-123)'),
    }),
  }
);

export const jiraSearchTool = tool(
  async () => '',
  {
    name: 'jira_search',
    description: 'Search JIRA tickets by text or JQL query. Supports full JQL syntax (e.g., "project = PROJ AND status = Open").',
    schema: z.object({
      query: z.string().describe('Search text or JQL query'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 10)'),
    }),
  }
);

export const jiraUnassignedTool = tool(
  async () => '',
  {
    name: 'jira_unassigned_tickets',
    description: 'Get unassigned tickets from a JIRA project. Perfect for finding backlog items to work on.',
    schema: z.object({
      projectKey: z.string().describe('JIRA project key (e.g., PROJ, TASK)'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 50)'),
    }),
  }
);

export const jiraBacklogTool = tool(
  async () => '',
  {
    name: 'jira_backlog',
    description: 'Get backlog tickets from a JIRA project (unassigned or in Backlog/To Do status).',
    schema: z.object({
      projectKey: z.string().describe('JIRA project key (e.g., PROJ, TASK)'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 50)'),
    }),
  }
);

export const jiraBoardTool = tool(
  async () => '',
  {
    name: 'jira_board',
    description: 'Get tickets from a JIRA board or filter by ID.',
    schema: z.object({
      boardOrFilterId: z.string().describe('Board ID or filter ID'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 50)'),
    }),
  }
);

export const jiraCreateTicketTool = tool(
  async () => '',
  {
    name: 'jira_create_ticket',
    description: 'Create a new JIRA ticket. Returns the new ticket key and URL.',
    schema: z.object({
      projectKey: z.string().describe('JIRA project key (e.g., PROJ, TASK)'),
      summary: z.string().describe('Ticket summary/title'),
      description: z.string().optional().describe('Ticket description (plain text, will be converted to Atlassian format)'),
      issueType: z.string().optional().describe('Issue type (default: Task). Common types: Task, Bug, Story, Epic'),
      priority: z.string().optional().describe('Priority (e.g., High, Medium, Low)'),
      labels: z.array(z.string()).optional().describe('Labels to add to the ticket'),
      assignee: z.string().optional().describe('Account ID of assignee'),
      components: z.array(z.string()).optional().describe('Component names'),
    }),
  }
);

export const jiraAddCommentTool = tool(
  async () => '',
  {
    name: 'jira_add_comment',
    description: 'Add a comment to a JIRA ticket. ONLY use this if the user EXPLICITLY asks you to comment on a ticket. Do not use proactively.',
    schema: z.object({
      ticketKey: z.string().describe('The JIRA ticket key (e.g., PROJ-123)'),
      comment: z.string().describe('The comment text to add (plain text, will be converted to Atlassian format)'),
    }),
  }
);

export const confluenceSearchTool = tool(
  async () => '',
  {
    name: 'confluence_search',
    description: 'Search Confluence pages by text. Use this to find documentation, runbooks, and knowledge articles.',
    schema: z.object({
      query: z.string().describe('Search query text'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 10)'),
    }),
  }
);

export const confluenceCreatePageTool = tool(
  async () => '',
  {
    name: 'confluence_create_page',
    description: `Create a new Confluence page. ONLY use when user EXPLICITLY asks to create a page or document.
    
Content can be:
- Plain text (will be wrapped in paragraphs)
- Markdown (set convertFromMarkdown: true for basic conversion)
- Confluence storage format (HTML-like)

To find the spaceKey, use confluence_list_spaces first if unsure.`,
    schema: z.object({
      spaceKey: z.string().describe('Confluence space key (e.g., "TEAM", "ENG"). Use confluence_list_spaces if unsure.'),
      title: z.string().describe('Page title'),
      content: z.string().describe('Page content (plain text, markdown, or Confluence storage format)'),
      parentPageId: z.string().optional().describe('Parent page ID to nest under (optional)'),
      convertFromMarkdown: z.boolean().optional().describe('If true, converts markdown to Confluence format (default: false)'),
    }),
  }
);

export const confluenceListSpacesTool = tool(
  async () => '',
  {
    name: 'confluence_list_spaces',
    description: 'List available Confluence spaces. Use this to find the spaceKey for confluence_create_page.',
    schema: z.object({
      limit: z.number().optional().describe('Maximum spaces to return (default: 25)'),
    }),
  }
);

export const confluenceGetPageTool = tool(
  async () => '',
  {
    name: 'confluence_get_page',
    description: `Get full content of a Confluence page by its ID.
Use this AFTER confluence_search to read the full page content.
Returns the page title, full text content, URL, space, and last modified date.`,
    schema: z.object({
      pageId: z.string().describe('The Confluence page ID (from confluence_search results)'),
    }),
  }
);

export const confluenceGetCommentsTool = tool(
  async () => '',
  {
    name: 'confluence_get_comments',
    description: `Get comments/replies on a Confluence page.
Use this to read discussion threads, feedback, and inline comments on a document.
Returns comment author, content, and creation date.`,
    schema: z.object({
      pageId: z.string().describe('The Confluence page ID'),
      includeInline: z.boolean().optional().describe('Include inline/annotation comments (default: true)'),
    }),
  }
);

export const firehydrantSearchIncidentsTool = tool(
  async () => '',
  {
    name: 'firehydrant_search_incidents',
    description: 'Search FireHydrant incidents by text query.',
    schema: z.object({
      query: z.string().describe('Search query text'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 10)'),
    }),
  }
);

export const firehydrantGetIncidentTool = tool(
  async () => '',
  {
    name: 'firehydrant_get_incident',
    description: 'Get a specific FireHydrant incident by ID.',
    schema: z.object({
      incidentId: z.string().describe('The FireHydrant incident ID'),
    }),
  }
);

export const firehydrantRecentIncidentsTool = tool(
  async () => '',
  {
    name: 'firehydrant_recent_incidents',
    description: 'Get recent FireHydrant incidents.',
    schema: z.object({
      maxResults: z.number().optional().describe('Maximum results to return (default: 10)'),
    }),
  }
);

export const datadogSearchLogsTool = tool(
  async () => '',
  {
    name: 'datadog_search_logs',
    description: `Search Datadog logs. Use Datadog query syntax.
IMPORTANT: For historical alerts, ALWAYS specify from/to based on the alert timestamp!
Default time range is last 24 hours - this is WRONG for old alerts.`,
    schema: z.object({
      query: z.string().describe('Datadog log search query (e.g., "@http.request_id:xxx" or "service:myapp status:error")'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 50)'),
      from: z.string().optional().describe('Start time as ISO string (e.g., "2025-12-16T06:00:00Z"). REQUIRED for historical alerts!'),
      to: z.string().optional().describe('End time as ISO string (e.g., "2025-12-16T08:00:00Z"). REQUIRED for historical alerts!'),
    }),
  }
);

export const datadogGetMonitorsTool = tool(
  async () => '',
  {
    name: 'datadog_get_monitors',
    description: 'Get Datadog monitors, optionally filtered by name.',
    schema: z.object({
      query: z.string().optional().describe('Optional monitor name filter'),
    }),
  }
);

export const datadogGetRequestTraceTool = tool(
  async () => '',
  {
    name: 'datadog_get_request_trace',
    description: 'Get Datadog logs for a specific request ID or trace ID.',
    schema: z.object({
      requestId: z.string().describe('The request ID or trace ID to look up'),
    }),
  }
);

export const datadogQueryMetricsTool = tool(
  async () => '',
  {
    name: 'datadog_query_metrics',
    description: `Query Datadog metrics (time series data). Use this to get aggregated performance data like latency, error rates, throughput, etc.

Example queries:
- avg:postgresql.query.duration{query_comment:*users*email*} by {query_comment}
- sum:envoy.http.downstream.rq_xx{response_code_class:5xx} by {upstream_cluster}
- p95:http.request.duration{service:api-gateway} by {route}

Returns series data with timestamps and values, plus summary stats (sum, avg, max, min).`,
    schema: z.object({
      query: z.string().describe('Datadog metric query (e.g., "avg:postgresql.query.duration{...} by {...}")'),
      from: z.string().describe('Start time as ISO string (e.g., "2025-11-20T00:00:00Z")'),
      to: z.string().describe('End time as ISO string (e.g., "2025-11-27T23:59:59Z")'),
    }),
  }
);

// === DATABASE MONITORING (DBM) TOOLS ===
// NOTE: Datadog does NOT have a public REST API for DBM query samples or host index details.
// These tools use the metrics API and provide UI instructions for detailed data.

export const datadogDbmQueryMetricsTool = tool(
  async () => '',
  {
    name: 'datadog_dbm_query_metrics',
    description: `Get PostgreSQL query performance metrics via Datadog metrics API.

Queries metrics like postgresql.queries.time and postgresql.queries.count.
Also returns UI instructions for finding detailed query samples and explain plans.

NOTE: For individual query samples and explain plans, users must use the Datadog UI directly
(Infrastructure → Database Monitoring → Query Samples).`,
    schema: z.object({
      service: z.string().optional().describe('Filter by service name'),
      dbName: z.string().optional().describe('Filter by database name'),
      host: z.string().optional().describe('Filter by host'),
      from: z.string().optional().describe('Start time as ISO string (default: 24 hours ago)'),
      to: z.string().optional().describe('End time as ISO string (default: now)'),
    }),
  }
);

export const datadogDbmIndexMetricsTool = tool(
  async () => '',
  {
    name: 'datadog_dbm_index_metrics',
    description: `Get PostgreSQL index utilization metrics via Datadog metrics API.

Queries metrics like postgresql.index_scans and postgresql.index_rows_fetched.
Use this to check if an index is being used after deployment.

Also returns UI instructions for finding detailed index statistics in the Datadog UI
(Infrastructure → Database Monitoring → Databases → Indexes tab).`,
    schema: z.object({
      indexName: z.string().optional().describe('Index name to search for (partial match)'),
      service: z.string().optional().describe('Filter by service name'),
      host: z.string().optional().describe('Filter by host'),
      from: z.string().optional().describe('Start time as ISO string (default: 24 hours ago)'),
      to: z.string().optional().describe('End time as ISO string (default: now)'),
    }),
  }
);

export const datadogDbmHostMetricsTool = tool(
  async () => '',
  {
    name: 'datadog_dbm_host_metrics',
    description: `Get database host performance metrics via Datadog metrics API.

Queries metrics like postgresql.connections and postgresql.locks.
Also returns UI instructions for the full database host view.`,
    schema: z.object({
      service: z.string().optional().describe('Filter by service name'),
      host: z.string().optional().describe('Filter by specific host'),
      from: z.string().optional().describe('Start time as ISO string (default: 24 hours ago)'),
      to: z.string().optional().describe('End time as ISO string (default: now)'),
    }),
  }
);

// GitHub tools

export const githubListPRsTool = tool(
  async () => '',
  {
    name: 'github_list_prs',
    description: 'List pull requests from a GitHub repository. Can filter by author and state (open/closed/all).',
    schema: z.object({
      repoUrl: z.string().describe('GitHub repository URL (e.g., https://github.com/owner/repo)'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('PR state to filter by (default: open)'),
      author: z.string().optional().describe('Filter by PR author username'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 30)'),
    }),
  }
);

export const githubGetPRTool = tool(
  async () => '',
  {
    name: 'github_get_pr',
    description: 'Get details of a specific pull request by number.',
    schema: z.object({
      repoUrl: z.string().describe('GitHub repository URL (e.g., https://github.com/owner/repo)'),
      prNumber: z.number().describe('Pull request number'),
    }),
  }
);

export const githubSearchPRsByAuthorTool = tool(
  async () => '',
  {
    name: 'github_search_prs_by_author',
    description: 'Search for pull requests by author. Convenience wrapper that filters PRs by author name.',
    schema: z.object({
      repoUrl: z.string().describe('GitHub repository URL (e.g., https://github.com/owner/repo)'),
      author: z.string().describe('Author username to search for'),
      state: z.enum(['open', 'closed', 'all']).optional().describe('PR state to filter by (default: open)'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 30)'),
    }),
  }
);

export const githubGetPRChecksTool = tool(
  async () => '',
  {
    name: 'github_get_pr_checks',
    description: 'Get CI check runs and status checks for a PR. Returns all checks with their status (pending/passing/failing) and failure details.',
    schema: z.object({
      repoUrl: z.string().describe('GitHub repository URL (e.g., https://github.com/owner/repo)'),
      prNumber: z.number().describe('Pull request number'),
    }),
  }
);

export const githubGetPRCommentsTool = tool(
  async () => '',
  {
    name: 'github_get_pr_comments',
    description: `Get all comments on a pull request, including:
- Review comments: Inline code comments attached to specific lines
- Issue comments: General discussion comments in the PR conversation

Returns comment body, author, file path (for review comments), and timestamps.
Use this to understand review feedback before making fixes.`,
    schema: z.object({
      repoUrl: z.string().describe('GitHub repository URL (e.g., https://github.com/owner/repo)'),
      prNumber: z.number().describe('Pull request number'),
    }),
  }
);

// PR Tracking tools - for automated CI monitoring and fix workflow

export const prWatchStartTool = tool(
  async () => '',
  {
    name: 'pr_watch_start',
    description: `Start watching a PR for CI failures. The system will:
1. Clone the repo (if needed) and checkout the PR branch
2. Poll CI status every 45 seconds
3. On failure: automatically invoke Cursor to fix and commit
4. On success: offer to squash commits

Supports GitHub Actions and CircleCI. For CircleCI failures without accessible logs,
it will first try to fix based on the step name, then ask for manual logs if needed.`,
    schema: z.object({
      prUrl: z.string().describe('PR URL (e.g., https://github.com/owner/repo/pull/123) or short format (owner/repo#123)'),
    }),
  }
);

export const prWatchStopTool = tool(
  async () => '',
  {
    name: 'pr_watch_stop',
    description: 'Stop watching a PR (or all PRs if no sessionId provided). Returns session summary.',
    schema: z.object({
      sessionId: z.string().optional().describe('Session ID to stop. If omitted, stops all active watches.'),
    }),
  }
);

export const prWatchStatusTool = tool(
  async () => '',
  {
    name: 'pr_watch_status',
    description: 'Get status of all active PR watch sessions, including current focus, fix attempts, and states. Shows multi-PR queue.',
    schema: z.object({}),
  }
);

export const prProvideLogsTool = tool(
  async () => '',
  {
    name: 'pr_provide_logs',
    description: 'Provide manual CI logs when the system cannot automatically fetch them (e.g., CircleCI). Use when the system asks for logs.',
    schema: z.object({
      sessionId: z.string().describe('Session ID that needs the logs'),
      logs: z.string().describe('The CI logs to analyze. Paste the relevant failure output.'),
    }),
  }
);

export const prSquashCommitsTool = tool(
  async () => '',
  {
    name: 'pr_squash_commits',
    description: 'Squash all commits made since watch started into a single commit. Only available after CI passes.',
    schema: z.object({
      sessionId: z.string().describe('Session ID to squash commits for'),
      message: z.string().describe('Commit message for the squashed commit'),
    }),
  }
);

// Task Executor tools - Autonomous task completion from start to finish

export const taskExecuteStartTool = tool(
  async () => '',
  {
    name: 'task_execute_start',
    description: `Start autonomous task execution. This will:
1. Ask if user wants to prioritize tasks or let assistant choose
2. Pick a task (JIRA ticket or PR)
3. Clone repo, create branch if needed
4. Send to Cursor to implement/fix
5. Create PR (for JIRA) or push fixes (for PR)
6. Monitor CI until green
7. Ask user to continue with next task

Use this when user says things like "work on my tasks", "do my tasks", "execute tasks".`,
    schema: z.object({
      taskId: z.string().optional().describe('Specific task ID to execute (optional - if not provided, will prioritize)'),
      userPrioritizes: z.boolean().optional().describe('If true, ask user to pick the task. If false/omitted, assistant auto-prioritizes.'),
    }),
  }
);

export const taskExecuteStatusTool = tool(
  async () => '',
  {
    name: 'task_execute_status',
    description: 'Get the current status of autonomous task execution.',
    schema: z.object({}),
  }
);

export const taskExecuteChoiceTool = tool(
  async () => '',
  {
    name: 'task_execute_choice',
    description: 'Provide a choice when the task executor is waiting for user input (e.g., repo selection, task selection, continue/stop).',
    schema: z.object({
      choice: z.string().describe('The choice - could be a task ID, repo URL, "yes"/"no" for continue, etc.'),
    }),
  }
);

export const taskExecuteStopTool = tool(
  async () => '',
  {
    name: 'task_execute_stop',
    description: 'Stop the current task execution.',
    schema: z.object({
      reason: z.string().optional().describe('Reason for stopping'),
    }),
  }
);

// LinkedIn & CV Management tools

export const setLinkedInTool = tool(
  async () => '',
  {
    name: 'set_linkedin',
    description: 'Set the user\'s LinkedIn profile URL for profile review.',
    schema: z.object({
      url: z.string().describe('LinkedIn profile URL (e.g., https://www.linkedin.com/in/username)'),
    }),
  }
);

export const setCVTool = tool(
  async () => '',
  {
    name: 'set_cv',
    description: 'Set the path to the user\'s CV/resume file.',
    schema: z.object({
      path: z.string().describe('Path to CV file (e.g., ~/Documents/my-cv.pdf)'),
    }),
  }
);

export const getProfileConfigTool = tool(
  async () => '',
  {
    name: 'get_profile_config',
    description: 'Get current LinkedIn and CV configuration.',
    schema: z.object({}),
  }
);

export const startProfileReviewTool = tool(
  async () => '',
  {
    name: 'start_profile_review',
    description: `Start a consultative LinkedIn & CV review session. This will:
1. Review your LinkedIn profile using the browser
2. Review your CV content
3. Compare with your achievements and PDP goals
4. Generate recommendations step-by-step
5. Let you approve/reject each recommendation

Use this when user wants to update their LinkedIn or CV, or says things like "help me with my LinkedIn", "update my resume".`,
    schema: z.object({}),
  }
);

export const getReviewSessionTool = tool(
  async () => '',
  {
    name: 'get_review_session',
    description: 'Get the current profile review session status and recommendations.',
    schema: z.object({}),
  }
);

export const approveRecommendationTool = tool(
  async () => '',
  {
    name: 'approve_recommendation',
    description: 'Approve or reject a profile recommendation.',
    schema: z.object({
      recommendationId: z.string().describe('The recommendation ID'),
      approved: z.boolean().describe('Whether to approve (true) or reject (false)'),
    }),
  }
);

export const completeProfileReviewTool = tool(
  async () => '',
  {
    name: 'complete_profile_review',
    description: 'Complete the profile review session and get summary of approved changes.',
    schema: z.object({}),
  }
);

// Shell and file system tools

export const shellCommandTool = tool(
  async () => '',
  {
    name: 'shell_command',
    description: 'Execute a shell command in the workspace (WORK_DIRS). Use for git, file operations, etc. Commands run with a 2-minute timeout.',
    schema: z.object({
      command: z.string().describe('The shell command to execute'),
      workingDir: z.string().optional().describe('Working directory relative to WORK_DIRS (optional)'),
    }),
  }
);

export const createDirTool = tool(
  async () => '',
  {
    name: 'create_directory',
    description: 'Create a directory in the workspace (WORK_DIRS).',
    schema: z.object({
      path: z.string().describe('Directory path relative to WORK_DIRS'),
    }),
  }
);

export const writeFileTool = tool(
  async () => '',
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace (WORK_DIRS).',
    schema: z.object({
      path: z.string().describe('File path relative to WORK_DIRS'),
      content: z.string().describe('Content to write to the file'),
    }),
  }
);

export const readFileTool = tool(
  async () => '',
  {
    name: 'read_file',
    description: 'Read content from a file in the workspace (WORK_DIRS).',
    schema: z.object({
      path: z.string().describe('File path relative to WORK_DIRS'),
    }),
  }
);

export const listDirTool = tool(
  async () => '',
  {
    name: 'list_directory',
    description: 'List contents of a directory in the workspace (WORK_DIRS).',
    schema: z.object({
      path: z.string().optional().describe('Directory path relative to WORK_DIRS (empty for root)'),
    }),
  }
);

export const pathExistsTool = tool(
  async () => '',
  {
    name: 'path_exists',
    description: 'Check if a path exists in the workspace (WORK_DIRS).',
    schema: z.object({
      path: z.string().describe('Path to check relative to WORK_DIRS'),
    }),
  }
);

// === GIT OPERATIONS ===

export const gitPushTool = tool(
  async () => '',
  {
    name: 'git_push',
    description: `Push changes to remote with detailed error handling.
Returns success/failure with:
- commitSha: The commit that was pushed
- branch: Branch name
- errorType: 'auth' | 'upstream' | 'conflict' | 'network' if failed
- suggestion: How to fix the error

Checks for uncommitted changes first and provides clear feedback.`,
    schema: z.object({
      repoPath: z.string().describe('Path to the git repository (relative to WORK_DIRS)'),
      branch: z.string().optional().describe('Branch to push (defaults to current branch)'),
      setUpstream: z.boolean().optional().describe('Set upstream tracking (default: true)'),
      force: z.boolean().optional().describe('Force push with lease (default: false)'),
    }),
  }
);

export const gitCommitAllTool = tool(
  async () => '',
  {
    name: 'git_commit_all',
    description: 'Stage all changes and commit with a message. Returns the new commit SHA.',
    schema: z.object({
      repoPath: z.string().describe('Path to the git repository (relative to WORK_DIRS)'),
      message: z.string().describe('Commit message'),
    }),
  }
);

export const gitStatusTool = tool(
  async () => '',
  {
    name: 'git_status',
    description: 'Get detailed git status for a repository: branch, staged/unstaged/untracked files, ahead/behind counts.',
    schema: z.object({
      repoPath: z.string().describe('Path to the git repository (relative to WORK_DIRS)'),
    }),
  }
);

// === INFRASTRUCTURE TOOLS - K8s, databases, DevOps ===
// These open NEW terminal windows for interactive use

export const infraTerminalTool = tool(
  async () => '',
  {
    name: 'infra_open_terminal',
    description: `Open a NEW terminal window and run a command. Use for long-running or interactive commands.
SAFETY: Only read-only commands are allowed. Mutating commands (delete, update, etc.) will be blocked.`,
    schema: z.object({
      command: z.string().describe('Command to run in the new terminal'),
      title: z.string().optional().describe('Title for the terminal window'),
      directory: z.string().optional().describe('Working directory for the command'),
    }),
  }
);

export const infraRunCommandTool = tool(
  async () => '',
  {
    name: 'infra_run_command',
    description: `Run an infrastructure command and get the output. Use for quick commands that return output.
SAFETY: Only read-only commands allowed. Blocks delete/update/edit commands.`,
    schema: z.object({
      command: z.string().describe('Command to run'),
      timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
    }),
  }
);

export const infraTshStatusTool = tool(
  async () => '',
  {
    name: 'infra_tsh_status',
    description: 'Check if tsh (Teleport) is available and if user is logged in.',
    schema: z.object({}),
  }
);

export const infraTshLoginTool = tool(
  async () => '',
  {
    name: 'infra_tsh_login',
    description: 'Open a terminal for Teleport login. User will need to complete the login interactively.',
    schema: z.object({}),
  }
);

export const infraListKubeEnvsTool = tool(
  async () => '',
  {
    name: 'infra_list_kube_envs',
    description: 'List available Kubernetes environments (tsh kube ls). May require login if session expired.',
    schema: z.object({}),
  }
);

export const infraLoginKubeTool = tool(
  async () => '',
  {
    name: 'infra_login_kube',
    description: 'Login to a Kubernetes environment. Opens terminal for tsh kube login.',
    schema: z.object({
      environment: z.string().describe('Environment name to login to'),
    }),
  }
);

export const infraSearchDatabasesTool = tool(
  async () => '',
  {
    name: 'infra_search_databases',
    description: 'Search for databases available in Teleport (tsh db ls --search).',
    schema: z.object({
      query: z.string().describe('Search query for database names'),
    }),
  }
);

export const infraProxyDatabaseTool = tool(
  async () => '',
  {
    name: 'infra_proxy_database',
    description: `Login to a database and start a proxy. Opens a terminal that stays open for the proxy.
After this, user can connect with a DB client (DBeaver, etc.) to localhost on the specified port.
I CANNOT run SQL queries - I can only proxy the database for the user.`,
    schema: z.object({
      database: z.string().describe('Database name from tsh db ls'),
      dbUser: z.string().describe('Database user (e.g., db-admin@staging-region-1.iam)'),
      dbName: z.string().describe('Database name to connect to (e.g., myappdb)'),
      port: z.number().optional().describe('Local port for proxy (default: random high port)'),
    }),
  }
);

export const infraGetPodsTool = tool(
  async () => '',
  {
    name: 'infra_get_pods',
    description: 'Get pods in a Kubernetes namespace. Can filter by name pattern.',
    schema: z.object({
      namespace: z.string().describe('Kubernetes namespace (e.g., "default", "production")'),
      filter: z.string().optional().describe('Filter pattern for pod names (e.g., "api-service")'),
    }),
  }
);

export const infraPortForwardTool = tool(
  async () => '',
  {
    name: 'infra_port_forward',
    description: 'Port forward to a pod. Opens a terminal that stays open for the port-forward.',
    schema: z.object({
      pod: z.string().describe('Pod name'),
      ports: z.string().describe('Port mapping (e.g., "8080:8080")'),
      namespace: z.string().optional().describe('Kubernetes namespace (default: "default")'),
    }),
  }
);

export const infraGetPodLogsTool = tool(
  async () => '',
  {
    name: 'infra_get_pod_logs',
    description: 'Get logs from a pod. Can follow logs in a terminal or return recent logs.',
    schema: z.object({
      pod: z.string().describe('Pod name'),
      namespace: z.string().optional().describe('Kubernetes namespace (default: "default")'),
      lines: z.number().optional().describe('Number of lines to fetch (default: all)'),
      follow: z.boolean().optional().describe('If true, opens terminal to follow logs'),
      container: z.string().optional().describe('Container name if pod has multiple'),
    }),
  }
);

export const infraDescribePodTool = tool(
  async () => '',
  {
    name: 'infra_describe_pod',
    description: 'Get detailed description of a pod (kubectl describe pod).',
    schema: z.object({
      pod: z.string().describe('Pod name'),
      namespace: z.string().optional().describe('Kubernetes namespace (default: "default")'),
    }),
  }
);

export const infraRememberKnowledgeTool = tool(
  async () => '',
  {
    name: 'infra_remember',
    description: `Remember a command, database connection, or infrastructure knowledge for future use.
Use this when the user teaches you something new about their infrastructure.`,
    schema: z.object({
      category: z.enum(['database', 'kubernetes', 'command', 'service', 'environment', 'credential']).describe('Category of knowledge'),
      key: z.string().describe('What this knowledge is about (e.g., "app-dev-db", "api-port")'),
      content: z.string().describe('The actual knowledge/command/value'),
      context: z.string().optional().describe('When/how to use this'),
      examples: z.array(z.string()).optional().describe('Example usages'),
    }),
  }
);

export const infraSearchKnowledgeTool = tool(
  async () => '',
  {
    name: 'infra_search_knowledge',
    description: 'Search your infrastructure knowledge for commands, databases, services, etc.',
    schema: z.object({
      query: z.string().describe('Search query'),
    }),
  }
);

export const infraGetKnowledgeTool = tool(
  async () => '',
  {
    name: 'infra_get_knowledge',
    description: 'Get all infrastructure knowledge of a specific category.',
    schema: z.object({
      category: z.enum(['database', 'kubernetes', 'command', 'service', 'environment', 'credential']).describe('Category to retrieve'),
    }),
  }
);

export const infraListSessionsTool = tool(
  async () => '',
  {
    name: 'infra_list_sessions',
    description: 'List active infrastructure sessions (database proxies, port-forwards).',
    schema: z.object({}),
  }
);

export const infraEndSessionTool = tool(
  async () => '',
  {
    name: 'infra_end_session',
    description: 'Mark an infrastructure session as ended. Note: This only updates tracking - user may need to close the terminal manually.',
    schema: z.object({
      sessionId: z.string().describe('Session ID to end'),
    }),
  }
);

// === CURSOR CLI TOOLS - Programmatic control of Cursor agent ===
// IMPORTANT: Always ask user before calling cursor_start_task!

export const cursorLoginTool = tool(
  async () => '',
  {
    name: 'cursor_login',
    description: `Run Cursor CLI login process. Opens browser for OAuth authentication.
⚠️ IMPORTANT: After calling this, WAIT for the user to confirm they have completed login before proceeding.
The login opens a browser - user must complete OAuth flow there.

Call this BEFORE cursor_start_task if auth status shows not logged in.`,
    schema: z.object({}),
  }
);

export const cursorStartTaskTool = tool(
  async () => '',
  {
    name: 'cursor_start_task',
    description: `Start a new Cursor agent session with an initial prompt.
⚠️ IMPORTANT: ALWAYS ask the user for permission before calling this tool!
First explain what you plan to have Cursor do, then wait for user confirmation.

Use this after creating a handoff (TASK.md) to have Cursor work on a codebase task.

WORKSPACE GUIDANCE:
- codeWorkspace: Should be the CLONED REPO directory where the actual code lives (e.g., WORK_DIRS/CLONED_REPOS/my-repo)
- taskFile: Path to the TASK.md with instructions (e.g., WORK_DIRS/my-task/TASK.md)
- The prompt should tell Cursor to read the task file for context, then work in the code workspace`,
    schema: z.object({
      prompt: z.string().describe('Initial prompt/instructions for Cursor agent'),
      codeWorkspace: z.string().describe('Directory where the CODE lives (the cloned repo) - Cursor will work here'),
      taskFile: z.string().optional().describe('Path to TASK.md file with detailed instructions (Cursor will read this for context)'),
      model: z.string().optional().describe('Model to use (e.g., "sonnet-4", "gpt-5")'),
    }),
  }
);

export const cursorContinueTool = tool(
  async () => '',
  {
    name: 'cursor_continue',
    description: `Send a follow-up prompt to the active Cursor session.
Uses --resume to continue the existing conversation.
Only works if there is an active session from cursor_start_task.`,
    schema: z.object({
      prompt: z.string().describe('Follow-up prompt/instructions for Cursor'),
    }),
  }
);

export const cursorGetStatusTool = tool(
  async () => '',
  {
    name: 'cursor_get_status',
    description: 'Check the status of the current Cursor session.',
    schema: z.object({}),
  }
);

export const cursorEndSessionTool = tool(
  async () => '',
  {
    name: 'cursor_end_session',
    description: 'End the current Cursor session. Use when the task is complete or to abandon and start fresh. This will terminate the Cursor process if still running.',
    schema: z.object({}),
  }
);

export const cursorForceCleanupTool = tool(
  async () => '',
  {
    name: 'cursor_force_cleanup',
    description: `Emergency cleanup for stuck/orphaned Cursor sessions. Use ONLY when:
- cursor_end_session fails
- You believe a Cursor process is stuck or orphaned
- The assistant crashed/restarted and left a Cursor session running

This will forcefully terminate any tracked Cursor process.
⚠️ Use sparingly - prefer cursor_end_session for normal cleanup.`,
    schema: z.object({}),
  }
);

export const cursorVerifyChangesTool = tool(
  async () => '',
  {
    name: 'cursor_verify_changes',
    description: `Verify changes made by a Cursor agent in a workspace.
Runs compilation checks, linting, and optionally tests.
Use this AFTER cursor_start_task or cursor_continue to verify the work was done correctly.

Returns:
- compiles: Whether the code compiles/builds
- lintErrors: Any linting errors found
- changedFiles: List of uncommitted changes
- reviewSummary: Optional AI review of the changes`,
    schema: z.object({
      workspace: z.string().describe('Path to the workspace to verify'),
      runTests: z.boolean().optional().describe('Run tests (slower, default: false)'),
      useReviewAgent: z.boolean().optional().describe('Use another Cursor agent to review changes (default: false)'),
    }),
  }
);

export const cursorSetCliPathTool = tool(
  async () => '',
  {
    name: 'cursor_set_cli_path',
    description: `Manually configure the Cursor CLI path when auto-detection fails.
Use this when cursor_start_task fails with "Cursor CLI not found" error.

The path should point to the 'cursor' binary, typically:
- macOS: /Applications/Cursor.app/Contents/Resources/app/bin/cursor
- Linux: /usr/local/bin/cursor or /snap/bin/cursor

After setting the path, you can retry cursor_start_task.`,
    schema: z.object({
      path: z.string().describe('Full path to the cursor binary'),
    }),
  }
);

// === PROJECT KNOWLEDGE TOOLS - On-demand retrieval ===

export const projectRememberTool = tool(
  async () => '',
  {
    name: 'project_remember',
    description: `Remember project-specific knowledge for future reference.
Use this when you discover or are told about APIs, design docs, project context, integration details, troubleshooting tips, etc.
This creates searchable project knowledge that you can retrieve in future conversations.`,
    schema: z.object({
      projectName: z.string().describe('Project name or identifier (e.g., "user-api", "billing-service", "identity-service")'),
      category: z.enum(['api', 'design', 'link', 'context', 'troubleshoot', 'integration']).describe('Category of knowledge'),
      title: z.string().describe('Short searchable title (e.g., "POST endpoint for project creation", "Main design RFC")'),
      content: z.string().describe('The actual knowledge to remember'),
      tags: z.array(z.string()).optional().describe('Additional searchable tags'),
      links: z.array(z.string()).optional().describe('Related URLs'),
    }),
  }
);

export const projectSearchTool = tool(
  async () => '',
  {
    name: 'project_search',
    description: `Search project knowledge for relevant information.
Use this BEFORE searching external sources (JIRA, Confluence) when user asks about a project you might already know about.
This retrieves previously saved knowledge about APIs, design docs, integrations, troubleshooting tips, etc.`,
    schema: z.object({
      query: z.string().describe('Search query - can include project names, keywords, concepts'),
    }),
  }
);

export const projectGetTool = tool(
  async () => '',
  {
    name: 'project_get',
    description: 'Get all knowledge about a specific project.',
    schema: z.object({
      projectName: z.string().describe('Project name to retrieve knowledge for'),
    }),
  }
);

export const projectListTool = tool(
  async () => '',
  {
    name: 'project_list',
    description: 'List all projects that have saved knowledge.',
    schema: z.object({}),
  }
);

export const projectDeleteTool = tool(
  async () => '',
  {
    name: 'project_delete',
    description: 'Delete a specific piece of project knowledge.',
    schema: z.object({
      id: z.string().describe('ID of the knowledge entry to delete'),
    }),
  }
);

// === SELF-CHECKLIST TOOL ===

export const updateChecklistTool = tool(
  async () => '',
  {
    name: 'update_checklist',
    description: `Update your internal checklist/plan for the current task.
Use this when working on complex multi-step tasks to:
1. Create a plan at the start (action: 'set')
2. Mark items as you work on them (action: 'update')
3. Clear when done (action: 'clear')

The checklist is displayed to the user so they can see your progress.`,
    schema: z.object({
      action: z.enum(['set', 'update', 'clear']).describe('Action to perform'),
      goal: z.string().optional().describe('Overall goal (required for "set" action)'),
      items: z.array(z.object({
        id: z.string().describe('Unique item ID'),
        task: z.string().describe('Task description'),
        status: z.enum(['pending', 'in_progress', 'done', 'skipped']).describe('Item status'),
      })).optional().describe('Checklist items (required for "set", optional for "update")'),
    }),
  }
);

// === COMPOUND TOOLS - Complete workflows in one call ===

export const cloneRepoTool = tool(
  async () => '',
  {
    name: 'clone_repo',
    description: `Clone a git repository. 

When branch is specified: Creates ISOLATED clone at CLONED_REPOS/<repo>-<branch>
- Each branch gets its own directory - no conflicts between parallel workstreams
- Example: clone_repo("https://github.com/org/repo", "feature/my-work") -> CLONED_REPOS/repo-feature-my-work

When branch is NOT specified: Creates shared clone at CLONED_REPOS/<repo>
- Legacy behavior, may need branch locking for parallel access

BEST PRACTICE: Always specify branch for workstream tasks to ensure isolation.`,
    schema: z.object({
      url: z.string().describe('The git repository URL (e.g., https://github.com/org/repo.git)'),
      branch: z.string().optional().describe('Branch to clone and checkout. Creates isolated directory per branch. RECOMMENDED for workstream tasks.'),
    }),
  }
);

export const listClonedReposTool = tool(
  async () => '',
  {
    name: 'list_cloned_repos',
    description: `List all repositories that have been cloned to CLONED_REPOS.
Returns repo name, URL, path, current branch, and last accessed time.
Use this BEFORE searching external services (JIRA, Confluence, web) for repository URLs - the repo may already be cloned!`,
    schema: z.object({
      query: z.string().optional().describe('Optional filter by repo name or URL'),
    }),
  }
);

export const checkoutBranchTool = tool(
  async () => '',
  {
    name: 'checkout_branch',
    description: `Checkout a branch in a cloned repository with multi-process safety.
Acquires a lock to prevent conflicts when multiple work agents use the same repo.
Returns lock conflict info if branch is in use by another process.`,
    schema: z.object({
      repoPath: z.string().describe('Path to the cloned repository'),
      branch: z.string().describe('Branch name to checkout'),
      create: z.boolean().optional().describe('Create branch if it does not exist (default: false)'),
      lockedBy: z.string().optional().describe('Description of what is using the branch'),
    }),
  }
);

export const releaseBranchLockTool = tool(
  async () => '',
  {
    name: 'release_branch_lock',
    description: 'Release a lock on a branch when done working on it. Should be called when finished with PR work.',
    schema: z.object({
      repoPath: z.string().describe('Path to the cloned repository'),
      branch: z.string().describe('Branch name to release lock for'),
    }),
  }
);

export const saveJiraTicketsTool = tool(
  async () => '',
  {
    name: 'save_jira_tickets',
    description: `Fetch JIRA tickets and save each to its own subdirectory.
⚠️ IMPORTANT: FIRST use jira_search to show user what you found, let them pick which tickets are relevant, THEN use save_jira_ticket for the specific ones they want. Don't bulk-save without confirmation!`,
    schema: z.object({
      projectKey: z.string().describe('JIRA project key (e.g., PROJ)'),
      targetDir: z.string().describe('Directory to save tickets to (relative to WORK_DIRS)'),
      type: z.enum(['unassigned', 'backlog', 'search']).optional().describe('Type of tickets to fetch (default: unassigned)'),
      query: z.string().optional().describe('JQL query (required if type is "search")'),
      maxResults: z.number().optional().describe('Maximum tickets to fetch (default: 50)'),
    }),
  }
);

export const saveJiraTicketTool = tool(
  async () => '',
  {
    name: 'save_jira_ticket',
    description: 'Fetch a single JIRA ticket and save it to a subdirectory with ticket.json and ticket.md files.',
    schema: z.object({
      ticketKey: z.string().describe('JIRA ticket key (e.g., PROJ-1234)'),
      targetDir: z.string().describe('Directory to save ticket to (relative to WORK_DIRS)'),
    }),
  }
);

// === INVESTIGATION TOOLS ===

export const startInvestigationTool = tool(
  async () => '',
  {
    name: 'start_investigation',
    description: `Create or reuse an investigation workspace with standard structure (alert.txt, logs.json, findings.md).
IMPORTANT: If a similar investigation directory already exists from today, it will be REUSED automatically (prevents duplicate directories on interruption).
You can also pass existingDir to explicitly reuse a specific directory.`,
    schema: z.object({
      name: z.string().describe('Short name for the investigation (e.g., "identity-service-alert", "api-timeout")'),
      alertContent: z.string().describe('The full alert text or problem description'),
      existingDir: z.string().optional().describe('Optional: path to existing directory to reuse (avoids creating duplicates)'),
    }),
  }
);

export const saveLogsToInvestigationTool = tool(
  async () => '',
  {
    name: 'save_logs_to_investigation',
    description: `Save logs to an investigation workspace. SMART BEHAVIOR:
- Does NOT save empty arrays (wastes files)
- Creates timestamped files in logs/ directory
- Returns clear feedback
Use search_and_save_logs instead for Datadog searches - it's a single step.`,
    schema: z.object({
      investigationPath: z.string().describe('Path to investigation folder (relative to WORK_DIRS)'),
      logs: z.array(z.any()).describe('Array of log objects to save. MUST NOT BE EMPTY.'),
      source: z.string().describe('Source/label for the logs (e.g., "firehydrant_incidents", "error_logs")'),
    }),
  }
);

export const datadogMultiSearchTool = tool(
  async () => '',
  {
    name: 'datadog_multi_search',
    description: `Search Datadog with MULTIPLE queries and save ALL results. BETTER than calling search_and_save_logs multiple times.
Perfect for: "search for errors AND info logs" or "search for service X in multiple environments".
Each query result gets its own file.
IMPORTANT: For historical alerts, ALWAYS specify from/to based on the alert timestamp!`,
    schema: z.object({
      investigationPath: z.string().describe('Path to investigation folder (relative to WORK_DIRS)'),
      queries: z.array(z.object({
        query: z.string().describe('Datadog search query'),
        label: z.string().describe('Short label for this query (used in filename)'),
      })).describe('Array of queries to run. Each gets saved to a separate file.'),
      maxResultsPerQuery: z.number().optional().describe('Max logs per query (default: 30)'),
      from: z.string().optional().describe('Start time as ISO string (e.g., "2025-12-16T06:00:00Z"). REQUIRED for historical alerts!'),
      to: z.string().optional().describe('End time as ISO string (e.g., "2025-12-16T08:00:00Z"). REQUIRED for historical alerts!'),
    }),
  }
);

export const addFindingTool = tool(
  async () => '',
  {
    name: 'add_finding',
    description: 'Add a finding to an investigation. Use this to record discoveries, hypotheses, and conclusions.',
    schema: z.object({
      investigationPath: z.string().describe('Path to investigation folder (relative to WORK_DIRS)'),
      finding: z.string().describe('The finding to record (can be multiple lines)'),
    }),
  }
);

export const searchAndSaveLogsTool = tool(
  async () => '',
  {
    name: 'search_and_save_logs',
    description: `Search Datadog logs AND save them to an investigation. SMART BEHAVIOR:
- If logs found: saves to timestamped file in logs/ directory
- If NO logs found: does NOT create empty file, suggests broader queries
- Returns clear feedback about what happened
PREFERRED over separate search + save. Creates investigation directory if needed.
IMPORTANT: For historical alerts, ALWAYS specify from/to based on the alert timestamp!
Default time range is last 24 hours - this is WRONG for old alerts.`,
    schema: z.object({
      investigationPath: z.string().describe('Path to investigation folder (relative to WORK_DIRS). Will be created if it does not exist.'),
      query: z.string().describe('Datadog search query. Start BROAD (just service name), then narrow down.'),
      maxResults: z.number().optional().describe('Max logs to fetch (default: 50)'),
      filename: z.string().optional().describe('Optional: custom filename for the log file (without .json extension)'),
      from: z.string().optional().describe('Start time as ISO string (e.g., "2025-12-16T06:00:00Z"). REQUIRED for historical alerts!'),
      to: z.string().optional().describe('End time as ISO string (e.g., "2025-12-16T08:00:00Z"). REQUIRED for historical alerts!'),
    }),
  }
);

export const analyzeLogsStructuredTool = tool(
  async () => '',
  {
    name: 'analyze_logs_structured',
    description: `Analyze structured logs from a saved JSON file to extract comprehensive metrics including request rates, durations, status codes, and endpoint statistics. Use this IMMEDIATELY after saving logs to get actionable insights instead of manually reading log files. Works with logs saved by search_and_save_logs tool.`,
    schema: z.object({
      logFilePath: z.string().describe('Path to the saved log file (e.g., "TARGET_SERVICE_LOAD_ANALYSIS_2026-01-06/logs/target-service_requests.json")'),
    }),
  }
);

export const createCursorHandoffTool = tool(
  async () => '',
  {
    name: 'create_cursor_handoff',
    description: 'Create a handoff directory for Cursor agent with task instructions and context. Use this when a task requires deep codebase work (implementation, complex searches, refactoring) that Cursor is better suited for. This tool gathers your research, creates clear instructions, and stops your recursion. IMPORTANT: If you already created a directory (e.g., via save_jira_ticket), pass it as existingDir to consolidate everything in one place.',
    schema: z.object({
      taskName: z.string().describe('Short name for the task (e.g., "update-project-types-api-docs")'),
      taskDescription: z.string().describe('Detailed description of what needs to be done'),
      gatheredInfo: z.array(z.string()).optional().describe('List of key information gathered so far'),
      relatedFiles: z.array(z.string()).optional().describe('File paths that might be relevant'),
      nextSteps: z.array(z.string()).optional().describe('Recommended next steps for Cursor'),
      references: z.array(z.object({
        type: z.string().describe('Type of reference (e.g., "Slack thread", "API doc", "Code snippet")'),
        content: z.string().describe('The reference content'),
      })).optional().describe('Additional reference materials'),
      existingDir: z.string().optional().describe('IMPORTANT: If you already saved JIRA tickets or created a directory, provide it here (e.g., "PROJ-5678_investigation") to consolidate everything in one place instead of creating a separate directory'),
    }),
  }
);

// === TASK MANAGEMENT TOOLS ===

export const createTaskTool = tool(
  async () => '',
  {
    name: 'create_task',
    description: 'Create a new task/todo item. Tasks are created as PENDING by default. Use start_task to mark as in_progress. ALWAYS include originalPrompt when task is created from a long message, Slack thread, or paste.',
    schema: z.object({
      content: z.string().describe('Description of the task'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority (default: medium)'),
      dueDate: z.string().optional().describe('Due date in ISO format (e.g., 2024-01-15)'),
      tags: z.array(z.string()).optional().describe('Tags to categorize the task'),
      context: z.string().optional().describe('Project or context this task relates to'),
      originalPrompt: z.string().optional().describe('IMPORTANT: Full original Slack thread, paste, or long prompt that led to this task. Always include when available!'),
    }),
  }
);

export const updateTaskTool = tool(
  async () => '',
  {
    name: 'update_task',
    description: 'Update an existing task. Can change content, status, priority, etc.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to update'),
      content: z.string().optional().describe('New description'),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional().describe('New status'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
      dueDate: z.string().optional().describe('New due date in ISO format'),
      notes: z.string().optional().describe('Additional notes'),
    }),
  }
);

export const deleteTaskTool = tool(
  async () => '',
  {
    name: 'delete_task',
    description: 'Delete a task permanently.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to delete'),
    }),
  }
);

export const listTasksTool = tool(
  async () => '',
  {
    name: 'list_tasks',
    description: 'List tasks. Shows all active tasks by default. Can filter by status. Tasks with 📎 have saved context.',
    schema: z.object({
      includeCompleted: z.boolean().optional().describe('Include completed tasks (default: false)'),
    }),
  }
);

export const searchTasksTool = tool(
  async () => '',
  {
    name: 'search_tasks',
    description: 'Search tasks by keyword or phrase. Returns matching tasks sorted by relevance. Use this when the user mentions a task but you don\'t have the exact task ID (e.g., "vertexai sdk task", "dean clarke PR").',
    schema: z.object({
      query: z.string().describe('Search query (keywords or phrase)'),
    }),
  }
);

export const getTaskContextTool = tool(
  async () => '',
  {
    name: 'get_task_context',
    description: 'Get full original context (Slack thread, paste, etc.) for a task. Use this to review what led to creating the task.',
    schema: z.object({
      taskId: z.string().describe('ID of the task'),
    }),
  }
);

export const checkTaskProgressTool = tool(
  async () => '',
  {
    name: 'check_task_progress',
    description: 'Check WORK_DIRS for task-related directories and read progress files (TASK.md, NOTES.md, PROGRESS.md, UPDATE.md, SUMMARY.md, handoff.txt). Uses keyword matching to find relevant directories. If no matches found, returns list of ALL directories for manual review. Use this to see what Cursor or other tools did on a task.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to check progress for'),
    }),
  }
);

export const startTaskTool = tool(
  async () => '',
  {
    name: 'start_task',
    description: 'Mark a task as in_progress.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to start'),
    }),
  }
);

export const completeTaskTool = tool(
  async () => '',
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    schema: z.object({
      taskId: z.string().describe('ID of the task to complete'),
    }),
  }
);

export const createReminderTool = tool(
  async () => '',
  {
    name: 'create_reminder',
    description: 'Create a reminder that triggers at a specific time.',
    schema: z.object({
      content: z.string().describe('What to remind about'),
      triggerAt: z.string().describe('When to trigger (ISO format or relative like "tomorrow 9am")'),
      recurring: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Make it recurring'),
    }),
  }
);

export const listRemindersTool = tool(
  async () => '',
  {
    name: 'list_reminders',
    description: 'List all reminders (both active/triggered and pending future ones).',
    schema: z.object({}),
  }
);

export const checkDeadlineRemindersTool = tool(
  async () => '',
  {
    name: 'check_deadline_reminders',
    description: `Check if you should remind the user about deadline tasks.
Uses throttling to avoid annoying repetition:
- Only reminds once every 30 minutes about same tasks
- Max 3 reminders per session for same deadline
- Only tasks due within 24 hours or overdue

Returns:
- shouldRemind: Whether to show the reminder
- tasksToRemind: The urgent tasks
- reason: Why we're reminding or not

Call this BEFORE adding deadline reminders to your response.
If shouldRemind is false, do NOT mention deadlines.`,
    schema: z.object({}),
  }
);

export const recordDeadlineReminderTool = tool(
  async () => '',
  {
    name: 'record_deadline_reminder',
    description: 'Record that you showed deadline reminders to the user. Call this AFTER showing reminders so they get throttled.',
    schema: z.object({
      taskIds: z.array(z.string()).describe('IDs of tasks you reminded about'),
    }),
  }
);

export const acknowledgeReminderTool = tool(
  async () => '',
  {
    name: 'acknowledge_reminder',
    description: 'Acknowledge a triggered reminder. For recurring reminders, schedules the next occurrence.',
    schema: z.object({
      reminderId: z.string().describe('ID of the reminder to acknowledge'),
    }),
  }
);

export const deleteReminderTool = tool(
  async () => '',
  {
    name: 'delete_reminder',
    description: 'Delete a reminder permanently.',
    schema: z.object({
      reminderId: z.string().describe('ID of the reminder to delete'),
    }),
  }
);

export const setProjectContextTool = tool(
  async () => '',
  {
    name: 'set_project',
    description: 'Set the current project context. Helps organize tasks and remembers what you are working on.',
    schema: z.object({
      project: z.string().describe('Name or description of the current project'),
    }),
  }
);

// === WORKSPACE STATE PERSISTENCE ===

export const saveWorkspaceStateTool = tool(
  async () => '',
  {
    name: 'save_workspace_state',
    description: `Save a summary of the current session to persist across restarts.
Use this at the end of significant work sessions to remember context.
The summary will be shown when the agent starts next time.`,
    schema: z.object({
      summary: z.string().describe('Brief summary of current work state (what was being worked on, status, next steps)'),
    }),
  }
);

export const getWorkspaceStateTool = tool(
  async () => '',
  {
    name: 'get_workspace_state',
    description: 'Get the persisted workspace state including active PRs, recent repos, and last session summary.',
    schema: z.object({}),
  }
);

// === WEB BROWSING TOOLS ===

export const fetchUrlTool = tool(
  async () => '',
  {
    name: 'fetch_url',
    description: `Fetch URL content. FALLBACK TOOL - use specialized tools first!

Prefer: slack_navigate_to_url (Slack), jira_get_ticket (JIRA), github_get_pr (GitHub)

Use fetch_url for:
- Generic web pages (docs, articles)
- When specialized tool doesn't exist
- As fallback if specialized tool fails

Specialized tools provide better context and structured data.`,
    schema: z.object({
      url: z.string().describe('The URL to fetch'),
    }),
  }
);

export const webSearchTool = tool(
  async () => '',
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets for top results.',
    schema: z.object({
      query: z.string().describe('The search query'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 5)'),
    }),
  }
);

export const searchAndFetchTool = tool(
  async () => '',
  {
    name: 'search_and_fetch',
    description: 'Search the web AND fetch the top result content. Combines web_search and fetch_url in one call.',
    schema: z.object({
      query: z.string().describe('The search query'),
    }),
  }
);

// === MEMORY TOOLS ===

export const proposeMemoryTool = tool(
  async () => '',
  {
    name: 'propose_memory',
    description: `Propose remembering a user preference or behavior. The user must APPROVE before it's saved.
Use this when you notice patterns like:
- User corrects your formatting (e.g., "use numbers not bullets")
- User expresses a preference (e.g., "I don't like emojis")
- User has a specific workflow (e.g., "always search Confluence first")
DO NOT propose memories for one-time things or task-specific info.`,
    schema: z.object({
      content: z.string().describe('What to remember (be concise and specific)'),
      category: z.enum(['preference', 'behavior', 'workflow', 'context']).describe(
        'preference=formatting/style, behavior=how to act, workflow=process preferences, context=background info'
      ),
      reason: z.string().describe('Why you want to remember this (shown to user for approval)'),
    }),
  }
);

export const rememberTool = tool(
  async () => '',
  {
    name: 'remember',
    description: `Immediately save a memory when user EXPLICITLY asks to remember something.
Use ONLY when user says things like "remember that...", "save this preference...", "always do X".
This skips the approval flow since user explicitly requested it.`,
    schema: z.object({
      content: z.string().describe('What to remember'),
      category: z.enum(['preference', 'behavior', 'workflow', 'context']).describe(
        'preference=formatting/style, behavior=how to act, workflow=process preferences, context=background info'
      ),
    }),
  }
);

// === PDP (Personal Development Plan) TOOLS ===

export const setPDPGoogleDocTool = tool(
  async () => '',
  {
    name: 'set_pdp_google_doc',
    description: 'Set the Google Doc URL for the Personal Development Plan. This enables syncing PDP content and comments.',
    schema: z.object({
      url: z.string().describe('Google Doc URL (e.g., https://docs.google.com/document/d/...)'),
      ownerName: z.string().optional().describe('Your name for matching in JIRA/Confluence'),
      ownerEmail: z.string().optional().describe('Your email for matching'),
    }),
  }
);

export const syncPDPTool = tool(
  async () => '',
  {
    name: 'sync_pdp',
    description: 'Sync the PDP from Google Docs. Fetches latest content and comments, and saves any new feedback.',
    schema: z.object({}),
  }
);

export const getPDPSummaryTool = tool(
  async () => '',
  {
    name: 'get_pdp_summary',
    description: 'Get a summary of your Personal Development Plan including goals, progress, and recent feedback.',
    schema: z.object({}),
  }
);

export const addPDPGoalTool = tool(
  async () => '',
  {
    name: 'add_pdp_goal',
    description: 'Add a new goal to your Personal Development Plan.',
    schema: z.object({
      title: z.string().describe('Goal title'),
      description: z.string().optional().describe('Detailed description'),
      category: z.enum(['technical', 'leadership', 'communication', 'collaboration', 'other']).optional().describe('Goal category'),
      targetDate: z.string().optional().describe('Target completion date (ISO format)'),
    }),
  }
);

export const updatePDPGoalTool = tool(
  async () => '',
  {
    name: 'update_pdp_goal',
    description: 'Update an existing PDP goal (progress, status, notes, etc.).',
    schema: z.object({
      goalId: z.string().describe('ID of the goal to update'),
      status: z.enum(['not_started', 'in_progress', 'completed', 'paused']).optional().describe('New status'),
      progress: z.number().optional().describe('Progress percentage (0-100)'),
      notes: z.string().optional().describe('Notes to add'),
    }),
  }
);

export const listPDPGoalsTool = tool(
  async () => '',
  {
    name: 'list_pdp_goals',
    description: 'List all PDP goals, optionally filtered by status or category.',
    schema: z.object({
      status: z.enum(['not_started', 'in_progress', 'completed', 'paused']).optional().describe('Filter by status'),
      category: z.enum(['technical', 'leadership', 'communication', 'collaboration', 'other']).optional().describe('Filter by category'),
    }),
  }
);

// === ACHIEVEMENT TRACKING TOOLS ===

export const setAchievementConfigTool = tool(
  async () => '',
  {
    name: 'set_achievement_config',
    description: 'Configure your identities for automatic achievement collection from JIRA, Confluence, GitHub, Google Docs.',
    schema: z.object({
      jiraUsername: z.string().optional().describe('Your JIRA username'),
      confluenceUsername: z.string().optional().describe('Your Confluence username'),
      githubUsername: z.string().optional().describe('Your GitHub username'),
      googleEmail: z.string().optional().describe('Your Google email'),
    }),
  }
);

export const addAchievementTool = tool(
  async () => '',
  {
    name: 'add_achievement',
    description: 'Manually record an achievement or accomplishment.',
    schema: z.object({
      title: z.string().describe('Achievement title'),
      description: z.string().optional().describe('Description'),
      category: z.enum(['delivery', 'documentation', 'collaboration', 'leadership', 'technical', 'incident', 'learning', 'other']).optional().describe('Category'),
      url: z.string().optional().describe('Link to evidence/document'),
      date: z.string().optional().describe('Date of achievement (ISO format)'),
      impact: z.string().optional().describe('Impact description'),
      linkedGoalIds: z.array(z.string()).optional().describe('PDP goal IDs this supports'),
    }),
  }
);

export const collectJiraAchievementsTool = tool(
  async () => '',
  {
    name: 'collect_jira_achievements',
    description: 'Collect completed JIRA tickets as achievements. Searches for done tickets assigned to you.',
    schema: z.object({
      username: z.string().describe('Your JIRA username/display name'),
      since: z.string().optional().describe('Only tickets resolved after this date (ISO format)'),
      projects: z.array(z.string()).optional().describe('Filter to specific project keys'),
    }),
  }
);

export const collectConfluenceAchievementsTool = tool(
  async () => '',
  {
    name: 'collect_confluence_achievements',
    description: 'Collect Confluence pages you authored as achievements.',
    schema: z.object({
      username: z.string().describe('Your Confluence username'),
      since: z.string().optional().describe('Only pages created after this date'),
    }),
  }
);

export const collectGoogleDocsAchievementsTool = tool(
  async () => '',
  {
    name: 'collect_google_docs_achievements',
    description: 'Collect Google Docs you created as achievements. Requires OAuth access token.',
    schema: z.object({
      query: z.string().optional().describe('Optional title filter'),
    }),
  }
);

export const addTechDocLinkTool = tool(
  async () => '',
  {
    name: 'add_tech_doc_link',
    description: 'Add a link to a technical document as an achievement (RFC, design doc, etc.).',
    schema: z.object({
      title: z.string().describe('Document title'),
      url: z.string().describe('Document URL'),
      description: z.string().optional().describe('Description'),
      date: z.string().optional().describe('Date created/published'),
    }),
  }
);

export const getAchievementsSummaryTool = tool(
  async () => '',
  {
    name: 'get_achievements_summary',
    description: 'Get a summary of your achievements, optionally for a specific time period.',
    schema: z.object({
      period: z.enum(['week', 'month', 'quarter', 'year']).optional().describe('Time period to summarize'),
    }),
  }
);

export const listAchievementsTool = tool(
  async () => '',
  {
    name: 'list_achievements',
    description: 'List achievements with optional filtering.',
    schema: z.object({
      category: z.enum(['delivery', 'documentation', 'collaboration', 'leadership', 'technical', 'incident', 'learning', 'other']).optional().describe('Filter by category'),
      source: z.enum(['jira_ticket', 'confluence_page', 'google_doc', 'github_pr', 'task_completed', 'manual', 'tech_document']).optional().describe('Filter by source'),
      dateFrom: z.string().optional().describe('Start date (ISO format)'),
      dateTo: z.string().optional().describe('End date (ISO format)'),
      search: z.string().optional().describe('Search text in title/description'),
    }),
  }
);

export const linkAchievementToGoalTool = tool(
  async () => '',
  {
    name: 'link_achievement_to_goal',
    description: 'Link an achievement to a PDP goal to track progress.',
    schema: z.object({
      achievementId: z.string().describe('Achievement ID'),
      goalId: z.string().describe('PDP goal ID'),
    }),
  }
);

export const exportAchievementsTool = tool(
  async () => '',
  {
    name: 'export_achievements',
    description: 'Export achievements for review or sharing.',
    schema: z.object({
      period: z.enum(['week', 'month', 'quarter', 'year']).optional().describe('Time period'),
      format: z.enum(['markdown', 'json', 'csv']).optional().describe('Export format (default: markdown)'),
    }),
  }
);

// === SLACK BROWSER TOOLS ===
// Browser automation for Slack web UI (no API key required)

export const slackOpenBrowserTool = tool(
  async () => '',
  {
    name: 'slack_open_browser',
    description: `Open the user's ACTUAL Chrome browser (not a sandboxed one) and navigate to a Slack workspace.
Uses the user's existing Chrome profile with their cookies, sessions, and logins - so if they're 
already logged into Slack in Chrome, they'll be logged in automatically!

Falls back to Playwright's bundled Chromium if Chrome isn't found.

CRITICAL WORKFLOW - FOLLOW EXACTLY:
1. Call slack_open_browser with workspace URL
2. Check the result.needsLogin field:
   - If false: You're logged in! Proceed with other Slack tools
   - If true: YOU MUST DO BOTH OF THESE IN YOUR NEXT RESPONSE:
     a. Tell the user "Please sign in to Slack in the browser window"
     b. Call slack_wait_for_login IMMEDIATELY (in the same response - don't wait for user to say "I'm logged in")
3. After slack_wait_for_login succeeds, proceed with other Slack operations

IMPORTANT: slack_wait_for_login POLLS automatically - you don't need to wait for user confirmation!`,
    schema: z.object({
      workspaceUrl: z.string().describe('Slack workspace URL (e.g., https://yourcompany.slack.com or https://app.slack.com/client/T12345)'),
    }),
  }
);

export const slackWaitForLoginTool = tool(
  async () => '',
  {
    name: 'slack_wait_for_login',
    description: `Wait for user to complete Slack login in the browser.

CRITICAL: Call this IMMEDIATELY after slack_open_browser returns needsLogin: true.
Do NOT wait for the user to say "I'm logged in" or "done" - this function POLLS automatically!

How it works:
- Checks the browser every 2 seconds to see if user completed login
- Returns success when authentication is detected
- Waits up to the specified timeout (default: 5 minutes)
- User can take their time logging in - the function waits for them

WORKFLOW:
1. slack_open_browser returns needsLogin: true
2. YOU tell user: "Please log in to Slack in the browser"
3. YOU call slack_wait_for_login IN THE SAME RESPONSE (not in a separate turn)
4. Function waits and returns when user completes login`,
    schema: z.object({
      timeoutMinutes: z.number().optional().describe('How long to wait for login (default: 5 minutes)'),
    }),
  }
);

export const slackGetStatusTool = tool(
  async () => '',
  {
    name: 'slack_status',
    description: 'Get the current Slack browser status: whether it is open, logged in, current channel, etc.',
    schema: z.object({}),
  }
);

export const slackListChannelsTool = tool(
  async () => '',
  {
    name: 'slack_list_channels',
    description: `List all visible channels and conversations in the Slack sidebar.
Uses a hybrid approach: accessibility tree for stable navigation + LLM for content extraction.
Returns channel names, IDs (if available), unread status, and type (channel/dm/group).`,
    schema: z.object({}),
  }
);

export const slackNavigateChannelTool = tool(
  async () => '',
  {
    name: 'slack_navigate_channel',
    description: `Navigate to a specific Slack channel by name or ID. THIS IS THE PREFERRED WAY to switch channels.
If channel ID is provided (e.g., C123ABC), navigates directly via URL.
If channel name is provided, attempts to find and click it in the sidebar.

Use this FIRST before trying slack_search_channel. If the channel is visible in the sidebar, this will work.
If it returns "not found in sidebar", then try slack_scroll_sidebar or slack_search_channel.`,
    schema: z.object({
      channelIdOrName: z.string().describe('Channel ID (e.g., C123ABC) or channel name (e.g., general)'),
    }),
  }
);

export const slackReadMessagesTool = tool(
  async () => '',
  {
    name: 'slack_read_messages',
    description: `Read messages from the current Slack channel.
Uses LLM-powered extraction to parse message content from the page.
Returns author, timestamp, content, thread replies count, and reactions.

NOTE: This only reads messages currently visible on screen. 
- If you're looking for messages from TODAY (0 days ago), they are usually at the BOTTOM. 
- Use slack_scroll_to_bottom first to be sure you are at the end of the channel.
- The 'limit' parameter caps how many visible messages to return, but does NOT load more messages.`,
    schema: z.object({
      limit: z.number().optional().describe('Maximum number of currently visible messages to read (default: 20)'),
    }),
  }
);

export const slackCloseBrowserTool = tool(
  async () => '',
  {
    name: 'slack_close_browser',
    description: 'Close the Slack browser. Session cookies are saved for future use.',
    schema: z.object({}),
  }
);

export const slackQuickOpenTool = tool(
  async () => '',
  {
    name: 'slack_quick_open',
    description: `Quickly open Slack using the last used workspace URL.
If no previous workspace is saved, requires a workspace URL.
Useful for reopening Slack after browser was closed.`,
    schema: z.object({
      workspaceUrl: z.string().optional().describe('Optional: Workspace URL to use instead of last saved'),
    }),
  }
);

export const slackScrollMessagesTool = tool(
  async () => '',
  {
    name: 'slack_scroll_messages',
    description: `Scroll the message area to load older or newer messages.
Use direction 'up' to load older messages (scroll toward the TOP of the page, into the PAST).
Use direction 'down' to load newer messages (scroll toward the BOTTOM of the page, into the PRESENT).

⚠️ SCROLLING GUIDELINES - BE CONSERVATIVE:
- MOST IMPORTANT MESSAGES ARE RECENT - start by checking what's visible NOW
- Each scroll moves about 1 page of messages (~10-20 messages)
- BEFORE scrolling, ask yourself: "Do I really need older messages for this task?"
- For finding TODAY's messages: use slack_scroll_to_bottom, don't scroll up
- For investigating an issue: usually 0-1 scrolls up is enough
- For broad search: consider using Slack's search instead of scrolling endlessly
- After scrolling ONCE, evaluate if you found what you need before scrolling again
- DON'T scroll up multiple times without a specific reason

WHEN TO SCROLL:
✓ User asks about something that happened "yesterday" or "last week"
✓ Looking for a specific older conversation
✓ Need historical context for a decision

WHEN NOT TO SCROLL:
✗ Just starting to look at a channel - check current view first
✗ Looking for recent/today's messages - use slack_scroll_to_bottom
✗ Already found relevant information
✗ User didn't ask for historical context`,
    schema: z.object({
      direction: z.enum(['up', 'down']).describe('Direction to scroll: "up" for older messages, "down" for newer'),
    }),
  }
);

export const slackScrollToBottomTool = tool(
  async () => '',
  {
    name: 'slack_scroll_to_bottom',
    description: `Scroll to the very bottom of the current Slack channel to see the most recent messages.
Use this to quickly return to the present after scrolling up to the past.
Useful for finding messages from TODAY (0 days ago) if you've scrolled away.`,
    schema: z.object({}),
  }
);

export const slackScrollSidebarTool = tool(
  async () => '',
  {
    name: 'slack_scroll_sidebar',
    description: `Scroll the sidebar to reveal more channels.
Use this if a channel is not visible in the current sidebar view.
Call this before slack_list_channels to get more channels.`,
    schema: z.object({
      direction: z.enum(['up', 'down']).describe('Direction to scroll: "up" or "down"'),
    }),
  }
);

export const slackSearchChannelGetResultsTool = tool(
  async () => '',
  {
    name: 'slack_search_channel_get_results',
    description: `Search for channels/DMs using Slack's Cmd+K quick switcher and GET ALL VISIBLE RESULTS.
After getting results, you MUST analyze them and intelligently select the best match.

WORKFLOW:
1. Call this tool with your search query
2. You'll receive an array of results with index, text, and type
3. ANALYZE the results using your intelligence:
   - Look for exact name matches
   - For DMs: person name should match closely
   - For channels: channel name should match
   - Shorter, more exact matches are better than long approximate ones
4. Call slack_select_search_result with the BEST matching index

SEARCH SYNTAX:
- For CHANNELS: Use the channel name (e.g., "ask-engineering", "general") - NO # prefix
- For DMs/PMs: Use the person's name (e.g., "Koren Ben Ezri", "jane smith") - NO @ prefix
- Slack's search is fuzzy - partial matches work

EXAMPLES OF SMART SELECTION:
Example 1 - Searching for "alex johnson":
  Results: [
    0: "Alex Johnson (DM)",
    1: "Alex J (DM)",  
    2: "#alex-test"
  ]
  → Select 0 (exact name match, and it's a DM as expected)

Example 2 - Searching for "ask":
  Results: [
    0: "#general-ask",
    1: "#ask-engineering",
    2: "#ask-security"
  ]
  → Depends on context! If you need backend team, pick 1. If security, pick 2.

Example 3 - Searching for "incident-alerts":
  Results: [
    0: "#incident-alerts",
    1: "#incidents",
    2: "#alerts"
  ]
  → Select 0 (exact match)

BE SMART: Don't just blindly pick index 0. Actually think about which result matches what you're looking for!

SEARCH MODES:
- pressEnter: false (default) - Shows quick suggestions only (faster, usually sufficient for 5-10 results)
- pressEnter: true - Submits search to load full results page (slower, more comprehensive, up to 20 results)

Use pressEnter: true when:
- Quick suggestions don't show the desired channel/DM
- You need to see more than 10 results
- Searching for less common channels or people`,
    schema: z.object({
      searchQuery: z.string().describe('Text to search for (person name for DMs, channel name for channels)'),
      pressEnter: z.boolean().optional().describe('If true, press Enter to load full search results instead of quick suggestions. Default: false.'),
    }),
  }
);

export const slackSelectSearchResultTool = tool(
  async () => '',
  {
    name: 'slack_select_search_result',
    description: `Select a search result by index after calling slack_search_channel_get_results.
The index corresponds to the result's position in the results array (0-based).

IMPORTANT: Only call this IMMEDIATELY after slack_search_channel_get_results!
Don't call other Slack tools in between or the search results will be gone.`,
    schema: z.object({
      index: z.number().describe('Index of the search result to select (0-based, from the results array)'),
    }),
  }
);

export const slackReactToMessageTool = tool(
  async () => '',
  {
    name: 'slack_react',
    description: `React to a message with an emoji.
First use slack_read_messages to get the list of messages, then use the index (0-based) to react.
The emoji should be the name (e.g., "+1", "heart", "eyes", "fire").`,
    schema: z.object({
      messageIndex: z.number().describe('Index of the message to react to (0 = first/oldest visible message)'),
      emoji: z.string().describe('Emoji name to react with (e.g., "+1", "heart", "fire", "eyes")'),
    }),
  }
);

export const slackReplyToMessageTool = tool(
  async () => '',
  {
    name: 'slack_reply',
    description: `Reply to a message in a thread.
First use slack_read_messages to get the list of messages, then use the index (0-based) to reply.
This opens the thread and sends a reply.`,
    schema: z.object({
      messageIndex: z.number().describe('Index of the message to reply to (0 = first/oldest visible message)'),
      replyText: z.string().describe('The text of your reply'),
    }),
  }
);

export const slackSendMessageTool = tool(
  async () => '',
  {
    name: 'slack_send_message',
    description: `Send a message to the current channel OR direct message (DM).

Works for both channels and DMs. Make sure you're in the right channel/DM first:
- For channels: slack_navigate_channel OR slack_search_channel_get_results
- For DMs: slack_search_channel_get_results(person name) → slack_select_search_result

After navigation, this tool sends your message to that conversation.`,
    schema: z.object({
      text: z.string().describe('The message text to send'),
    }),
  }
);

export const slackReadThreadTool = tool(
  async () => '',
  {
    name: 'slack_read_thread',
    description: `Open and read a thread's full content (parent message + all replies).
First use slack_read_messages to see the channel messages, then use the index of the message 
that has a thread to read its full content. Returns all messages in the thread plus the thread URL if available.
Perfect for: "turn that thread into a task" - read the thread, then create_task with the content.`,
    schema: z.object({
      messageIndex: z.number().describe('Index of the message with the thread (0 = first visible message)'),
    }),
  }
);

export const slackGetMessageUrlTool = tool(
  async () => '',
  {
    name: 'slack_get_message_url',
    description: `Get the shareable URL for a specific message.
Uses Slack's "Copy link" feature to get the permalink.
Useful for saving references to messages when creating tasks.`,
    schema: z.object({
      messageIndex: z.number().describe('Index of the message to get URL for (0 = first visible message)'),
    }),
  }
);

export const slackCloseThreadTool = tool(
  async () => '',
  {
    name: 'slack_close_thread',
    description: `Close the thread panel if it's open.
Call this after reading a thread to go back to the main channel view.`,
    schema: z.object({}),
  }
);

export const slackDebugScrollTool = tool(
  async () => '',
  {
    name: 'slack_debug_scroll',
    description: `DEBUG: Get information about scrollable elements in Slack.
Returns scroll positions, heights, and whether elements are scrollable.
Use this to diagnose scrolling issues.`,
    schema: z.object({}),
  }
);

export const slackTakeScreenshotTool = tool(
  async () => '',
  {
    name: 'slack_take_screenshot',
    description: `DEBUG: Take a screenshot of the current Slack browser state.
Saves to WORK_DIRS/slack-debug/ folder.
Use this to see what the Playwright browser is actually displaying.`,
    schema: z.object({
      name: z.string().optional().describe('Name for the screenshot file (default: "slack")'),
    }),
  }
);

export const slackQueryAITool = tool(
  async () => '',
  {
    name: 'slack_query_ai',
    description: `Ask a question to Slack AI and get an AI-generated answer with reference links.

Slack AI can answer questions about:
- Company processes and procedures
- Documentation and how-tos
- Team knowledge and best practices
- Finding information across Slack history

The AI will search through Slack messages and channels to provide context-aware answers with references.

Example questions:
- "What is our deployment process?"
- "How do I request access to production?"
- "What are the team norms for code reviews?"
- "Where can I find documentation about our API?"

Returns:
- answer: The AI's response text
- references: Array of {title, url} for referenced messages/docs

Note: Slack AI may not be available in all workspaces. If unavailable, you'll get an error.`,
    schema: z.object({
      question: z.string().describe('The question to ask Slack AI'),
    }),
  }
);

export const slackNavigateToUrlTool = tool(
  async () => '',
  {
    name: 'slack_navigate_to_url',
    description: `Navigate directly to a Slack URL (channel, message, or thread).
⚠️ CRITICAL: ALWAYS use this for ANY Slack URL - never use web_navigate or web_open_browser!
This tool automatically converts URLs to web-browser-friendly format (avoiding app-forcing URLs).

Supported URL formats (all converted to web-safe format automatically):
- https://app.slack.com/client/T123/C456
- https://workspace.slack.com/archives/C456/p1234567890
- https://workspace.slack.com/archives/C456/p1234567890?thread_ts=1234567890.123456

The tool will:
1. Parse the URL to extract channel ID and message timestamp
2. Convert to web-browser-friendly format if needed
3. Navigate to the channel
4. Return info about what was found (channel ID, message timestamp, etc.)

USE THIS WHEN:
- You have ANY Slack link (any URL containing slack.com)
- User provides a Slack URL
- You see a Slack link in message content (check the 'links' field in messages!)
- A message you read contains isSlackLink: true in its links array

This is MUCH better than searching for channels by name!

WORKFLOW FOR FOLLOWING LINKS IN MESSAGES:
1. Read messages with slack_read_messages
2. Check if any message has links with isSlackLink: true
3. Use THIS tool to navigate to those Slack links (NOT web_navigate!)
4. Read the messages at that destination`,
    schema: z.object({
      url: z.string().describe('The Slack URL to navigate to'),
    }),
  }
);

// === ADVICE / PROACTIVE MONITORING TOOLS ===
// Manage Slack channel watching and advice generation

export const adviceMonitoringScanTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_scan',
    description: `Trigger immediate BACKGROUND SCAN of monitored Slack channels/DMs for automated advice generation.

⚠️ NOT for reading/displaying messages! Use slack_navigate_channel + slack_read_messages for that.

Scans watched channels (or just VIPs if vipOnly=true), analyzes new messages against user's tasks/goals, and generates advice topics. By default: scan-only (NO auto-responses to Slack unless allowAutoResponse=true).

Use for: "scan slack", "run an advice scan", "scan monitored channels", "check VIP updates", "scan for advice"
Don't use for: "read #channel", "show me DM with John"`,
    schema: z.object({
      vipOnly: z.boolean().optional().describe('If true, only scan VIP channels/DMs. If false/omitted, scan all watched channels.'),
      allowAutoResponse: z.boolean().optional().describe('If true, allow VIP auto-responses to Slack. Default: false (scan-only mode for safety). Use with caution.'),
    }),
  }
);

// === WEB BROWSING TOOLS ===
// Generic web browser automation for any website

export const webOpenBrowserTool = tool(
  async () => '',
  {
    name: 'web_open_browser',
    description: `Open a web browser and optionally navigate to a URL.
Opens user's actual Chrome if available (via CDP), otherwise uses Playwright's Chromium.
Preserves cookies and sessions per domain.

⚠️ NEVER use this for Slack URLs! Use slack_open_browser + slack_navigate_to_url instead.

BEFORE using this, consider:
- Can you get the information via API instead? (jira_get_ticket, github_get_pr, etc.)
- Have you understood the full context first?
- Do you have a specific reason to open a browser?

Use when:
- User explicitly asks to "open browser" or "go to website"
- Testing/verification tasks require UI interaction (e.g., app.dev.example.io testing)
- Information not available via API

Don't use for:
- JIRA tickets → use jira_get_ticket API
- GitHub PRs → use github_get_pr API  
- Slack URLs → use slack_open_browser + slack_navigate_to_url`,
    schema: z.object({
      url: z.string().optional().describe('Initial URL to navigate to (optional)'),
    }),
  }
);

export const webNavigateTool = tool(
  async () => '',
  {
    name: 'web_navigate',
    description: `Navigate to a specific URL in the already-open web browser.

⚠️ NEVER use this for Slack URLs! Use slack_navigate_to_url instead (it handles web-safe URL conversion).`,
    schema: z.object({
      url: z.string().describe('URL to navigate to (NOT for Slack URLs - use slack_navigate_to_url!)'),
    }),
  }
);

export const webReadPageTool = tool(
  async () => '',
  {
    name: 'web_read_page',
    description: `Read and extract content from the current web page using LLM.
Returns: title, main content, and optionally links/buttons/forms.

This intelligently extracts the meaningful content, filtering out navigation, ads, etc.`,
    schema: z.object({
      includeLinks: z.boolean().optional().describe('Include links from the page (default: false)'),
      includeButtons: z.boolean().optional().describe('Include buttons from the page (default: false)'),
      includeForms: z.boolean().optional().describe('Include form fields from the page (default: false)'),
    }),
  }
);

export const webGetInteractiveElementsTool = tool(
  async () => '',
  {
    name: 'web_get_interactive_elements',
    description: `Get all interactive elements on the page (buttons, links, inputs, etc.).
Returns array of elements with type, text, and AI-generated descriptions.

Use this to see what actions are available on the page before clicking.`,
    schema: z.object({}),
  }
);

export const webClickElementTool = tool(
  async () => '',
  {
    name: 'web_click_element',
    description: `Click an element on the page by describing it in natural language.
Uses LLM to find the best matching element and clicks it.

Examples:
- "Click the blue Submit button"
- "Click the Login link"
- "Click View Details"

The description should be clear about what you want to click.`,
    schema: z.object({
      description: z.string().describe('Natural language description of the element to click'),
    }),
  }
);

export const webFillFormTool = tool(
  async () => '',
  {
    name: 'web_fill_form',
    description: `Fill form fields on the current page.
Provide field names/labels and their values as a JSON string.

Example fields (as JSON string):
'{"username": "test@example.com", "password": "secret123", "remember": "true"}'`,
    schema: z.object({
      fieldsJson: z.string().describe('JSON string mapping field names to values (e.g., \'{"username": "test@example.com", "password": "secret123"}\')'),
    }),
  }
);

export const webSubmitFormTool = tool(
  async () => '',
  {
    name: 'web_submit_form',
    description: 'Submit the current form by finding and clicking the submit button.',
    schema: z.object({}),
  }
);

export const webScrollTool = tool(
  async () => '',
  {
    name: 'web_scroll',
    description: 'Scroll the page in a specified direction.',
    schema: z.object({
      direction: z.enum(['up', 'down', 'to_bottom', 'to_top']).describe('Direction to scroll'),
    }),
  }
);

export const webGoBackTool = tool(
  async () => '',
  {
    name: 'web_go_back',
    description: 'Go back to the previous page in browser history.',
    schema: z.object({}),
  }
);

export const webGoForwardTool = tool(
  async () => '',
  {
    name: 'web_go_forward',
    description: 'Go forward to the next page in browser history.',
    schema: z.object({}),
  }
);

export const webTakeScreenshotTool = tool(
  async () => '',
  {
    name: 'web_take_screenshot',
    description: `Take a screenshot of the current page.
Saves to WORK_DIRS/web-debug/ folder.
Useful for debugging or capturing current state.`,
    schema: z.object({
      name: z.string().optional().describe('Name for the screenshot file (default: "web-screenshot")'),
    }),
  }
);

export const webGetStatusTool = tool(
  async () => '',
  {
    name: 'web_status',
    description: 'Get the current web browser status: whether it is open, current URL, page title, domain.',
    schema: z.object({}),
  }
);

export const webCloseBrowserTool = tool(
  async () => '',
  {
    name: 'web_close_browser',
    description: 'Close the web browser. Sessions and cookies are saved for future use.',
    schema: z.object({}),
  }
);

// === ADVICE / PROACTIVE MONITORING TOOLS (continued) ===

export const adviceMonitoringListTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_list',
    description: `List all channels/DMs in background monitoring watch list (shows what's monitored, not current messages).

For reading Slack: Use slack_list_channels + slack_navigate_channel
For monitoring config: Use this tool`,
    schema: z.object({}),
  }
);

export const adviceMonitoringAddTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_add',
    description: `Add Slack channel or DM to background monitoring for automated advice generation (scans every 15min).

⚠️ NOT for reading messages now! Use slack_navigate_channel + slack_read_messages for that.

Use for: "monitor #incidents", "watch this channel"
Don't use for: "read #channel", "show me latest"

Provide channel name (e.g., "team-backend") or person's name for DM (e.g., "John Smith").`,
    schema: z.object({
      channelOrDmName: z.string().describe('Channel name or person name for DM'),
    }),
  }
);

export const adviceMonitoringRemoveTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_remove',
    description: `Remove channel/DM from background monitoring watch list. Stops automated scanning; doesn't affect manual reading with slack_navigate_channel.`,
    schema: z.object({
      channelOrDmName: z.string().describe('Channel name or person name to stop watching'),
    }),
  }
);

export const adviceMonitoringToggleTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_toggle',
    description: `Enable/disable entire background monitoring system. When disabled, no automatic scanning. Doesn't affect manual slack_navigate_channel operations.`,
    schema: z.object({
      enabled: z.boolean().describe('true to enable, false to disable'),
    }),
  }
);

export const adviceMonitoringSetIntervalTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_set_interval',
    description: `Set background monitoring scan interval (5-60 minutes, default 15). Controls automated scanning frequency, not manual operations.`,
    schema: z.object({
      minutes: z.number().describe('Scan interval in minutes (5-60)'),
    }),
  }
);

export const adviceMonitoringStatusTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_status',
    description: `Get background monitoring status (enabled, interval, watched channels, VIPs, last scan). For current Slack status, use slack_status.`,
    schema: z.object({}),
  }
);

export const adviceMonitoringSetVipTool = tool(
  async () => '',
  {
    name: 'advice_monitoring_set_vip',
    description: `Mark channel/DM as VIP for enhanced background monitoring: deeper analysis, more message history (~100 vs ~50), URL investigation, importance assessment.

For reading: Use slack_navigate_channel + slack_read_messages
For VIP setup: Use this tool

Provide channel name (e.g., "incident-alerts") or person's full name (e.g., "Alex Johnson").`,
    schema: z.object({
      channelOrDmName: z.string().describe('Channel name or person name for DM to mark as VIP'),
      isVip: z.boolean().describe('true to mark as VIP, false to unmark'),
    }),
  }
);

export const adviceTopicsListTool = tool(
  async () => '',
  {
    name: 'advice_topics_list',
    description: `List all unread/active advice topics generated from Slack monitoring scans.

Use when:
- User asks "what advice do I have?"
- User says "show me topics" or "what did the scan find?"
- After scanning to show what was saved

Returns: List of topics with title, summary, priority, source channel`,
    schema: z.object({
      filter: z.enum(['unread', 'active', 'all']).optional().describe('Filter topics: unread (not read yet), active (not dismissed), all (everything). Default: unread'),
    }),
  }
);

export const adviceTopicsViewTool = tool(
  async () => '',
  {
    name: 'advice_topics_view',
    description: `View full details of a specific advice topic including source messages and references.

Use when:
- User asks to "see more about topic X"
- User wants full context of a topic
- Need to see the actual Slack messages that generated the topic`,
    schema: z.object({
      topicId: z.string().describe('ID of the topic to view'),
    }),
  }
);

export const adviceTopicsMarkReadTool = tool(
  async () => '',
  {
    name: 'advice_topics_mark_read',
    description: `Mark an advice topic as read (acknowledged but not dismissed - still available).

Use when:
- User acknowledges they've seen a topic
- User says "mark as read" or "I've seen that"`,
    schema: z.object({
      topicId: z.string().describe('ID of the topic to mark as read'),
    }),
  }
);

export const adviceTopicsDismissTool = tool(
  async () => '',
  {
    name: 'advice_topics_dismiss',
    description: `Dismiss an advice topic (remove from active list - topic is archived).

Use when:
- User wants to remove/hide a topic
- User says "dismiss" or "not interested"
- Topic is no longer relevant`,
    schema: z.object({
      topicId: z.string().describe('ID of the topic to dismiss'),
    }),
  }
);

// === TRASH BIN TOOLS ===

export const trashListTool = tool(
  async () => '',
  {
    name: 'trash_list',
    description: `List all deleted workstreams in the trash bin.

ONLY use this when the user explicitly asks about deleted/trashed workstreams.
Returns workstream name, type, deletion date, and message count.

Examples of when to use:
- "What's in my trash?"
- "Show me deleted workstreams"
- "What did I delete recently?"`,
    schema: z.object({
      limit: z.number().optional().describe('Maximum items to return (default: 20)'),
    }),
  }
);

export const trashSearchTool = tool(
  async () => '',
  {
    name: 'trash_search',
    description: `Smart search through deleted workstreams in the trash bin.

ONLY use this when the user explicitly asks to search their deleted/trashed workstreams.
Uses semantic matching on workstream names, messages, and metadata.

Examples of when to use:
- "Search my trash for that PR review"
- "Find deleted workstreams about TASK-5678"
- "Did I delete something about authentication?"`,
    schema: z.object({
      query: z.string().describe('Search query - can be a name, topic, ticket ID, or keyword'),
    }),
  }
);

export const trashRestoreTool = tool(
  async () => '',
  {
    name: 'trash_restore',
    description: `Restore a deleted workstream from the trash bin.

Use when user wants to recover/restore a specific deleted workstream.
The workstream will be returned to active workstreams with all messages intact.

Examples of when to use:
- "Restore that workstream"
- "Undelete the PR review"
- "Bring back the TASK-5678 investigation"`,
    schema: z.object({
      workstreamId: z.string().describe('ID of the workstream to restore'),
    }),
  }
);

export const trashStatsTool = tool(
  async () => '',
  {
    name: 'trash_stats',
    description: `Get statistics about the trash bin (count, oldest/newest dates, etc).

Use when user asks about trash bin overview or status.`,
    schema: z.object({}),
  }
);

// Tool executor
