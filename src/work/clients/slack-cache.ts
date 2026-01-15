// Slack extraction caching to reduce Gemini API rate limiting
// Aggressive in-memory caching for DOM extractions

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  key: string;
}

class SlackCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL: number = 45000; // 45 seconds default

  /**
   * Get cached data if exists and not expired
   */
  get<T>(key: string, ttlMs?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const ttl = ttlMs ?? this.defaultTTL;
    const age = Date.now() - entry.timestamp;

    if (age > ttl) {
      // Expired, remove it
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Store data in cache
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      key,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string, ttlMs?: number): boolean {
    return this.get(key, ttlMs) !== null;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Clear cache entries older than specified age
   */
  clearOlderThan(ageMs: number): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > ageMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear cache entries matching a pattern
   */
  clearMatching(pattern: RegExp): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    entries: Array<{ key: string; age: number }>;
  } {
    const now = Date.now();
    const entries: Array<{ key: string; age: number }> = [];

    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key,
        age: now - entry.timestamp,
      });
    }

    return {
      size: this.cache.size,
      entries,
    };
  }
}

// Singleton instance
export const slackCache = new SlackCache();

/**
 * Cache key generators for different extraction types
 */
export const CacheKeys = {
  messages: (channelId: string, scrollPosition: number) => 
    `messages-${channelId}-${scrollPosition}`,
  
  search: (query: string, pressEnter: boolean) => 
    `search-${query}-${pressEnter}`,
  
  slackAI: (question: string) => {
    // Hash the question to create a stable key
    const hash = Buffer.from(question).toString('base64').substring(0, 32);
    return `slack-ai-${hash}`;
  },
  
  currentChannel: () => 'current-channel',
};

/**
 * TTL (Time To Live) values for different cache types
 */
export const CacheTTL = {
  messages: 45000,      // 45 seconds - messages change frequently
  search: 60000,        // 60 seconds - search results are relatively stable
  slackAI: 300000,      // 5 minutes - AI answers don't change
  currentChannel: 30000, // 30 seconds - channel info is stable during navigation
};
