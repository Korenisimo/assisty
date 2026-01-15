// API Clients - External service integrations

export * from './jira.js';
export * from './confluence.js';
export * from './firehydrant.js';
export * from './datadog.js';
export * from './github.js';
export * from './googledocs.js';
export * from './slack.js';

// Re-export specific JIRA functions for clarity
export {
  getTicket,
  searchTickets,
  getUnassignedTickets,
  getBacklogTickets,
  getBoardTickets,
  getCompletedTicketsByUser,
  getTicketsReportedByUser,
  getAllTicketsByUser,
  getUserTicketStats,
  addComment,
  createTicket,
  isJiraConfigured,
  getJiraConfigStatus,
} from './jira.js';

// Re-export specific Confluence functions for clarity
export {
  searchPages,
  getPage,
  getPageComments,
  searchPagesByAuthor,
  searchPagesContributedByUser,
  getUserPageStats,
  createPage,
  listSpaces,
  isConfluenceConfigured,
} from './confluence.js';

// Re-export specific Google Docs functions for clarity
export {
  getGoogleDoc,
  getGoogleDocComments,
  searchMyGoogleDocs,
  extractDocId,
  isGoogleDocsConfigured,
  getGoogleDocsConfigStatus,
} from './googledocs.js';

// Re-export specific GitHub functions for clarity
export {
  listPullRequests,
  getPullRequest,
  searchPullRequestsByAuthor,
  isGitHubConfigured,
  getGitHubConfigStatus,
} from './github.js';

// Re-export Datadog functions for clarity
export {
  // Logs
  searchLogs,
  searchLogsWithDetails,
  getRequestTrace,
  // Monitors
  getMonitors,
  getMonitor,
  // Dashboards
  listDashboards,
  getDashboard,
  // Notebooks
  getNotebook,
  // Metrics
  queryMetrics,
  // Events
  getEvents,
  // Services/APM
  getServiceDependencies,
  listServices,
  // URL parsing
  parseDatadogUrl,
  extractDatadogUrls,
  fetchDatadogUrl,
  // Query helpers
  findRelevantQueries,
  suggestInvestigationQueries,
  // Database Monitoring (DBM) - via metrics API
  getDbmQueryMetrics,
  getDbmIndexMetrics,
  getDbmHostMetrics,
  // Config
  isDatadogConfigured,
} from './datadog.js';

// Re-export Slack browser client
export {
  slackBrowser,
  type SlackChannel,
  type SlackMessage,
  type SlackBrowserStatus,
} from './slack.js';

// Re-export Slack extractor functions
export {
  extractChannels,
  extractMessages,
  extractCurrentChannel,
  findChannelElement,
  scrollToLoadMore,
  scrollSidebar,
  searchForChannelAndGetResults,
  selectSearchResult,
  reactToMessage,
  replyToMessage,
  sendMessage,
  readThread,
  getMessageUrl,
  closeThreadPanel,
  isExtractorReady,
} from './slack-extractor.js';

