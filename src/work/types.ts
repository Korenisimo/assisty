// Work mode types

export interface WorkInput {
  jiraTicketId?: string;
  problemStatement?: string;
  datadogRequestId?: string;
  alertId?: string; // FireHydrant or Datadog alert
  includeDatadog?: boolean;
}

export interface WorkSession {
  id: string;
  createdAt: number;
  input: WorkInput;
  outputDir: string;
}

export interface JiraTicket {
  key: string;
  summary: string;
  description?: string;
  status: string;
  assignee?: string;
  reporter?: string;
  priority?: string;
  created: string;
  updated: string;
  labels: string[];
  components: string[];
  comments: JiraComment[];
}

export interface JiraComment {
  author: string;
  body: string;
  created: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  excerpt: string;
  content?: string;  // Full page content (plain text)
  url: string;
  space: string;
  lastModified: string;
}

export interface FireHydrantIncident {
  id: string;
  name: string;
  summary?: string;
  severity: string;
  currentMilestone: string;
  createdAt: string;
  startedAt?: string;
  resolvedAt?: string;
  services: string[];
  environments: string[];
}

export interface FireHydrantAlert {
  id: string;
  summary: string;
  status: string;
  createdAt: string;
  incidentId?: string;
}

export interface DatadogLog {
  timestamp: string;
  service?: string;
  status: string;
  message: string;
  host?: string;
  tags: string[];
  // Full attributes from Datadog - includes request_id, trace_id, http info, custom fields, etc.
  attributes: Record<string, unknown>;
}

export interface DatadogMonitor {
  id: number;
  name: string;
  type: string;
  message: string;
  query: string;
  state: string;
  tags: string[];
}

// Dashboard types
export interface DatadogDashboard {
  id: string;
  title: string;
  description?: string;
  url: string;
  widgets: DatadogWidget[];
  // Raw widget definitions for deep inspection
  rawWidgets?: unknown[];
}

export interface DatadogDashboardSummary {
  id: string;
  title: string;
  description?: string;
  url: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface DatadogWidget {
  id?: number;
  title?: string;
  type: string;
  // Extracted queries from this widget
  queries: DatadogWidgetQuery[];
}

export interface DatadogWidgetQuery {
  // The raw query string (e.g., "sum:envoy.http.downstream.rq.xx{...} by {upstream_cluster}")
  query: string;
  // What kind of query: metric, log, apm, etc.
  dataSource: 'metrics' | 'logs' | 'apm' | 'rum' | 'events' | 'unknown';
  // Aggregation type if present
  aggregation?: string;
  // Group by fields if present
  groupBy?: string[];
  // Human-readable description of what this query shows
  description?: string;
}

// Notebook types
export interface DatadogNotebook {
  id: number;
  name: string;
  author?: string;
  createdAt?: string;
  modifiedAt?: string;
  cells: DatadogNotebookCell[];
  // Extracted queries from all cells
  queries: DatadogWidgetQuery[];
}

export interface DatadogNotebookCell {
  id: string;
  type: 'markdown' | 'timeseries' | 'toplist' | 'heatmap' | 'distribution' | 'log_stream' | 'query_value' | 'table' | 'unknown';
  // For markdown cells
  content?: string;
  // For visualization cells
  title?: string;
  queries: DatadogWidgetQuery[];
}

// Metrics types
export interface DatadogMetricQuery {
  query: string;
  from: string;
  to: string;
}

export interface DatadogMetricSeries {
  metric: string;
  tags: Record<string, string>;
  // Aggregated value or point-in-time values
  values: Array<{
    timestamp: number;
    value: number;
  }>;
  // Summary stats
  sum?: number;
  avg?: number;
  max?: number;
  min?: number;
}

export interface DatadogMetricResult {
  query: string;
  series: DatadogMetricSeries[];
  timeRange: { from: string; to: string };
  error?: string;
}

// Events types (deploys, changes, etc.)
export interface DatadogEvent {
  id: number;
  title: string;
  text?: string;
  dateHappened: string;
  host?: string;
  tags: string[];
  source?: string;
  alertType?: 'error' | 'warning' | 'info' | 'success';
  priority?: 'normal' | 'low';
}

// Service Catalog / APM types
export interface DatadogService {
  name: string;
  type?: string;
  // Upstream services this service calls
  upstreamDependencies: string[];
  // Downstream services that call this service
  downstreamDependencies: string[];
  // Recent error rate if available
  errorRate?: number;
  // Tags/metadata
  tags: string[];
}

// URL parsing result
export interface DatadogUrlInfo {
  type: 'dashboard' | 'notebook' | 'monitor' | 'logs' | 'apm' | 'unknown';
  id?: string;
  // For logs URLs, the query might be embedded
  query?: string;
  // For time-bounded URLs
  from?: string;
  to?: string;
  // The full URL for reference
  url: string;
}

// Database Monitoring (DBM) types
export interface DatadogDbmQuerySample {
  // Query identification
  querySignature: string;
  queryStatement: string;
  queryComment?: string;
  // Execution stats
  duration: number; // in milliseconds
  rowsAffected?: number;
  // Timing
  timestamp: string;
  // Database info
  dbName: string;
  dbUser?: string;
  host: string;
  // Explain plan if available
  explainPlan?: {
    definition?: string;
    signature?: string;
    cost?: number;
  };
  // Tags
  tags: string[];
}

export interface DatadogDbmHost {
  hostname: string;
  dbType: 'postgres' | 'mysql' | 'sqlserver' | 'oracle' | 'unknown';
  // Index statistics
  indexes: DatadogDbmIndex[];
  // Performance stats
  activeConnections?: number;
  avgQueryDuration?: number;
  queriesPerSecond?: number;
  // Tags
  tags: string[];
}

export interface DatadogDbmIndex {
  indexName: string;
  tableName: string;
  schemaName?: string;
  // Usage stats
  indexScans: number;
  indexTuplesRead?: number;
  indexTuplesFetched?: number;
  // Size
  indexSizeBytes?: number;
  // Is this index being used?
  isUnused?: boolean;
}

export interface DatadogDbmQueryMetrics {
  querySignature: string;
  // Aggregated stats over time period
  totalExecutions: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  p95Duration?: number;
  p99Duration?: number;
  // Error stats
  errorCount?: number;
  // Resource usage
  avgRowsExamined?: number;
  avgRowsReturned?: number;
  // Time range
  timeRange: { from: string; to: string };
}

export interface CollectedData {
  jira?: JiraTicket[];
  confluence?: ConfluencePage[];
  firehydrant?: {
    incidents?: FireHydrantIncident[];
    alerts?: FireHydrantAlert[];
  };
  datadog?: {
    logs?: DatadogLog[];
    monitors?: DatadogMonitor[];
    dashboards?: DatadogDashboard[];
    notebooks?: DatadogNotebook[];
    metrics?: DatadogMetricResult[];
    events?: DatadogEvent[];
    services?: DatadogService[];
  };
}

export interface RelevantData {
  summary: string;
  jira?: {
    tickets: JiraTicket[];
    relevanceNotes: string;
  };
  confluence?: {
    pages: ConfluencePage[];
    relevanceNotes: string;
  };
  firehydrant?: {
    incidents?: FireHydrantIncident[];
    alerts?: FireHydrantAlert[];
    relevanceNotes: string;
  };
  datadog?: {
    logs?: DatadogLog[];
    monitors?: DatadogMonitor[];
    dashboards?: DatadogDashboard[];
    notebooks?: DatadogNotebook[];
    metrics?: DatadogMetricResult[];
    events?: DatadogEvent[];
    services?: DatadogService[];
    relevanceNotes: string;
  };
}

export type PersonalityType = 'default' | 'proactive' | 'minimal';

export interface PersonalityConfig {
  type: PersonalityType;
  reminderFrequency: number; // How often to remind about tasks (in turns)
  askForDeadlines: boolean;
  verbosity: 'concise' | 'normal' | 'verbose';
}

// Character mode - imitate specific TV/movie characters
export type CharacterType = 
  | 'none'           // No character, just personality
  // It's Always Sunny in Philadelphia
  | 'dee'            // Dee Reynolds
  | 'dennis'         // Dennis Reynolds
  | 'mac'            // Mac McDonald
  | 'charlie'        // Charlie Kelly
  | 'frank'          // Frank Reynolds
  // Seinfeld
  | 'jerry'          // Jerry Seinfeld
  | 'george'         // George Costanza
  | 'elaine'         // Elaine Benes
  | 'kramer'         // Cosmo Kramer
  // Friends
  | 'chandler'       // Chandler Bing
  | 'joey'           // Joey Tribbiani
  | 'ross'           // Ross Geller
  | 'monica'         // Monica Geller
  | 'rachel'         // Rachel Green
  | 'phoebe'         // Phoebe Buffay
  // Other
  | 'dwight'         // Dwight from The Office
  | 'ron'            // Ron Swanson from Parks and Rec
  | 'archer'         // Sterling Archer from Archer
  | 'custom';        // Custom character (user-defined)

export interface CharacterConfig {
  type: CharacterType;
  customDescription?: string; // For custom characters
}

