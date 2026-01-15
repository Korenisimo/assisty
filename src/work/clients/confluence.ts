// Confluence API Client
// Uses CONFLUENCE_USERNAME, CONFLUENCE_DOMAIN, CONFLUENCE_API_TOKEN

import { ConfluencePage } from '../types.js';

interface ConfluenceConfig {
  username: string;
  domain: string;
  apiToken: string;
}

function getConfig(): ConfluenceConfig {
  const username = process.env.CONFLUENCE_USERNAME;
  const domain = process.env.CONFLUENCE_DOMAIN;
  const apiToken = process.env.CONFLUENCE_API_TOKEN;
  
  if (!username || !domain || !apiToken) {
    throw new Error('Missing Confluence config: CONFLUENCE_USERNAME, CONFLUENCE_DOMAIN, CONFLUENCE_API_TOKEN required');
  }
  
  return { username, domain, apiToken };
}

async function confluenceFetch(endpoint: string): Promise<unknown> {
  const { username, domain, apiToken } = getConfig();
  const auth = Buffer.from(`${username}:${apiToken}`).toString('base64');
  
  const response = await fetch(`https://${domain}/wiki/rest/api${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Confluence API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

async function confluencePost(endpoint: string, body: unknown): Promise<unknown> {
  const { username, domain, apiToken } = getConfig();
  const auth = Buffer.from(`${username}:${apiToken}`).toString('base64');
  
  const response = await fetch(`https://${domain}/wiki/rest/api${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Confluence API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

export interface ConfluenceSearchResult {
  results: ConfluencePage[];
  note?: string;
}

export async function searchPages(query: string, maxResults: number = 15): Promise<ConfluenceSearchResult> {
  try {
    const { domain } = getConfig();
    const cql = encodeURIComponent(`text ~ "${query}" AND type = page ORDER BY lastmodified DESC`);
    
    const data = await confluenceFetch(`/content/search?cql=${cql}&limit=${maxResults}&expand=space,version`) as {
      results: Array<{
        id: string;
        title: string;
        excerpt?: string;
        space: { key: string; name: string };
        version: { when: string };
        _links: { webui: string };
      }>;
    };
    
    const results = data.results.map(page => ({
      id: page.id,
      title: page.title,
      excerpt: page.excerpt || '',
      url: `https://${domain}/wiki${page._links.webui}`,
      space: page.space?.name || page.space?.key || 'Unknown',
      lastModified: page.version?.when || '',
    }));
    
    if (results.length === 0) {
      return {
        results: [],
        note: `No Confluence pages found for "${query}". If you've tried 2-3 query variations, the content likely doesn't exist. Ask the user for a direct link or move on.`
      };
    }
    
    return { 
      results,
      note: results.length <= 3 
        ? `Found ${results.length} result(s). Use confluence_get_page on the most relevant one - don't search again with variations.`
        : undefined
    };
  } catch {
    return { results: [], note: 'Search failed. Try a simpler query or ask the user.' };
  }
}

export async function getPage(pageId: string): Promise<ConfluencePage | null> {
  try {
    const { domain } = getConfig();
    
    const data = await confluenceFetch(`/content/${pageId}?expand=space,body.view,version`) as {
      id: string;
      title: string;
      space: { key: string; name: string };
      body: { view: { value: string } };
      version: { when: string };
      _links: { webui: string };
    };
    
    // Extract plain text from HTML - full content
    const fullContent = data.body?.view?.value
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '';
    
    // Excerpt is first 500 chars for search results
    const excerpt = fullContent.substring(0, 500);
    
    return {
      id: data.id,
      title: data.title,
      excerpt,
      content: fullContent,  // Full page content
      url: `https://${domain}/wiki${data._links.webui}`,
      space: data.space?.name || data.space?.key || 'Unknown',
      lastModified: data.version?.when || '',
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

export interface ConfluenceComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  isInline: boolean;
  parentCommentId?: string;
}

export interface ConfluenceCommentsResult {
  comments: ConfluenceComment[];
  pageId: string;
  pageTitle?: string;
  note?: string;
}

/**
 * Get comments on a Confluence page (both page-level and inline comments)
 */
export async function getPageComments(
  pageId: string,
  options: { includeInline?: boolean } = {}
): Promise<ConfluenceCommentsResult> {
  const { includeInline = true } = options;
  const comments: ConfluenceComment[] = [];
  
  try {
    // Get page-level comments (child comments)
    const pageComments = await confluenceFetch(
      `/content/${pageId}/child/comment?expand=body.view,version,ancestors&depth=all`
    ) as {
      results: Array<{
        id: string;
        title: string;
        body: { view: { value: string } };
        version: { by: { displayName: string }; when: string };
        ancestors?: Array<{ id: string }>;
      }>;
    };
    
    for (const comment of pageComments.results) {
      const content = comment.body?.view?.value
        ?.replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '';
      
      comments.push({
        id: comment.id,
        author: comment.version?.by?.displayName || 'Unknown',
        content,
        createdAt: comment.version?.when || '',
        isInline: false,
        parentCommentId: comment.ancestors?.[0]?.id,
      });
    }
    
    // Get inline comments (annotations) if requested
    if (includeInline) {
      try {
        const inlineComments = await confluenceFetch(
          `/content/${pageId}/child/comment?expand=body.view,version,extensions.inlineProperties&location=inline`
        ) as {
          results: Array<{
            id: string;
            body: { view: { value: string } };
            version: { by: { displayName: string }; when: string };
            extensions?: { inlineProperties?: { markerRef?: string } };
          }>;
        };
        
        for (const comment of inlineComments.results) {
          // Skip if already added (some APIs return duplicates)
          if (comments.some(c => c.id === comment.id)) continue;
          
          const content = comment.body?.view?.value
            ?.replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || '';
          
          comments.push({
            id: comment.id,
            author: comment.version?.by?.displayName || 'Unknown',
            content,
            createdAt: comment.version?.when || '',
            isInline: true,
          });
        }
      } catch {
        // Inline comments endpoint might not be available on all Confluence versions
      }
    }
    
    if (comments.length === 0) {
      return {
        comments: [],
        pageId,
        note: 'No comments found on this page.',
      };
    }
    
    // Sort by date (newest first)
    comments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return {
      comments,
      pageId,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      return { comments: [], pageId, note: 'Page not found.' };
    }
    if (error instanceof Error && error.message.includes('403')) {
      return { comments: [], pageId, note: 'Access denied. You may not have permission to view comments on this page.' };
    }
    throw error;
  }
}

/**
 * Search for pages created by a specific user
 */
export async function searchPagesByAuthor(
  authorUsername: string,
  options: {
    maxResults?: number;
    since?: string; // ISO date string
  } = {}
): Promise<ConfluencePage[]> {
  try {
    const { domain } = getConfig();
    const { maxResults = 25, since } = options;
    
    // CQL query for pages by creator
    let cql = `creator = "${authorUsername}" AND type = page`;
    
    if (since) {
      cql += ` AND created >= "${since}"`;
    }
    
    cql += ' ORDER BY created DESC';
    
    const data = await confluenceFetch(`/content/search?cql=${encodeURIComponent(cql)}&limit=${maxResults}&expand=space,version`) as {
      results: Array<{
        id: string;
        title: string;
        excerpt?: string;
        space: { key: string; name: string };
        version: { when: string };
        _links: { webui: string };
      }>;
    };
    
    return data.results.map(page => ({
      id: page.id,
      title: page.title,
      excerpt: page.excerpt || '',
      url: `https://${domain}/wiki${page._links.webui}`,
      space: page.space?.name || page.space?.key || 'Unknown',
      lastModified: page.version?.when || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Search for pages where user is a contributor (created or last edited)
 */
export async function searchPagesContributedByUser(
  username: string,
  options: {
    maxResults?: number;
    since?: string;
  } = {}
): Promise<ConfluencePage[]> {
  try {
    const { domain } = getConfig();
    const { maxResults = 25, since } = options;
    
    // CQL query for pages by contributor
    let cql = `contributor = "${username}" AND type = page`;
    
    if (since) {
      cql += ` AND lastmodified >= "${since}"`;
    }
    
    cql += ' ORDER BY lastmodified DESC';
    
    const data = await confluenceFetch(`/content/search?cql=${encodeURIComponent(cql)}&limit=${maxResults}&expand=space,version`) as {
      results: Array<{
        id: string;
        title: string;
        excerpt?: string;
        space: { key: string; name: string };
        version: { when: string };
        _links: { webui: string };
      }>;
    };
    
    return data.results.map(page => ({
      id: page.id,
      title: page.title,
      excerpt: page.excerpt || '',
      url: `https://${domain}/wiki${page._links.webui}`,
      space: page.space?.name || page.space?.key || 'Unknown',
      lastModified: page.version?.when || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Get page counts/stats for a user
 */
export async function getUserPageStats(
  username: string,
  options: {
    since?: string;
  } = {}
): Promise<{
  created: number;
  contributed: number;
}> {
  const created = await searchPagesByAuthor(username, { ...options, maxResults: 100 });
  const contributed = await searchPagesContributedByUser(username, { ...options, maxResults: 100 });
  
  return {
    created: created.length,
    contributed: contributed.length,
  };
}

/**
 * Create a new Confluence page
 */
export async function createPage(
  spaceKey: string,
  title: string,
  content: string,  // Confluence storage format (HTML-like) or plain text
  options: {
    parentPageId?: string;
    convertFromMarkdown?: boolean;  // If true, attempts basic markdown-to-storage conversion
  } = {}
): Promise<{ id: string; url: string; title: string }> {
  const { domain } = getConfig();
  
  // Convert markdown to Confluence storage format if requested
  let storageContent = content;
  if (options.convertFromMarkdown) {
    storageContent = markdownToConfluenceStorage(content);
  }
  
  const body: Record<string, unknown> = {
    type: 'page',
    title,
    space: { key: spaceKey },
    body: {
      storage: {
        value: storageContent,
        representation: 'storage',
      },
    },
  };
  
  if (options.parentPageId) {
    body.ancestors = [{ id: options.parentPageId }];
  }
  
  const result = await confluencePost('/content', body) as {
    id: string;
    title: string;
    _links: { webui: string };
  };
  
  return {
    id: result.id,
    title: result.title,
    url: `https://${domain}/wiki${result._links.webui}`,
  };
}

/**
 * List spaces the user has access to
 */
export async function listSpaces(limit: number = 25): Promise<Array<{ key: string; name: string; type: string }>> {
  try {
    const data = await confluenceFetch(`/space?limit=${limit}`) as {
      results: Array<{ key: string; name: string; type: string }>;
    };
    return data.results.map(s => ({ key: s.key, name: s.name, type: s.type }));
  } catch {
    return [];
  }
}

/**
 * Basic markdown to Confluence storage format conversion
 */
function markdownToConfluenceStorage(markdown: string): string {
  let html = markdown;
  
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang || 'none';
    return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${language}</ac:parameter><ac:plain-text-body><![CDATA[${code.trim()}]]></ac:plain-text-body></ac:structured-macro>`;
  });
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  
  // Unordered lists (basic - single level)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // Paragraphs - wrap lines that aren't already HTML
  const lines = html.split('\n');
  const processed = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<')) return line;
    return `<p>${trimmed}</p>`;
  });
  
  return processed.join('\n');
}

export function isConfluenceConfigured(): boolean {
  return !!(process.env.CONFLUENCE_USERNAME && process.env.CONFLUENCE_DOMAIN && process.env.CONFLUENCE_API_TOKEN);
}

