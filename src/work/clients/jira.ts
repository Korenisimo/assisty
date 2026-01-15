// JIRA API Client
// Uses JIRA_TOKEN for authentication

import { JiraTicket, JiraComment } from '../types.js';

interface JiraConfig {
  token: string;
  baseUrl: string;
}

function getConfig(): JiraConfig {
  // Use same auth pattern as Confluence - email:api_token base64 encoded
  const username = process.env.CONFLUENCE_USERNAME;
  const apiToken = process.env.JIRA_TOKEN || process.env.CONFLUENCE_API_TOKEN;
  
  if (!username) {
    throw new Error('CONFLUENCE_USERNAME not found in environment');
  }
  if (!apiToken) {
    throw new Error('JIRA_TOKEN or CONFLUENCE_API_TOKEN not found in environment');
  }
  
  // Use JIRA_BASE_URL, or derive from CONFLUENCE_DOMAIN
  let baseUrl = process.env.JIRA_BASE_URL;
  if (!baseUrl && process.env.CONFLUENCE_DOMAIN) {
    baseUrl = `https://${process.env.CONFLUENCE_DOMAIN}`;
  }
  if (!baseUrl) {
    throw new Error('JIRA_BASE_URL or CONFLUENCE_DOMAIN not found in environment');
  }
  
  // Atlassian Cloud Basic auth: base64(email:api_token)
  const token = Buffer.from(`${username}:${apiToken}`).toString('base64');
  
  return { token, baseUrl };
}

async function jiraFetch(endpoint: string): Promise<unknown> {
  const { token, baseUrl } = getConfig();
  
  const response = await fetch(`${baseUrl}/rest/api/3${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`JIRA API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

async function jiraPost(endpoint: string, body: unknown): Promise<unknown> {
  const { token, baseUrl } = getConfig();
  
  const response = await fetch(`${baseUrl}/rest/api/3${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`JIRA API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

// Convert plain text with markdown-like formatting to Atlassian Document Format (ADF)
function textToAdf(text: string): { type: string; version: number; content: unknown[] } {
  const lines = text.split('\n');
  const content: unknown[] = [];
  let currentParagraph: unknown[] = [];
  
  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      content.push({
        type: 'paragraph',
        content: currentParagraph,
      });
      currentParagraph = [];
    }
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Empty line - flush current paragraph
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    
    // Bullet list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      content.push({
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: parseInlineFormatting(trimmed.substring(2)),
          }],
        }],
      });
      continue;
    }
    
    // Bold text with **
    if (trimmed.startsWith('**') && trimmed.endsWith('**') && trimmed.length > 4) {
      flushParagraph();
      content.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: trimmed.slice(2, -2),
          marks: [{ type: 'strong' }],
        }],
      });
      continue;
    }
    
    // Regular paragraph - parse inline formatting
    currentParagraph.push(...parseInlineFormatting(trimmed));
    currentParagraph.push({ type: 'text', text: ' ' }); // Space between lines in same paragraph
  }
  
  flushParagraph();
  
  return {
    type: 'doc',
    version: 1,
    content: content.length > 0 ? content : [{
      type: 'paragraph',
      content: [{ type: 'text', text: '' }],
    }],
  };
}

// Parse inline formatting (bold, italic, code, links)
function parseInlineFormatting(text: string): unknown[] {
  const result: unknown[] = [];
  let currentPos = 0;
  
  // Patterns to match (in order of priority)
  const patterns = [
    { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },      // [text](url)
    { regex: /`([^`]+)`/g, type: 'code' },                     // `code`
    { regex: /\*\*([^*]+)\*\*/g, type: 'bold' },               // **bold**
    { regex: /__([^_]+)__/g, type: 'bold' },                   // __bold__
    { regex: /\*([^*]+)\*/g, type: 'italic' },                 // *italic*
    { regex: /_([^_]+)_/g, type: 'italic' },                   // _italic_
  ];
  
  // Simple approach: just handle one pattern at a time
  // For production, you'd want a proper parser that handles overlapping patterns
  while (currentPos < text.length) {
    let earliestMatch: { index: number; length: number; node: unknown } | null = null;
    
    for (const pattern of patterns) {
      pattern.regex.lastIndex = currentPos;
      const match = pattern.regex.exec(text);
      
      if (match && match.index >= currentPos) {
        if (!earliestMatch || match.index < earliestMatch.index) {
          let node: unknown;
          
          if (pattern.type === 'link') {
            node = {
              type: 'text',
              text: match[1],
              marks: [{ type: 'link', attrs: { href: match[2] } }],
            };
          } else if (pattern.type === 'code') {
            node = {
              type: 'text',
              text: match[1],
              marks: [{ type: 'code' }],
            };
          } else if (pattern.type === 'bold') {
            node = {
              type: 'text',
              text: match[1],
              marks: [{ type: 'strong' }],
            };
          } else if (pattern.type === 'italic') {
            node = {
              type: 'text',
              text: match[1],
              marks: [{ type: 'em' }],
            };
          }
          
          earliestMatch = {
            index: match.index,
            length: match[0].length,
            node: node!,
          };
        }
      }
    }
    
    if (earliestMatch) {
      // Add text before the match
      if (earliestMatch.index > currentPos) {
        result.push({
          type: 'text',
          text: text.substring(currentPos, earliestMatch.index),
        });
      }
      
      // Add the formatted node
      result.push(earliestMatch.node);
      currentPos = earliestMatch.index + earliestMatch.length;
    } else {
      // No more matches - add remaining text
      result.push({
        type: 'text',
        text: text.substring(currentPos),
      });
      break;
    }
  }
  
  return result.length > 0 ? result : [{ type: 'text', text }];
}

export async function getTicket(ticketKey: string): Promise<JiraTicket | null> {
  try {
    const data = await jiraFetch(`/issue/${ticketKey}?expand=renderedFields`) as {
      key: string;
      fields: {
        summary: string;
        description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
        status: { name: string };
        assignee?: { displayName: string };
        reporter?: { displayName: string };
        priority?: { name: string };
        created: string;
        updated: string;
        labels: string[];
        components: Array<{ name: string }>;
        comment?: { comments: Array<{ author: { displayName: string }; body?: { content?: Array<{ content?: Array<{ text?: string }> }> }; created: string }> };
      };
    };
    
    // Extract plain text from Atlassian Document Format
    const extractText = (doc: { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined): string => {
      if (!doc?.content) return '';
      return doc.content
        .map(block => block.content?.map(c => c.text || '').join('') || '')
        .join('\n')
        .trim();
    };
    
    const comments: JiraComment[] = (data.fields.comment?.comments || []).map(c => ({
      author: c.author.displayName,
      body: extractText(c.body),
      created: c.created,
    }));
    
    return {
      key: data.key,
      summary: data.fields.summary,
      description: extractText(data.fields.description),
      status: data.fields.status.name,
      assignee: data.fields.assignee?.displayName,
      reporter: data.fields.reporter?.displayName,
      priority: data.fields.priority?.name,
      created: data.fields.created,
      updated: data.fields.updated,
      labels: data.fields.labels || [],
      components: data.fields.components?.map(c => c.name) || [],
      comments,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export interface CreateTicketOptions {
  projectKey: string;
  summary: string;
  description?: string;
  issueType?: string;  // defaults to 'Task'
  priority?: string;   // e.g., 'High', 'Medium', 'Low'
  labels?: string[];
  assignee?: string;   // account ID
  components?: string[]; // component names
}

export interface CreateTicketResult {
  key: string;
  id: string;
  url: string;
}

export async function createTicket(options: CreateTicketOptions): Promise<CreateTicketResult> {
  const { projectKey, summary, description, issueType = 'Task', priority, labels, assignee, components } = options;
  
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary,
    issuetype: { name: issueType },
  };
  
  if (description) {
    fields.description = textToAdf(description);
  }
  
  if (priority) {
    fields.priority = { name: priority };
  }
  
  if (labels && labels.length > 0) {
    fields.labels = labels;
  }
  
  if (assignee) {
    fields.assignee = { id: assignee };
  }
  
  if (components && components.length > 0) {
    fields.components = components.map(name => ({ name }));
  }
  
  const result = await jiraPost('/issue', { fields }) as { id: string; key: string; self: string };
  
  const { baseUrl } = getConfig();
  
  return {
    key: result.key,
    id: result.id,
    url: `${baseUrl}/browse/${result.key}`,
  };
}

export interface JiraSearchResult {
  tickets: JiraTicket[];
  note?: string;
}

export async function searchTickets(query: string, maxResults: number = 20): Promise<JiraSearchResult> {
  try {
    // JQL search - READ ONLY
    // If query looks like JQL (contains operators), use it directly
    const isJql = /\s+(AND|OR|=|~|!=|IN|NOT)\s+/i.test(query) || 
                  /^(project|status|assignee|reporter|labels|component)\s*[=~]/i.test(query);
    
    const jql = isJql 
      ? encodeURIComponent(query)
      : encodeURIComponent(`text ~ "${query}" ORDER BY updated DESC`);
    
    // Use new /search/jql endpoint (old /search was deprecated)
    const data = await jiraFetch(`/search/jql?jql=${jql}&maxResults=${maxResults}&fields=key,summary,description,status,assignee,reporter,priority,created,updated,labels,components`) as {
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
          status: { name: string };
          assignee?: { displayName: string };
          reporter?: { displayName: string };
          priority?: { name: string };
          created: string;
          updated: string;
          labels: string[];
          components: Array<{ name: string }>;
        };
      }>;
    };
    
    const extractText = (doc: { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined): string => {
      if (!doc?.content) return '';
      return doc.content
        .map(block => block.content?.map(c => c.text || '').join('') || '')
        .join('\n')
        .trim();
    };
    
    const tickets = data.issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      description: extractText(issue.fields.description),
      status: issue.fields.status.name,
      assignee: issue.fields.assignee?.displayName,
      reporter: issue.fields.reporter?.displayName,
      priority: issue.fields.priority?.name,
      created: issue.fields.created,
      updated: issue.fields.updated,
      labels: issue.fields.labels || [],
      components: issue.fields.components?.map(c => c.name) || [],
      comments: [], // Don't fetch comments for search results
    }));
    
    if (tickets.length === 0) {
      return {
        tickets: [],
        note: `No JIRA tickets found for "${query}". If you've tried 2-3 query variations, the ticket likely doesn't exist or uses different terminology. Ask the user for the ticket key directly or move on.`
      };
    }
    
    return { 
      tickets,
      note: tickets.length <= 3
        ? `Found ${tickets.length} ticket(s). Use jira_get_ticket on the most relevant one for full details - don't search again.`
        : undefined
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return { tickets: [], note: `JIRA search failed: ${errMsg}. Try a simpler query or ask the user.` };
  }
}

// Get unassigned tickets from a project
export async function getUnassignedTickets(projectKey: string, maxResults: number = 50): Promise<JiraTicket[]> {
  const jql = `project = "${projectKey}" AND assignee IS EMPTY AND status != Done ORDER BY created DESC`;
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Get tickets from a project backlog (unassigned or in backlog status)
export async function getBacklogTickets(projectKey: string, maxResults: number = 50): Promise<JiraTicket[]> {
  const jql = `project = "${projectKey}" AND (assignee IS EMPTY OR status IN ("Backlog", "To Do", "Open")) ORDER BY priority DESC, created DESC`;
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Get tickets by board/filter
export async function getBoardTickets(boardOrFilterId: string, maxResults: number = 50): Promise<JiraTicket[]> {
  // Try to get from agile board first
  try {
    const config = getConfig();
    const response = await fetch(`${config.baseUrl}/rest/agile/1.0/board/${boardOrFilterId}/issue?maxResults=${maxResults}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${config.token}`,
        'Accept': 'application/json',
      },
    });
    
    if (response.ok) {
      const data = await response.json() as { issues: Array<{ key: string; fields: Record<string, unknown> }> };
      return data.issues.map(issue => mapIssueToTicket(issue));
    }
  } catch {
    // Fall through to filter search
  }
  
  // Try as a filter ID
  const jql = `filter = ${boardOrFilterId}`;
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Helper to map JIRA issue to our ticket type
function mapIssueToTicket(issue: { key: string; fields: Record<string, unknown> }): JiraTicket {
  const fields = issue.fields as {
    summary: string;
    description?: { content?: Array<{ content?: Array<{ text?: string }> }> };
    status: { name: string };
    assignee?: { displayName: string };
    reporter?: { displayName: string };
    priority?: { name: string };
    created: string;
    updated: string;
    labels: string[];
    components: Array<{ name: string }>;
  };
  
  const extractText = (doc: { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined): string => {
    if (!doc?.content) return '';
    return doc.content
      .map(block => block.content?.map(c => c.text || '').join('') || '')
      .join('\n')
      .trim();
  };
  
  return {
    key: issue.key,
    summary: fields.summary,
    description: extractText(fields.description),
    status: fields.status?.name || 'Unknown',
    assignee: fields.assignee?.displayName,
    reporter: fields.reporter?.displayName,
    priority: fields.priority?.name,
    created: fields.created,
    updated: fields.updated,
    labels: fields.labels || [],
    components: fields.components?.map(c => c.name) || [],
    comments: [],
  };
}

// Get completed tickets assigned to a specific user
export async function getCompletedTicketsByUser(
  username: string,
  options: {
    projects?: string[];  // Optional project keys to filter
    since?: string;       // ISO date string - only tickets resolved after this date
    maxResults?: number;
  } = {}
): Promise<JiraTicket[]> {
  const { projects, since, maxResults = 50 } = options;
  
  // Build JQL query
  let jql = `assignee = "${username}" AND status = Done`;
  
  if (projects && projects.length > 0) {
    jql += ` AND project IN (${projects.map(p => `"${p}"`).join(', ')})`;
  }
  
  if (since) {
    jql += ` AND resolved >= "${since}"`;
  }
  
  jql += ' ORDER BY resolved DESC';
  
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Get tickets where user is the reporter
export async function getTicketsReportedByUser(
  username: string,
  options: {
    projects?: string[];
    status?: 'all' | 'open' | 'done';
    maxResults?: number;
  } = {}
): Promise<JiraTicket[]> {
  const { projects, status = 'all', maxResults = 50 } = options;
  
  let jql = `reporter = "${username}"`;
  
  if (projects && projects.length > 0) {
    jql += ` AND project IN (${projects.map(p => `"${p}"`).join(', ')})`;
  }
  
  if (status === 'done') {
    jql += ' AND status = Done';
  } else if (status === 'open') {
    jql += ' AND status != Done';
  }
  
  jql += ' ORDER BY created DESC';
  
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Get all tickets a user has worked on (assigned, reporter, or mentioned)
export async function getAllTicketsByUser(
  username: string,
  options: {
    since?: string;  // ISO date
    maxResults?: number;
  } = {}
): Promise<JiraTicket[]> {
  const { since, maxResults = 100 } = options;
  
  let jql = `(assignee = "${username}" OR reporter = "${username}")`;
  
  if (since) {
    jql += ` AND updated >= "${since}"`;
  }
  
  jql += ' ORDER BY updated DESC';
  
  const result = await searchTickets(jql, maxResults);
  return result.tickets;
}

// Get ticket counts/stats for a user (useful for achievements summary)
export async function getUserTicketStats(
  username: string,
  options: {
    since?: string;
    projects?: string[];
  } = {}
): Promise<{
  completed: number;
  inProgress: number;
  reported: number;
  total: number;
}> {
  const { since, projects } = options;
  
  // Get completed tickets
  const completed = await getCompletedTicketsByUser(username, { since, projects, maxResults: 200 });
  
  // Get all assigned tickets
  let assignedJql = `assignee = "${username}"`;
  if (projects && projects.length > 0) {
    assignedJql += ` AND project IN (${projects.map(p => `"${p}"`).join(', ')})`;
  }
  if (since) {
    assignedJql += ` AND updated >= "${since}"`;
  }
  const allAssignedResult = await searchTickets(assignedJql, 200);
  const allAssigned = allAssignedResult.tickets;
  
  // Get in-progress
  const inProgress = allAssigned.filter(t => t.status !== 'Done');
  
  // Get reported
  const reported = await getTicketsReportedByUser(username, { projects, maxResults: 200 });
  
  return {
    completed: completed.length,
    inProgress: inProgress.length,
    reported: reported.length,
    total: allAssigned.length + reported.length,
  };
}

export function isJiraConfigured(): boolean {
  const hasUsername = !!process.env.CONFLUENCE_USERNAME;
  const hasToken = !!(process.env.JIRA_TOKEN || process.env.CONFLUENCE_API_TOKEN);
  const hasBaseUrl = !!(process.env.JIRA_BASE_URL || process.env.CONFLUENCE_DOMAIN);
  return hasUsername && hasToken && hasBaseUrl;
}

export function getJiraConfigStatus(): { configured: boolean; error?: string } {
  if (!process.env.CONFLUENCE_USERNAME) {
    return { configured: false, error: 'CONFLUENCE_USERNAME not set' };
  }
  if (!process.env.JIRA_TOKEN && !process.env.CONFLUENCE_API_TOKEN) {
    return { configured: false, error: 'JIRA_TOKEN or CONFLUENCE_API_TOKEN not set' };
  }
  if (!process.env.JIRA_BASE_URL && !process.env.CONFLUENCE_DOMAIN) {
    return { configured: false, error: 'JIRA_BASE_URL or CONFLUENCE_DOMAIN not set' };
  }
  return { configured: true };
}

/**
 * Wrap JIRA comment with AI assistant disclaimer
 */
function wrapWithAIDisclaimer(comment: string): string {
  const disclaimer = "🤖 *Hey! Koren's AI assistant here. I've looked into this, but I'm not perfect—double-check with Koren if you need to be sure.*\n\n";
  return disclaimer + comment;
}

export interface AddCommentOptions {
  ticketKey: string;
  comment: string;
  skipDisclaimer?: boolean;  // Allow skipping disclaimer if needed
}

export interface AddCommentResult {
  id: string;
  created: string;
  author: string;
}

export async function addComment(options: AddCommentOptions): Promise<AddCommentResult> {
  const { ticketKey, comment, skipDisclaimer = false } = options;
  
  // Add AI disclaimer unless explicitly skipped
  const finalComment = skipDisclaimer ? comment : wrapWithAIDisclaimer(comment);
  
  const body = {
    body: textToAdf(finalComment),
  };
  
  const result = await jiraPost(`/issue/${ticketKey}/comment`, body) as {
    id: string;
    created: string;
    author: { displayName: string };
  };
  
  return {
    id: result.id,
    created: result.created,
    author: result.author.displayName,
  };
}

