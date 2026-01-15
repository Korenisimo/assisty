// Trash Bin State Management
// Soft-delete and recovery for workstreams

import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Workstream } from '../types.js';
import { ensureConfigDir } from '../../../utils/platform.js';

// Extended interface for trashed workstreams
export interface TrashedWorkstream extends Workstream {
  deletedAt: number;
  deletionReason?: string;
}

// Search result with context
export interface TrashSearchResult {
  workstream: TrashedWorkstream;
  matchContext: string;  // Preview of where the match was found
  matchType: 'name' | 'message' | 'metadata';
}

// Storage directory (uses platform-appropriate config directory)
function getTrashDir(): string {
  return join(ensureConfigDir(), 'trash');
}

// Default retention period: 30 days
const DEFAULT_RETENTION_DAYS = 30;

export class TrashBinManager {
  private trashedItems: Map<string, TrashedWorkstream> = new Map();
  private loaded: boolean = false;
  private retentionDays: number = DEFAULT_RETENTION_DAYS;

  async ensureDir(): Promise<void> {
    const dir = getTrashDir();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    
    await this.ensureDir();
    const dir = getTrashDir();
    
    try {
      const files = await readdir(dir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const trashed = JSON.parse(content) as TrashedWorkstream;
          this.trashedItems.set(trashed.id, trashed);
        } catch {
          // Skip invalid files
        }
      }
      
      this.loaded = true;
      
      // Auto-cleanup old items
      await this.cleanupExpired();
    } catch {
      this.loaded = true;
    }
  }

  private async save(trashed: TrashedWorkstream): Promise<void> {
    await this.ensureDir();
    const filepath = join(getTrashDir(), `${trashed.id}.json`);
    await writeFile(filepath, JSON.stringify(trashed, null, 2));
  }

  /**
   * Move a workstream to trash (soft delete)
   */
  async moveToTrash(workstream: Workstream, reason?: string): Promise<TrashedWorkstream> {
    await this.load();
    
    const trashed: TrashedWorkstream = {
      ...workstream,
      deletedAt: Date.now(),
      deletionReason: reason,
    };
    
    this.trashedItems.set(trashed.id, trashed);
    await this.save(trashed);
    
    return trashed;
  }

  /**
   * Restore a workstream from trash
   * Returns the workstream without trash metadata, or null if not found
   */
  async restore(id: string): Promise<Workstream | null> {
    await this.load();
    
    const trashed = this.trashedItems.get(id);
    if (!trashed) return null;
    
    // Remove from trash
    this.trashedItems.delete(id);
    
    const filepath = join(getTrashDir(), `${id}.json`);
    try {
      await unlink(filepath);
    } catch {
      // File might not exist
    }
    
    // Return workstream without trash metadata
    const { deletedAt, deletionReason, ...workstream } = trashed;
    
    // Update timestamps on restore
    return {
      ...workstream,
      updatedAt: Date.now(),
    } as Workstream;
  }

  /**
   * Permanently delete from trash
   */
  async permanentlyDelete(id: string): Promise<boolean> {
    await this.load();
    
    const trashed = this.trashedItems.get(id);
    if (!trashed) return false;
    
    this.trashedItems.delete(id);
    
    const filepath = join(getTrashDir(), `${id}.json`);
    try {
      await unlink(filepath);
    } catch {
      // File might not exist
    }
    
    return true;
  }

  /**
   * Get all trashed workstreams, sorted by deletion date (newest first)
   */
  async list(): Promise<TrashedWorkstream[]> {
    await this.load();
    
    return Array.from(this.trashedItems.values())
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }

  /**
   * Get a specific trashed workstream by ID
   */
  async get(id: string): Promise<TrashedWorkstream | null> {
    await this.load();
    return this.trashedItems.get(id) || null;
  }

  /**
   * Basic keyword search in trash
   */
  async search(query: string): Promise<TrashSearchResult[]> {
    await this.load();
    
    const results: TrashSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 0);
    
    for (const trashed of this.trashedItems.values()) {
      // Search in name
      if (trashed.name.toLowerCase().includes(queryLower)) {
        results.push({
          workstream: trashed,
          matchContext: `Name: "${trashed.name}"`,
          matchType: 'name',
        });
        continue;
      }
      
      // Search in metadata
      if (trashed.metadata) {
        const metaString = JSON.stringify(trashed.metadata).toLowerCase();
        if (queryTerms.some(term => metaString.includes(term))) {
          const metaPreview = trashed.metadata.ticketKey || 
                             trashed.metadata.prUrl || 
                             trashed.metadata.description || 
                             'metadata match';
          results.push({
            workstream: trashed,
            matchContext: `Metadata: ${metaPreview}`,
            matchType: 'metadata',
          });
          continue;
        }
      }
      
      // Search in messages
      for (const msg of trashed.messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (queryTerms.some(term => content.toLowerCase().includes(term))) {
          // Get a preview around the match
          const preview = this.getMatchPreview(content, queryTerms[0]);
          results.push({
            workstream: trashed,
            matchContext: `Message: "${preview}"`,
            matchType: 'message',
          });
          break; // Only one result per workstream
        }
      }
    }
    
    return results;
  }

  /**
   * Smart search with semantic matching
   * Uses multiple strategies: exact match, fuzzy match, keyword extraction
   */
  async smartSearch(query: string): Promise<TrashSearchResult[]> {
    await this.load();
    
    const results: TrashSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = this.extractKeywords(query);
    
    // Score each trashed workstream
    const scored: Array<{ workstream: TrashedWorkstream; score: number; context: string; matchType: 'name' | 'message' | 'metadata' }> = [];
    
    for (const trashed of this.trashedItems.values()) {
      let bestScore = 0;
      let bestContext = '';
      let bestMatchType: 'name' | 'message' | 'metadata' = 'name';
      
      // Name matching (highest weight)
      const nameLower = trashed.name.toLowerCase();
      if (nameLower === queryLower) {
        bestScore = 100;
        bestContext = `Name: "${trashed.name}"`;
        bestMatchType = 'name';
      } else if (nameLower.includes(queryLower)) {
        bestScore = 80;
        bestContext = `Name: "${trashed.name}"`;
        bestMatchType = 'name';
      } else {
        const nameScore = this.calculateTermScore(nameLower, queryTerms);
        if (nameScore > bestScore) {
          bestScore = nameScore;
          bestContext = `Name: "${trashed.name}"`;
          bestMatchType = 'name';
        }
      }
      
      // Type matching
      if (trashed.type.toLowerCase().includes(queryLower) && bestScore < 60) {
        bestScore = 60;
        bestContext = `Type: ${trashed.type}`;
        bestMatchType = 'name';
      }
      
      // Metadata matching
      if (trashed.metadata) {
        const metaFields = [
          trashed.metadata.ticketKey,
          trashed.metadata.prUrl,
          trashed.metadata.description,
        ].filter(Boolean);
        
        for (const field of metaFields) {
          if (!field) continue;
          const fieldLower = field.toLowerCase();
          if (fieldLower.includes(queryLower) && bestScore < 70) {
            bestScore = 70;
            bestContext = `Metadata: ${field}`;
            bestMatchType = 'metadata';
            break;
          }
          const metaScore = this.calculateTermScore(fieldLower, queryTerms);
          if (metaScore > bestScore) {
            bestScore = metaScore;
            bestContext = `Metadata: ${field}`;
            bestMatchType = 'metadata';
          }
        }
      }
      
      // Message content matching (lower weight, more content)
      for (const msg of trashed.messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const contentLower = content.toLowerCase();
        
        if (contentLower.includes(queryLower) && bestScore < 50) {
          bestScore = 50;
          bestContext = `Message: "${this.getMatchPreview(content, queryLower)}"`;
          bestMatchType = 'message';
        }
        
        const msgScore = this.calculateTermScore(contentLower, queryTerms) * 0.6; // Reduce weight
        if (msgScore > bestScore) {
          bestScore = msgScore;
          bestContext = `Message: "${this.getMatchPreview(content, queryTerms[0] || '')}"`;
          bestMatchType = 'message';
        }
      }
      
      if (bestScore > 20) { // Minimum threshold
        scored.push({
          workstream: trashed,
          score: bestScore,
          context: bestContext,
          matchType: bestMatchType,
        });
      }
    }
    
    // Sort by score and return
    scored.sort((a, b) => b.score - a.score);
    
    return scored.map(s => ({
      workstream: s.workstream,
      matchContext: s.context,
      matchType: s.matchType,
    }));
  }

  /**
   * Empty the entire trash bin
   */
  async emptyTrash(): Promise<number> {
    await this.load();
    
    const count = this.trashedItems.size;
    
    for (const id of this.trashedItems.keys()) {
      const filepath = join(getTrashDir(), `${id}.json`);
      try {
        await unlink(filepath);
      } catch {
        // Ignore errors
      }
    }
    
    this.trashedItems.clear();
    return count;
  }

  /**
   * Get trash statistics
   */
  async getStats(): Promise<{
    count: number;
    oldestDeletedAt: number | null;
    newestDeletedAt: number | null;
    totalMessages: number;
  }> {
    await this.load();
    
    const items = Array.from(this.trashedItems.values());
    
    if (items.length === 0) {
      return {
        count: 0,
        oldestDeletedAt: null,
        newestDeletedAt: null,
        totalMessages: 0,
      };
    }
    
    const deletedTimes = items.map(i => i.deletedAt);
    const totalMessages = items.reduce((sum, i) => sum + i.messages.length, 0);
    
    return {
      count: items.length,
      oldestDeletedAt: Math.min(...deletedTimes),
      newestDeletedAt: Math.max(...deletedTimes),
      totalMessages,
    };
  }

  /**
   * Remove items older than retention period
   */
  private async cleanupExpired(): Promise<number> {
    const cutoff = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    
    for (const [id, trashed] of this.trashedItems) {
      if (trashed.deletedAt < cutoff) {
        await this.permanentlyDelete(id);
        removed++;
      }
    }
    
    return removed;
  }

  /**
   * Set retention period in days
   */
  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(1, days);
  }

  /**
   * Extract keywords from query for matching
   */
  private extractKeywords(query: string): string[] {
    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
      'about', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'under', 'again', 'further', 'then', 'once',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that',
      'these', 'those', 'what', 'which', 'who', 'whom', 'where', 'when',
      'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
      'so', 'than', 'too', 'very', 'just', 'also',
    ]);
    
    return query
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2 && !stopWords.has(term));
  }

  /**
   * Calculate a match score based on keyword presence
   */
  private calculateTermScore(text: string, terms: string[]): number {
    if (terms.length === 0) return 0;
    
    let matches = 0;
    for (const term of terms) {
      if (text.includes(term)) {
        matches++;
      }
    }
    
    return (matches / terms.length) * 60; // Max 60 for term matching
  }

  /**
   * Get a preview of text around a match
   */
  private getMatchPreview(content: string, searchTerm: string): string {
    const maxLength = 80;
    const lowerContent = content.toLowerCase();
    const index = lowerContent.indexOf(searchTerm.toLowerCase());
    
    if (index === -1) {
      return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
    }
    
    // Get context around the match
    const start = Math.max(0, index - 30);
    const end = Math.min(content.length, index + searchTerm.length + 50);
    
    let preview = content.substring(start, end);
    if (start > 0) preview = '...' + preview;
    if (end < content.length) preview = preview + '...';
    
    return preview.replace(/\n/g, ' ').trim();
  }
}

// Singleton instance
let trashBinManagerInstance: TrashBinManager | null = null;

export function getTrashBinManager(): TrashBinManager {
  if (!trashBinManagerInstance) {
    trashBinManagerInstance = new TrashBinManager();
  }
  return trashBinManagerInstance;
}

