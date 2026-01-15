// Datadog API Client - READ ONLY
// Uses DD_API_KEY and DD_APP_KEY

import { 
  DatadogLog, 
  DatadogMonitor,
  DatadogDashboard,
  DatadogDashboardSummary,
  DatadogWidget,
  DatadogWidgetQuery,
  DatadogNotebook,
  DatadogNotebookCell,
  DatadogMetricResult,
  DatadogMetricSeries,
  DatadogEvent,
  DatadogService,
  DatadogUrlInfo,
  DatadogDbmQuerySample,
  DatadogDbmHost,
  DatadogDbmIndex,
  DatadogDbmQueryMetrics,
} from '../types.js';

interface DatadogConfig {
  apiKey: string;
  appKey: string;
  site?: string;
}

function getConfig(): DatadogConfig {
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  
  if (!apiKey || !appKey) {
    throw new Error('Missing Datadog config: DD_API_KEY and DD_APP_KEY required');
  }
  
  const site = process.env.DD_SITE || 'datadoghq.com';
  
  return { apiKey, appKey, site };
}

async function datadogFetch(endpoint: string, options: { apiVersion?: 'v1' | 'v2'; method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
  const { apiKey, appKey, site } = getConfig();
  const { apiVersion = 'v1', method = 'GET', body } = options;
  
  const headers: Record<string, string> = {
    'DD-API-KEY': apiKey,
    'DD-APPLICATION-KEY': appKey,
    'Accept': 'application/json',
  };
  
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(`https://api.${site}/api/${apiVersion}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Datadog API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

export interface DatadogSearchResult {
  logs: DatadogLog[];
  error?: string;
  query: string;
  timeRange: { from: string; to: string };
}

export interface LogSearchOptions {
  maxResults?: number;
  /** ISO timestamp or Date - defaults to 24 hours ago */
  from?: string | Date;
  /** ISO timestamp or Date - defaults to now */
  to?: string | Date;
}

export async function searchLogs(query: string, options: LogSearchOptions | number = {}): Promise<DatadogLog[]> {
  // Support legacy signature: searchLogs(query, maxResults)
  const opts: LogSearchOptions = typeof options === 'number' ? { maxResults: options } : options;
  const result = await searchLogsWithDetails(query, opts);
  return result.logs;
}

/**
 * Search Datadog logs with full result details including errors.
 * Use this when you need to know if the query failed vs returned no results.
 * 
 * @param query - Datadog log query string
 * @param options - Search options including time range and max results
 *   - from: Start time (ISO string or Date). Defaults to 24 hours ago.
 *   - to: End time (ISO string or Date). Defaults to now.
 *   - maxResults: Maximum number of logs to return. Defaults to 50.
 * 
 * For investigating historical alerts, pass the alert time as the center of your range:
 * @example
 * // Alert was at 2025-12-16T07:08:00Z
 * searchLogsWithDetails(query, {
 *   from: '2025-12-16T06:00:00Z',  // 1 hour before
 *   to: '2025-12-16T08:00:00Z',    // 1 hour after
 * })
 */
export async function searchLogsWithDetails(query: string, options: LogSearchOptions | number = {}): Promise<DatadogSearchResult> {
  // Support legacy signature: searchLogsWithDetails(query, maxResults)
  const opts: LogSearchOptions = typeof options === 'number' ? { maxResults: options } : options;
  
  // Calculate time range
  const now = Date.now();
  const defaultFrom = new Date(now - 24 * 60 * 60 * 1000);
  const defaultTo = new Date(now);
  
  const from = opts.from 
    ? (opts.from instanceof Date ? opts.from.toISOString() : opts.from)
    : defaultFrom.toISOString();
  const to = opts.to 
    ? (opts.to instanceof Date ? opts.to.toISOString() : opts.to)
    : defaultTo.toISOString();
  const maxResults = opts.maxResults ?? 50;
  
  try {
    const { apiKey, appKey, site } = getConfig();
    
    const response = await fetch(`https://api.${site}/api/v2/logs/events/search`, {
      method: 'POST', // Required for log search, but it's a READ operation
      headers: {
        'DD-API-KEY': apiKey,
        'DD-APPLICATION-KEY': appKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          query,
          from,
          to,
        },
        page: {
          limit: maxResults,
        },
        sort: '-timestamp', // Most recent first (descending)
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return {
        logs: [],
        error: `Datadog API error (${response.status}): ${errorText.substring(0, 200)}`,
        query,
        timeRange: { from, to },
      };
    }
    
    const data = await response.json() as {
      data?: Array<{
        id?: string;
        attributes?: {
          timestamp?: string;
          service?: string;
          status?: string;
          message?: string;
          host?: string;
          tags?: string[];
          attributes?: Record<string, unknown>; // Custom attributes (request_id, trace_id, http, etc.)
          [key: string]: unknown;
        };
      }>;
    };
    
    const logs = (data.data || []).map(log => {
      // Extract all attributes - the full log data is in log.attributes
      const attrs = log.attributes || {};
      
      // Datadog nests custom attributes under attributes.attributes
      // but also has them at the top level of attributes
      const customAttrs = (attrs.attributes as Record<string, unknown>) || {};
      
      // Merge everything into a flat attributes object for easy access
      const fullAttributes: Record<string, unknown> = {
        ...customAttrs,
        // Also include any top-level attributes that aren't the standard ones
        ...Object.fromEntries(
          Object.entries(attrs).filter(([key]) => 
            !['timestamp', 'service', 'status', 'message', 'host', 'tags', 'attributes'].includes(key)
          )
        ),
      };
      
      return {
        timestamp: attrs.timestamp || '',
        service: attrs.service,
        status: attrs.status || 'unknown',
        message: attrs.message || '',
        host: attrs.host,
        tags: attrs.tags || [],
        attributes: fullAttributes,
      };
    });
    
    return {
      logs,
      query,
      timeRange: { from, to },
    };
  } catch (error) {
    return {
      logs: [],
      error: `Datadog search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      query,
      timeRange: { from, to },
    };
  }
}

export async function getMonitors(query?: string): Promise<DatadogMonitor[]> {
  try {
    let endpoint = '/monitor';
    if (query) {
      endpoint += `?name=${encodeURIComponent(query)}`;
    }
    
    const data = await datadogFetch(endpoint) as Array<{
      id: number;
      name: string;
      type: string;
      message: string;
      query: string;
      overall_state: string;
      tags: string[];
    }>;
    
    return data.map(monitor => ({
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      message: monitor.message || '',
      query: monitor.query || '',
      state: monitor.overall_state || 'unknown',
      tags: monitor.tags || [],
    }));
  } catch {
    return [];
  }
}

export async function getMonitor(monitorId: number): Promise<DatadogMonitor | null> {
  try {
    const data = await datadogFetch(`/monitor/${monitorId}`) as {
      id: number;
      name: string;
      type: string;
      message: string;
      query: string;
      overall_state: string;
      tags: string[];
    };
    
    return {
      id: data.id,
      name: data.name,
      type: data.type,
      message: data.message || '',
      query: data.query || '',
      state: data.overall_state || 'unknown',
      tags: data.tags || [],
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export async function getRequestTrace(requestId: string, options?: Omit<LogSearchOptions, 'maxResults'>): Promise<DatadogLog[]> {
  // Search logs with trace ID or request ID
  return searchLogs(
    `@trace_id:${requestId} OR @request_id:${requestId} OR @http.request_id:${requestId}`,
    { ...options, maxResults: 100 }
  );
}

export function isDatadogConfigured(): boolean {
  return !!(process.env.DD_API_KEY && process.env.DD_APP_KEY);
}

// ============================================================================
// DASHBOARDS
// ============================================================================

/**
 * List all dashboards, optionally filtered by query.
 * Use this to discover dashboards related to a service or topic.
 */
export async function listDashboards(query?: string): Promise<DatadogDashboardSummary[]> {
  try {
    const data = await datadogFetch('/dashboard', { apiVersion: 'v1' }) as {
      dashboards?: Array<{
        id: string;
        title: string;
        description?: string;
        author_handle?: string;
        created_at?: string;
        modified_at?: string;
        url?: string;
      }>;
    };
    
    const { site } = getConfig();
    let dashboards = (data.dashboards || []).map(d => ({
      id: d.id,
      title: d.title,
      description: d.description,
      url: d.url || `https://app.${site}/dashboard/${d.id}`,
      author: d.author_handle,
      createdAt: d.created_at,
      modifiedAt: d.modified_at,
    }));
    
    // Filter by query if provided
    if (query) {
      const lowerQuery = query.toLowerCase();
      dashboards = dashboards.filter(d => 
        d.title.toLowerCase().includes(lowerQuery) ||
        d.description?.toLowerCase().includes(lowerQuery)
      );
    }
    
    return dashboards;
  } catch (error) {
    console.error('Failed to list dashboards:', error);
    return [];
  }
}

/**
 * Get a dashboard by ID with full widget definitions.
 * Extracts queries from all widgets for investigation.
 */
export async function getDashboard(dashboardId: string): Promise<DatadogDashboard | null> {
  try {
    const data = await datadogFetch(`/dashboard/${dashboardId}`, { apiVersion: 'v1' }) as {
      id: string;
      title: string;
      description?: string;
      url?: string;
      widgets?: unknown[];
    };
    
    const { site } = getConfig();
    const widgets = extractWidgetsFromDashboard(data.widgets || []);
    
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      url: data.url || `https://app.${site}/dashboard/${data.id}`,
      widgets,
      rawWidgets: data.widgets,
    };
  } catch (error) {
    console.error(`Failed to get dashboard ${dashboardId}:`, error);
    return null;
  }
}

// ============================================================================
// NOTEBOOKS
// ============================================================================

/**
 * Get a notebook by ID with all cells and extracted queries.
 * Notebooks often contain investigation runbooks with useful queries.
 */
export async function getNotebook(notebookId: number): Promise<DatadogNotebook | null> {
  try {
    const data = await datadogFetch(`/notebooks/${notebookId}`, { apiVersion: 'v1' }) as {
      data?: {
        id: number;
        attributes?: {
          name?: string;
          author?: { handle?: string };
          created?: string;
          modified?: string;
          cells?: unknown[];
        };
      };
    };
    
    const attrs = data.data?.attributes;
    if (!attrs) return null;
    
    const cells = extractCellsFromNotebook(attrs.cells || []);
    const allQueries = cells.flatMap(c => c.queries);
    
    return {
      id: data.data?.id || notebookId,
      name: attrs.name || 'Untitled',
      author: attrs.author?.handle,
      createdAt: attrs.created,
      modifiedAt: attrs.modified,
      cells,
      queries: allQueries,
    };
  } catch (error) {
    console.error(`Failed to get notebook ${notebookId}:`, error);
    return null;
  }
}

// ============================================================================
// METRICS
// ============================================================================

export interface MetricQueryOptions {
  from: string | Date;
  to: string | Date;
}

/**
 * Query metrics from Datadog.
 * This is the key function for running aggregated queries like "5xx by upstream service".
 * 
 * @param query - Datadog metric query (e.g., "sum:envoy.http.downstream.rq.xx{response_code_class:5xx} by {upstream_cluster}")
 * @param options - Time range for the query
 */
export async function queryMetrics(query: string, options: MetricQueryOptions): Promise<DatadogMetricResult> {
  const from = options.from instanceof Date ? Math.floor(options.from.getTime() / 1000) : Math.floor(new Date(options.from).getTime() / 1000);
  const to = options.to instanceof Date ? Math.floor(options.to.getTime() / 1000) : Math.floor(new Date(options.to).getTime() / 1000);
  
  try {
    const endpoint = `/query?query=${encodeURIComponent(query)}&from=${from}&to=${to}`;
    const data = await datadogFetch(endpoint, { apiVersion: 'v1' }) as {
      status?: string;
      error?: string;
      series?: Array<{
        metric: string;
        tag_set?: string[];
        scope?: string;
        pointlist?: Array<[number, number]>;
        expression?: string;
      }>;
    };
    
    if (data.error) {
      return {
        query,
        series: [],
        timeRange: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
        error: data.error,
      };
    }
    
    const series: DatadogMetricSeries[] = (data.series || []).map(s => {
      const values = (s.pointlist || []).map(([ts, val]) => ({
        timestamp: ts,
        value: val,
      }));
      
      // Parse tags from tag_set (format: ["key:value", ...])
      const tags: Record<string, string> = {};
      for (const tag of s.tag_set || []) {
        const [key, ...valueParts] = tag.split(':');
        tags[key] = valueParts.join(':');
      }
      
      // Calculate summary stats
      const numericValues = values.map(v => v.value).filter(v => !isNaN(v));
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const avg = numericValues.length > 0 ? sum / numericValues.length : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 0;
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      
      return {
        metric: s.metric || s.expression || query,
        tags,
        values,
        sum,
        avg,
        max,
        min,
      };
    });
    
    return {
      query,
      series,
      timeRange: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
    };
  } catch (error) {
    return {
      query,
      series: [],
      timeRange: { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString() },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// EVENTS
// ============================================================================

export interface EventSearchOptions {
  from?: string | Date;
  to?: string | Date;
  tags?: string[];
  sources?: string[];
  priority?: 'normal' | 'low';
}

/**
 * Search for events (deploys, alerts, changes, etc.)
 * Useful for correlating issues with recent changes.
 */
export async function getEvents(query?: string, options: EventSearchOptions = {}): Promise<DatadogEvent[]> {
  try {
    const now = Date.now();
    const from = options.from 
      ? (options.from instanceof Date ? Math.floor(options.from.getTime() / 1000) : Math.floor(new Date(options.from).getTime() / 1000))
      : Math.floor((now - 24 * 60 * 60 * 1000) / 1000);
    const to = options.to 
      ? (options.to instanceof Date ? Math.floor(options.to.getTime() / 1000) : Math.floor(new Date(options.to).getTime() / 1000))
      : Math.floor(now / 1000);
    
    let endpoint = `/events?start=${from}&end=${to}`;
    
    if (query) {
      endpoint += `&tags=${encodeURIComponent(query)}`;
    }
    if (options.tags?.length) {
      endpoint += `&tags=${encodeURIComponent(options.tags.join(','))}`;
    }
    if (options.sources?.length) {
      endpoint += `&sources=${encodeURIComponent(options.sources.join(','))}`;
    }
    if (options.priority) {
      endpoint += `&priority=${options.priority}`;
    }
    
    const data = await datadogFetch(endpoint, { apiVersion: 'v1' }) as {
      events?: Array<{
        id: number;
        title: string;
        text?: string;
        date_happened: number;
        host?: string;
        tags?: string[];
        source_type_name?: string;
        alert_type?: string;
        priority?: string;
      }>;
    };
    
    return (data.events || []).map(e => ({
      id: e.id,
      title: e.title,
      text: e.text,
      dateHappened: new Date(e.date_happened * 1000).toISOString(),
      host: e.host,
      tags: e.tags || [],
      source: e.source_type_name,
      alertType: e.alert_type as DatadogEvent['alertType'],
      priority: e.priority as DatadogEvent['priority'],
    }));
  } catch (error) {
    console.error('Failed to get events:', error);
    return [];
  }
}

// ============================================================================
// SERVICE CATALOG / APM
// ============================================================================

/**
 * Get service dependencies from APM.
 * Useful for understanding what upstream/downstream services might be affected.
 */
export async function getServiceDependencies(serviceName: string): Promise<DatadogService | null> {
  try {
    // Try the service catalog API first
    const catalogData = await datadogFetch(`/services/definition/${serviceName}`, { apiVersion: 'v2' }).catch(() => null) as {
      data?: {
        attributes?: {
          schema?: {
            'dd-service'?: string;
            integrations?: {
              dependencies?: string[];
            };
            tags?: string[];
          };
        };
      };
    } | null;
    
    // Also try to get dependencies from APM service map
    const apmData = await datadogFetch(`/service_dependencies?service=${encodeURIComponent(serviceName)}`, { apiVersion: 'v1' }).catch(() => null) as {
      data?: {
        upstream?: string[];
        downstream?: string[];
      };
    } | null;
    
    const upstream: string[] = [];
    const downstream: string[] = [];
    const tags: string[] = [];
    
    // Extract from catalog
    if (catalogData?.data?.attributes?.schema) {
      const schema = catalogData.data.attributes.schema;
      if (schema.integrations?.dependencies) {
        upstream.push(...schema.integrations.dependencies);
      }
      if (schema.tags) {
        tags.push(...schema.tags);
      }
    }
    
    // Extract from APM
    if (apmData?.data) {
      if (apmData.data.upstream) upstream.push(...apmData.data.upstream);
      if (apmData.data.downstream) downstream.push(...apmData.data.downstream);
    }
    
    return {
      name: serviceName,
      upstreamDependencies: [...new Set(upstream)],
      downstreamDependencies: [...new Set(downstream)],
      tags: [...new Set(tags)],
    };
  } catch (error) {
    console.error(`Failed to get service dependencies for ${serviceName}:`, error);
    return null;
  }
}

/**
 * List services from APM/Service Catalog.
 */
export async function listServices(query?: string): Promise<DatadogService[]> {
  try {
    const data = await datadogFetch('/services', { apiVersion: 'v1' }) as {
      data?: Array<{
        service_name: string;
        tags?: string[];
      }>;
    };
    
    let services = (data.data || []).map(s => ({
      name: s.service_name,
      upstreamDependencies: [],
      downstreamDependencies: [],
      tags: s.tags || [],
    }));
    
    if (query) {
      const lowerQuery = query.toLowerCase();
      services = services.filter(s => s.name.toLowerCase().includes(lowerQuery));
    }
    
    return services;
  } catch (error) {
    console.error('Failed to list services:', error);
    return [];
  }
}

// ============================================================================
// URL PARSING
// ============================================================================

/**
 * Parse a Datadog URL to extract its type and ID.
 * Useful for automatically fetching resources linked in alerts/tickets.
 * 
 * Supports:
 * - Dashboards: https://app.datadoghq.com/dashboard/abc-123
 * - Notebooks: https://app.datadoghq.com/notebook/1234567
 * - Monitors: https://app.datadoghq.com/monitors/12345
 * - Logs: https://app.datadoghq.com/logs?query=...
 * - APM: https://app.datadoghq.com/apm/service/my-service
 */
export function parseDatadogUrl(url: string): DatadogUrlInfo {
  const result: DatadogUrlInfo = { type: 'unknown', url };
  
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    
    // Dashboard: /dashboard/abc-123-def or /dash/...
    const dashboardMatch = path.match(/\/dash(?:board)?\/([a-z0-9-]+)/i);
    if (dashboardMatch) {
      result.type = 'dashboard';
      result.id = dashboardMatch[1];
      return result;
    }
    
    // Notebook: /notebook/12345
    const notebookMatch = path.match(/\/notebook\/(\d+)/);
    if (notebookMatch) {
      result.type = 'notebook';
      result.id = notebookMatch[1];
      return result;
    }
    
    // Monitor: /monitors/12345
    const monitorMatch = path.match(/\/monitors?\/(\d+)/);
    if (monitorMatch) {
      result.type = 'monitor';
      result.id = monitorMatch[1];
      return result;
    }
    
    // Logs: /logs with query parameter
    if (path.includes('/logs')) {
      result.type = 'logs';
      const query = parsed.searchParams.get('query');
      if (query) result.query = query;
      const from = parsed.searchParams.get('from_ts');
      const to = parsed.searchParams.get('to_ts');
      if (from) result.from = new Date(parseInt(from)).toISOString();
      if (to) result.to = new Date(parseInt(to)).toISOString();
      return result;
    }
    
    // APM: /apm/service/my-service
    const apmMatch = path.match(/\/apm\/(?:service|services)\/([^/?]+)/);
    if (apmMatch) {
      result.type = 'apm';
      result.id = apmMatch[1];
      return result;
    }
    
  } catch {
    // Invalid URL, return unknown
  }
  
  return result;
}

/**
 * Extract all Datadog URLs from text (alert message, Jira ticket, etc.)
 */
export function extractDatadogUrls(text: string): DatadogUrlInfo[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+datadoghq\.com[^\s<>"{}|\\^`[\]]*/gi;
  const matches = text.match(urlRegex) || [];
  return matches.map(url => parseDatadogUrl(url));
}

/**
 * Fetch a Datadog resource based on its URL.
 * Automatically detects the type and fetches the appropriate data.
 */
export async function fetchDatadogUrl(url: string): Promise<{
  type: DatadogUrlInfo['type'];
  data: DatadogDashboard | DatadogNotebook | DatadogMonitor | DatadogLog[] | DatadogService | null;
  error?: string;
}> {
  const info = parseDatadogUrl(url);
  
  try {
    switch (info.type) {
      case 'dashboard':
        if (info.id) {
          const dashboard = await getDashboard(info.id);
          return { type: 'dashboard', data: dashboard };
        }
        break;
        
      case 'notebook':
        if (info.id) {
          const notebook = await getNotebook(parseInt(info.id));
          return { type: 'notebook', data: notebook };
        }
        break;
        
      case 'monitor':
        if (info.id) {
          const monitor = await getMonitor(parseInt(info.id));
          return { type: 'monitor', data: monitor };
        }
        break;
        
      case 'logs':
        if (info.query) {
          const logs = await searchLogs(info.query, {
            from: info.from,
            to: info.to,
            maxResults: 50,
          });
          return { type: 'logs', data: logs };
        }
        break;
        
      case 'apm':
        if (info.id) {
          const service = await getServiceDependencies(info.id);
          return { type: 'apm', data: service };
        }
        break;
    }
  } catch (error) {
    return {
      type: info.type,
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
  
  return { type: info.type, data: null, error: 'Could not extract ID from URL' };
}

// ============================================================================
// DATABASE MONITORING (DBM)
// ============================================================================
// 
// NOTE: Datadog does NOT expose a public REST API for DBM query samples, 
// execution plans, or host index statistics. This data is only available:
// 1. Through the Datadog UI (Database Monitoring section)
// 2. Via the regular metrics API using DBM-specific metric names
//
// The functions below use the METRICS API to query DBM-related metrics.
// For query samples and explain plans, users must use the Datadog UI directly.

export interface DbmMetricsOptions {
  /** Filter by service name */
  service?: string;
  /** Filter by database name */
  dbName?: string;
  /** Filter by host */
  host?: string;
  /** ISO timestamp - defaults to 1 hour ago */
  from?: string | Date;
  /** ISO timestamp - defaults to now */
  to?: string | Date;
}

/**
 * Get PostgreSQL query performance metrics via the metrics API.
 * 
 * This queries metrics like:
 * - postgresql.queries.count - Query execution count
 * - postgresql.queries.time - Query execution time
 * - postgresql.queries.rows - Rows affected
 * 
 * NOTE: For detailed query samples and explain plans, use the Datadog UI.
 * 
 * @param options - Filter options
 * @returns Query performance metrics
 */
export async function getDbmQueryMetrics(options: DbmMetricsOptions = {}): Promise<{
  metrics: DatadogMetricResult[];
  error?: string;
  uiInstructions: string;
}> {
  const now = Date.now();
  const from = options.from 
    ? (options.from instanceof Date ? options.from : new Date(options.from))
    : new Date(now - 24 * 60 * 60 * 1000);
  const to = options.to 
    ? (options.to instanceof Date ? options.to : new Date(options.to))
    : new Date(now);
  
  // Build tag filters
  const tags: string[] = [];
  if (options.service) tags.push(`service:${options.service}`);
  if (options.dbName) tags.push(`db:${options.dbName}`);
  if (options.host) tags.push(`host:${options.host}`);
  const tagFilter = tags.length > 0 ? `{${tags.join(',')}}` : '{*}';
  
  const queries = [
    `avg:postgresql.queries.time${tagFilter} by {query_signature}`,
    `sum:postgresql.queries.count${tagFilter} by {query_signature}`,
  ];
  
  const results: DatadogMetricResult[] = [];
  
  for (const query of queries) {
    try {
      const result = await queryMetrics(query, { from, to });
      results.push(result);
    } catch {
      // Continue with other queries if one fails
    }
  }
  
  return {
    metrics: results,
    uiInstructions: `For detailed query samples and explain plans:
1. Go to Infrastructure → Database Monitoring → Query Samples
2. Filter by Service: ${options.service || 'your-service'}
3. Search for specific query text or comments
4. Click on individual queries to see explain plans`,
  };
}

/**
 * Get PostgreSQL index utilization metrics via the metrics API.
 * 
 * This queries metrics like:
 * - postgresql.index_scans - Number of index scans
 * - postgresql.index_rows_fetched - Rows fetched via index
 * 
 * @param indexName - Optional index name to filter by (partial match in tags)
 * @param options - Filter options
 * @returns Index utilization metrics
 */
export async function getDbmIndexMetrics(indexName?: string, options: DbmMetricsOptions = {}): Promise<{
  metrics: DatadogMetricResult[];
  error?: string;
  uiInstructions: string;
}> {
  const now = Date.now();
  const from = options.from 
    ? (options.from instanceof Date ? options.from : new Date(options.from))
    : new Date(now - 24 * 60 * 60 * 1000);
  const to = options.to 
    ? (options.to instanceof Date ? options.to : new Date(options.to))
    : new Date(now);
  
  // Build tag filters
  const tags: string[] = [];
  if (options.service) tags.push(`service:${options.service}`);
  if (options.host) tags.push(`host:${options.host}`);
  if (indexName) tags.push(`index:*${indexName}*`);
  const tagFilter = tags.length > 0 ? `{${tags.join(',')}}` : '{*}';
  
  const queries = [
    `sum:postgresql.index_scans${tagFilter} by {index,table}`,
    `sum:postgresql.index_rows_fetched${tagFilter} by {index,table}`,
  ];
  
  const results: DatadogMetricResult[] = [];
  
  for (const query of queries) {
    try {
      const result = await queryMetrics(query, { from, to });
      results.push(result);
    } catch {
      // Continue with other queries if one fails
    }
  }
  
  return {
    metrics: results,
    uiInstructions: `For detailed index statistics:
1. Go to Infrastructure → Database Monitoring → Databases
2. Select your database host
3. Click the "Indexes" tab
4. Search for: ${indexName || 'your-index-name'}
5. View scan counts, rows fetched, and size`,
  };
}

/**
 * Get database host performance metrics via the metrics API.
 * 
 * @param options - Filter options
 * @returns Host performance metrics
 */
export async function getDbmHostMetrics(options: DbmMetricsOptions = {}): Promise<{
  metrics: DatadogMetricResult[];
  error?: string;
  uiInstructions: string;
}> {
  const now = Date.now();
  const from = options.from 
    ? (options.from instanceof Date ? options.from : new Date(options.from))
    : new Date(now - 24 * 60 * 60 * 1000);
  const to = options.to 
    ? (options.to instanceof Date ? options.to : new Date(options.to))
    : new Date(now);
  
  // Build tag filters
  const tags: string[] = [];
  if (options.service) tags.push(`service:${options.service}`);
  if (options.host) tags.push(`host:${options.host}`);
  const tagFilter = tags.length > 0 ? `{${tags.join(',')}}` : '{*}';
  
  const queries = [
    `avg:postgresql.connections${tagFilter} by {host}`,
    `avg:postgresql.db.count${tagFilter} by {host}`,
    `avg:postgresql.locks${tagFilter} by {host}`,
  ];
  
  const results: DatadogMetricResult[] = [];
  
  for (const query of queries) {
    try {
      const result = await queryMetrics(query, { from, to });
      results.push(result);
    } catch {
      // Continue with other queries if one fails
    }
  }
  
  return {
    metrics: results,
    uiInstructions: `For complete database host information:
1. Go to Infrastructure → Database Monitoring → Hosts
2. Filter by: ${options.service || options.host || 'your-service'}
3. View connections, queries/sec, and other host metrics`,
  };
}

// Legacy function names for backward compatibility - these now return helpful errors
// pointing users to the UI since the API doesn't exist

export async function getDbmQuerySamples(): Promise<{
  samples: DatadogDbmQuerySample[];
  error: string;
}> {
  return {
    samples: [],
    error: `Datadog does not expose a public API for DBM query samples. 
To view query samples:
1. Go to Infrastructure → Database Monitoring → Query Samples in the Datadog UI
2. Filter by service and search for specific query text
3. Click individual queries to see execution plans`,
  };
}

export async function getDbmHosts(): Promise<{
  hosts: DatadogDbmHost[];
  error: string;
}> {
  return {
    hosts: [],
    error: `Datadog does not expose a public API for DBM host details with index stats.
To view database hosts and indexes:
1. Go to Infrastructure → Database Monitoring → Databases in the Datadog UI
2. Select your database host
3. Click the "Indexes" tab to see index utilization`,
  };
}

export async function findDbmIndex(indexName: string): Promise<{
  indexes: Array<DatadogDbmIndex & { host: string; dbType: string }>;
  error: string;
}> {
  return {
    indexes: [],
    error: `Datadog does not expose a public API for index statistics.
To find index "${indexName}":
1. Go to Infrastructure → Database Monitoring → Databases in the Datadog UI
2. Select your database host
3. Click the "Indexes" tab
4. Search for "${indexName}"
5. View scan counts, rows fetched, and usage status`,
  };
}

// ============================================================================
// WIDGET/QUERY EXTRACTION HELPERS
// ============================================================================

/**
 * Extract widgets and their queries from a dashboard definition.
 */
function extractWidgetsFromDashboard(rawWidgets: unknown[]): DatadogWidget[] {
  const widgets: DatadogWidget[] = [];
  
  for (const raw of rawWidgets) {
    const widget = raw as Record<string, unknown>;
    const definition = widget.definition as Record<string, unknown> | undefined;
    
    if (!definition) continue;
    
    const extracted: DatadogWidget = {
      id: widget.id as number | undefined,
      title: definition.title as string | undefined,
      type: (definition.type as string) || 'unknown',
      queries: [],
    };
    
    // Extract queries from various widget types
    const queries = extractQueriesFromDefinition(definition);
    extracted.queries = queries;
    
    // Handle nested widgets (groups)
    if (definition.widgets && Array.isArray(definition.widgets)) {
      const nested = extractWidgetsFromDashboard(definition.widgets);
      widgets.push(...nested);
    }
    
    if (queries.length > 0) {
      widgets.push(extracted);
    }
  }
  
  return widgets;
}

/**
 * Extract cells from a notebook definition.
 */
function extractCellsFromNotebook(rawCells: unknown[]): DatadogNotebookCell[] {
  const cells: DatadogNotebookCell[] = [];
  
  for (const raw of rawCells) {
    const cell = raw as Record<string, unknown>;
    const attributes = cell.attributes as Record<string, unknown> | undefined;
    
    if (!attributes) continue;
    
    const definition = attributes.definition as Record<string, unknown> | undefined;
    const cellType = (definition?.type as string) || 'unknown';
    
    const extracted: DatadogNotebookCell = {
      id: (cell.id as string) || '',
      type: mapCellType(cellType),
      queries: [],
    };
    
    // For markdown cells, extract content
    if (cellType === 'markdown') {
      extracted.content = (definition?.text as string) || '';
    } else if (definition) {
      // For visualization cells, extract title and queries
      extracted.title = definition.title as string | undefined;
      extracted.queries = extractQueriesFromDefinition(definition);
    }
    
    cells.push(extracted);
  }
  
  return cells;
}

function mapCellType(type: string): DatadogNotebookCell['type'] {
  const mapping: Record<string, DatadogNotebookCell['type']> = {
    markdown: 'markdown',
    timeseries: 'timeseries',
    toplist: 'toplist',
    heatmap: 'heatmap',
    distribution: 'distribution',
    log_stream: 'log_stream',
    query_value: 'query_value',
    table: 'table',
  };
  return mapping[type] || 'unknown';
}

/**
 * Extract queries from a widget/cell definition.
 * Handles various formats: requests array, queries array, log queries, etc.
 */
function extractQueriesFromDefinition(definition: Record<string, unknown>): DatadogWidgetQuery[] {
  const queries: DatadogWidgetQuery[] = [];
  
  // Handle "requests" array (common in timeseries, toplist, etc.)
  const requests = definition.requests as unknown[] | undefined;
  if (Array.isArray(requests)) {
    for (const req of requests) {
      const request = req as Record<string, unknown>;
      
      // Simple query string (older format)
      if (typeof request.q === 'string') {
        queries.push(parseQueryString(request.q));
      }
      
      // Queries array (newer format)
      const reqQueries = request.queries as unknown[] | undefined;
      if (Array.isArray(reqQueries)) {
        for (const q of reqQueries) {
          const query = q as Record<string, unknown>;
          if (typeof query.query === 'string') {
            const parsed = parseQueryString(query.query);
            parsed.dataSource = (query.data_source as DatadogWidgetQuery['dataSource']) || parsed.dataSource;
            queries.push(parsed);
          }
        }
      }
      
      // Log query
      if (request.log_query) {
        const logQuery = request.log_query as Record<string, unknown>;
        const search = logQuery.search as Record<string, unknown> | undefined;
        if (search?.query && typeof search.query === 'string') {
          queries.push({
            query: search.query,
            dataSource: 'logs',
            description: 'Log search query',
          });
        }
      }
      
      // APM query
      if (request.apm_query) {
        const apmQuery = request.apm_query as Record<string, unknown>;
        if (apmQuery.primary_tag_value || apmQuery.service) {
          queries.push({
            query: JSON.stringify(apmQuery),
            dataSource: 'apm',
            description: `APM query for ${apmQuery.service || 'unknown service'}`,
          });
        }
      }
    }
  }
  
  // Handle top-level query (query_value, etc.)
  if (typeof definition.query === 'string') {
    queries.push(parseQueryString(definition.query));
  }
  
  return queries;
}

/**
 * Parse a metric query string to extract aggregation and groupBy.
 */
function parseQueryString(query: string): DatadogWidgetQuery {
  const result: DatadogWidgetQuery = {
    query,
    dataSource: 'metrics',
  };
  
  // Extract aggregation (sum, avg, max, min, count, etc.)
  const aggMatch = query.match(/^(sum|avg|max|min|count|top|bottom)\s*[:(\s]/i);
  if (aggMatch) {
    result.aggregation = aggMatch[1].toLowerCase();
  }
  
  // Extract group by (e.g., "by {service,env}")
  const groupByMatch = query.match(/by\s*\{([^}]+)\}/i);
  if (groupByMatch) {
    result.groupBy = groupByMatch[1].split(',').map(s => s.trim());
  }
  
  // Try to create a description
  const metricMatch = query.match(/[a-z0-9_.]+:[a-z0-9_.]+/i);
  if (metricMatch) {
    const parts = [];
    if (result.aggregation) parts.push(result.aggregation);
    parts.push(`of ${metricMatch[0]}`);
    if (result.groupBy?.length) parts.push(`grouped by ${result.groupBy.join(', ')}`);
    result.description = parts.join(' ');
  }
  
  return result;
}

/**
 * Find queries in a dashboard/notebook that might be relevant to an investigation.
 * Uses heuristics to identify useful queries.
 * 
 * @param queries - All extracted queries
 * @param keywords - Keywords to match (e.g., "error", "5xx", "upstream")
 */
export function findRelevantQueries(queries: DatadogWidgetQuery[], keywords: string[]): DatadogWidgetQuery[] {
  const lowerKeywords = keywords.map(k => k.toLowerCase());
  
  return queries.filter(q => {
    const lowerQuery = q.query.toLowerCase();
    const lowerDesc = q.description?.toLowerCase() || '';
    
    return lowerKeywords.some(kw => 
      lowerQuery.includes(kw) || lowerDesc.includes(kw)
    );
  });
}

/**
 * Suggest queries to run based on an investigation context.
 * This is a heuristic helper that looks at available queries and suggests
 * which ones might help answer common investigation questions.
 */
export function suggestInvestigationQueries(
  availableQueries: DatadogWidgetQuery[],
  context: {
    hasErrors?: boolean;
    serviceName?: string;
    environment?: string;
  }
): { query: DatadogWidgetQuery; reason: string }[] {
  const suggestions: { query: DatadogWidgetQuery; reason: string }[] = [];
  
  for (const q of availableQueries) {
    const lowerQuery = q.query.toLowerCase();
    
    // Error-related queries
    if (context.hasErrors && (
      lowerQuery.includes('error') ||
      lowerQuery.includes('5xx') ||
      lowerQuery.includes('500') ||
      lowerQuery.includes('exception')
    )) {
      suggestions.push({
        query: q,
        reason: 'This query tracks errors, which may help identify the error source',
      });
    }
    
    // Queries grouped by service/upstream
    if (q.groupBy?.some(g => 
      g.includes('service') || 
      g.includes('upstream') || 
      g.includes('cluster')
    )) {
      suggestions.push({
        query: q,
        reason: 'This query groups by service/upstream, which can help identify which service is causing issues',
      });
    }
    
    // Latency/duration queries
    if (lowerQuery.includes('duration') || 
        lowerQuery.includes('latency') || 
        lowerQuery.includes('p99') ||
        lowerQuery.includes('p95')) {
      suggestions.push({
        query: q,
        reason: 'This query tracks latency, which may help identify performance issues',
      });
    }
  }
  
  // Deduplicate by query string
  const seen = new Set<string>();
  return suggestions.filter(s => {
    if (seen.has(s.query.query)) return false;
    seen.add(s.query.query);
    return true;
  });
}

