// Web browsing tools for the AI assistant
// Provides URL fetching and web search capabilities

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export interface FetchedPage {
  url: string;
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  success: boolean;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResults {
  query: string;
  results: SearchResult[];
  success: boolean;
  error?: string;
}

// User agent to avoid being blocked
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch a URL and extract readable content
 */
export async function fetchUrl(url: string): Promise<FetchedPage> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        url,
        title: '',
        content: '',
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();
    
    // Use JSDOM + Readability to extract readable content
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article) {
      return {
        url,
        title: article.title || '',
        content: article.textContent || '',
        excerpt: article.excerpt || undefined,
        byline: article.byline || undefined,
        success: true,
      };
    }

    // Fallback: extract text from body
    const body = dom.window.document.body;
    const title = dom.window.document.title || '';
    
    // Remove script and style elements
    const scripts = body.querySelectorAll('script, style, noscript');
    scripts.forEach(el => el.remove());
    
    const content = body.textContent?.trim() || '';

    return {
      url,
      title,
      content: content.substring(0, 10000), // Limit content size
      success: true,
    };
  } catch (error) {
    return {
      url,
      title: '',
      content: '',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Search the web using DuckDuckGo HTML
 */
export async function webSearch(query: string, maxResults: number = 5): Promise<WebSearchResults> {
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      return {
        query,
        results: [],
        success: false,
        error: `Search failed: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const results: SearchResult[] = [];
    
    // DuckDuckGo HTML results are in .result elements
    const resultElements = doc.querySelectorAll('.result');
    
    for (const result of resultElements) {
      if (results.length >= maxResults) break;
      
      const titleEl = result.querySelector('.result__title a, .result__a');
      const snippetEl = result.querySelector('.result__snippet');
      
      if (titleEl) {
        let href = titleEl.getAttribute('href') || '';
        
        // DuckDuckGo uses redirect URLs, extract the actual URL
        if (href.includes('uddg=')) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) {
            href = decodeURIComponent(match[1]);
          }
        }
        
        // Skip DuckDuckGo internal links
        if (href.startsWith('//duckduckgo.com') || href.startsWith('/')) {
          continue;
        }
        
        results.push({
          title: titleEl.textContent?.trim() || '',
          url: href,
          snippet: snippetEl?.textContent?.trim() || '',
        });
      }
    }

    return {
      query,
      results,
      success: true,
    };
  } catch (error) {
    return {
      query,
      results: [],
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch multiple URLs in parallel
 */
export async function fetchUrls(urls: string[]): Promise<FetchedPage[]> {
  const results = await Promise.all(urls.map(url => fetchUrl(url)));
  return results;
}

/**
 * Search and fetch - search for a query, then fetch the top result
 */
export async function searchAndFetch(query: string): Promise<{
  searchResults: SearchResult[];
  topResult?: FetchedPage;
}> {
  const search = await webSearch(query, 3);
  
  if (!search.success || search.results.length === 0) {
    return { searchResults: [] };
  }
  
  // Fetch the top result
  const topResult = await fetchUrl(search.results[0].url);
  
  return {
    searchResults: search.results,
    topResult: topResult.success ? topResult : undefined,
  };
}




