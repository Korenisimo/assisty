// Google Docs/Drive API Client - READ ONLY
// Uses GOOGLE_API_KEY or GOOGLE_ACCESS_TOKEN for authentication
// For private docs, you need an OAuth access token

export interface GoogleDoc {
  id: string;
  title: string;
  content: string; // Plain text extracted from the doc
  url: string;
  createdTime?: string;
  modifiedTime?: string;
  lastModifyingUser?: string;
}

export interface GoogleDocComment {
  id: string;
  content: string;
  author: string;
  authorPhotoUrl?: string;
  createdTime: string;
  modifiedTime?: string;
  resolved: boolean;
  replies: GoogleDocCommentReply[];
  quotedContent?: string; // The text that was highlighted when commenting
}

export interface GoogleDocCommentReply {
  id: string;
  content: string;
  author: string;
  createdTime: string;
}

interface GoogleDocsConfig {
  accessToken?: string;
  apiKey?: string;
}

function getConfig(): GoogleDocsConfig {
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  const apiKey = process.env.GOOGLE_API_KEY;
  
  if (!accessToken && !apiKey) {
    throw new Error('Missing Google config: GOOGLE_ACCESS_TOKEN or GOOGLE_API_KEY required');
  }
  
  return { accessToken, apiKey };
}

/**
 * Extract document ID from various Google Docs URL formats
 */
export function extractDocId(urlOrId: string): string {
  // If it's already just an ID (no slashes or dots)
  if (/^[a-zA-Z0-9_-]+$/.test(urlOrId) && urlOrId.length > 20) {
    return urlOrId;
  }
  
  // Handle various URL formats:
  // https://docs.google.com/document/d/DOC_ID/edit
  // https://docs.google.com/document/d/DOC_ID/edit?usp=sharing
  // https://docs.google.com/document/d/DOC_ID
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]{20,})$/,
  ];
  
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  throw new Error(`Could not extract document ID from: ${urlOrId}`);
}

async function googleDocsFetch(endpoint: string): Promise<unknown> {
  const { accessToken, apiKey } = getConfig();
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  let url = `https://docs.googleapis.com/v1${endpoint}`;
  
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `key=${apiKey}`;
  }
  
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Google Docs API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

async function googleDriveFetch(endpoint: string): Promise<unknown> {
  const { accessToken, apiKey } = getConfig();
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  let url = `https://www.googleapis.com/drive/v3${endpoint}`;
  
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else if (apiKey) {
    url += (url.includes('?') ? '&' : '?') + `key=${apiKey}`;
  }
  
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Google Drive API error (${response.status}): ${errorText}`);
  }
  
  return response.json();
}

/**
 * Extract plain text from a Google Docs document structure
 */
function extractTextFromDoc(doc: { body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> } }): string {
  if (!doc.body?.content) {
    return '';
  }
  
  const textParts: string[] = [];
  
  for (const element of doc.body.content) {
    if (element.paragraph?.elements) {
      for (const paragraphElement of element.paragraph.elements) {
        if (paragraphElement.textRun?.content) {
          textParts.push(paragraphElement.textRun.content);
        }
      }
    }
  }
  
  return textParts.join('');
}

/**
 * Get a Google Doc by URL or ID
 */
export async function getGoogleDoc(urlOrId: string): Promise<GoogleDoc> {
  const docId = extractDocId(urlOrId);
  
  // Get document content
  const doc = await googleDocsFetch(`/documents/${docId}`) as {
    documentId: string;
    title: string;
    body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> };
  };
  
  // Get file metadata from Drive API for timestamps
  let metadata: { createdTime?: string; modifiedTime?: string; lastModifyingUser?: { displayName?: string } } = {};
  try {
    metadata = await googleDriveFetch(`/files/${docId}?fields=createdTime,modifiedTime,lastModifyingUser`) as typeof metadata;
  } catch {
    // Metadata fetch failed, continue without it
  }
  
  return {
    id: doc.documentId,
    title: doc.title,
    content: extractTextFromDoc(doc),
    url: `https://docs.google.com/document/d/${docId}/edit`,
    createdTime: metadata.createdTime,
    modifiedTime: metadata.modifiedTime,
    lastModifyingUser: metadata.lastModifyingUser?.displayName,
  };
}

/**
 * Get comments on a Google Doc
 */
export async function getGoogleDocComments(urlOrId: string): Promise<GoogleDocComment[]> {
  const docId = extractDocId(urlOrId);
  
  // Comments API is through Google Drive
  const response = await googleDriveFetch(`/files/${docId}/comments?fields=comments(id,content,author,createdTime,modifiedTime,resolved,replies,quotedFileContent)`) as {
    comments?: Array<{
      id: string;
      content: string;
      author: { displayName: string; photoLink?: string };
      createdTime: string;
      modifiedTime?: string;
      resolved: boolean;
      quotedFileContent?: { value?: string };
      replies?: Array<{
        id: string;
        content: string;
        author: { displayName: string };
        createdTime: string;
      }>;
    }>;
  };
  
  if (!response.comments) {
    return [];
  }
  
  return response.comments.map(comment => ({
    id: comment.id,
    content: comment.content,
    author: comment.author.displayName,
    authorPhotoUrl: comment.author.photoLink,
    createdTime: comment.createdTime,
    modifiedTime: comment.modifiedTime,
    resolved: comment.resolved,
    quotedContent: comment.quotedFileContent?.value,
    replies: (comment.replies || []).map(reply => ({
      id: reply.id,
      content: reply.content,
      author: reply.author.displayName,
      createdTime: reply.createdTime,
    })),
  }));
}

/**
 * Search for Google Docs created/owned by the current user
 * Requires OAuth access token (not API key)
 */
export async function searchMyGoogleDocs(query?: string, maxResults: number = 25): Promise<Array<{
  id: string;
  title: string;
  url: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
}>> {
  // Build query: my docs that are Google Docs/Sheets/Slides
  let q = "'me' in owners and (mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.presentation')";
  
  if (query) {
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }
  
  const response = await googleDriveFetch(`/files?q=${encodeURIComponent(q)}&pageSize=${maxResults}&fields=files(id,name,mimeType,createdTime,modifiedTime,webViewLink)&orderBy=modifiedTime desc`) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      createdTime: string;
      modifiedTime: string;
      webViewLink: string;
    }>;
  };
  
  if (!response.files) {
    return [];
  }
  
  return response.files.map(file => ({
    id: file.id,
    title: file.name,
    url: file.webViewLink,
    mimeType: file.mimeType,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
  }));
}

/**
 * Check if Google Docs/Drive is configured
 */
export function isGoogleDocsConfigured(): boolean {
  return !!(process.env.GOOGLE_ACCESS_TOKEN || process.env.GOOGLE_API_KEY);
}

/**
 * Get configuration status for Google Docs/Drive
 */
export function getGoogleDocsConfigStatus(): { configured: boolean; authType?: 'oauth' | 'apikey'; error?: string } {
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return { configured: true, authType: 'oauth' };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { configured: true, authType: 'apikey' };
  }
  return { configured: false, error: 'GOOGLE_ACCESS_TOKEN or GOOGLE_API_KEY not set' };
}



