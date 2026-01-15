// Achievements tracking - "Collecting Receipts"
// Tracks accomplishments from JIRA, Confluence, GitHub, Google Docs, and manual entries

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ===== Types =====

export type AchievementSource = 
  | 'jira_ticket'
  | 'confluence_page'
  | 'google_doc'
  | 'github_pr'
  | 'github_commit'
  | 'task_completed'
  | 'manual'
  | 'conversation'
  | 'tech_document'
  | 'presentation'
  | 'incident_response'
  | 'code_review';

export type AchievementCategory =
  | 'delivery'         // Shipped features, completed tickets
  | 'documentation'    // Docs, runbooks, technical writing
  | 'collaboration'    // Reviews, pair programming, mentoring
  | 'leadership'       // Leading initiatives, decision making
  | 'technical'        // Deep technical work, architecture
  | 'incident'         // On-call, incident response
  | 'learning'         // Skills acquired, certifications
  | 'other';

export interface Achievement {
  id: string;
  title: string;
  description?: string;
  source: AchievementSource;
  category: AchievementCategory;
  
  // Evidence/Link
  url?: string;
  externalId?: string; // JIRA key, PR number, etc.
  
  // Dates
  date: string; // When the achievement happened (ISO date)
  createdAt: number;
  updatedAt: number;
  
  // Metrics (if applicable)
  impact?: string; // Description of impact
  metrics?: Record<string, string | number>; // e.g., { linesOfCode: 500, testsAdded: 20 }
  
  // Relations
  linkedGoalIds?: string[]; // PDP goals this supports
  tags?: string[];
  
  // For conversation-derived achievements
  conversationContext?: string;
}

export interface AchievementSyncConfig {
  jiraUsername?: string;       // For searching JIRA tickets
  jiraDisplayName?: string;    // Alternative name in JIRA
  confluenceUsername?: string; // For searching Confluence pages
  githubUsername?: string;     // For searching GitHub PRs
  googleEmail?: string;        // For searching Google Docs
  autoSyncEnabled?: boolean;
  lastJiraSyncAt?: number;
  lastConfluenceSyncAt?: number;
  lastGithubSyncAt?: number;
  lastGoogleDocsSyncAt?: number;
}

export interface AchievementStore {
  config: AchievementSyncConfig;
  achievements: Achievement[];
  lastUpdated: number;
}

// ===== Storage =====

function getAchievementStorePath(): string {
  return join(homedir(), '.hn-work-assistant', 'achievements.json');
}

async function ensureConfigDir(): Promise<void> {
  const configDir = join(homedir(), '.hn-work-assistant');
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

async function loadAchievementStore(): Promise<AchievementStore> {
  const storePath = getAchievementStorePath();
  
  if (!existsSync(storePath)) {
    return {
      config: {},
      achievements: [],
      lastUpdated: Date.now(),
    };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as AchievementStore;
  } catch {
    return {
      config: {},
      achievements: [],
      lastUpdated: Date.now(),
    };
  }
}

async function saveAchievementStore(store: AchievementStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getAchievementStorePath();
  store.lastUpdated = Date.now();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `ach_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ===== Configuration =====

/**
 * Set up achievement sync configuration
 */
export async function setAchievementConfig(config: Partial<AchievementSyncConfig>): Promise<AchievementSyncConfig> {
  const store = await loadAchievementStore();
  store.config = { ...store.config, ...config };
  await saveAchievementStore(store);
  return store.config;
}

/**
 * Get current achievement sync configuration
 */
export async function getAchievementConfig(): Promise<AchievementSyncConfig> {
  const store = await loadAchievementStore();
  return store.config;
}

// ===== Achievement CRUD =====

/**
 * Add a new achievement manually
 */
export async function addAchievement(
  title: string,
  options: {
    description?: string;
    source?: AchievementSource;
    category?: AchievementCategory;
    url?: string;
    externalId?: string;
    date?: string; // ISO date string
    impact?: string;
    metrics?: Record<string, string | number>;
    tags?: string[];
    linkedGoalIds?: string[];
    conversationContext?: string;
  } = {}
): Promise<Achievement> {
  const store = await loadAchievementStore();
  
  const achievement: Achievement = {
    id: generateId(),
    title,
    description: options.description,
    source: options.source || 'manual',
    category: options.category || 'other',
    url: options.url,
    externalId: options.externalId,
    date: options.date || new Date().toISOString().split('T')[0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    impact: options.impact,
    metrics: options.metrics,
    tags: options.tags,
    linkedGoalIds: options.linkedGoalIds,
    conversationContext: options.conversationContext,
  };
  
  store.achievements.push(achievement);
  await saveAchievementStore(store);
  
  return achievement;
}

/**
 * Add achievement from a completed task
 */
export async function addAchievementFromTask(
  taskId: string,
  taskContent: string,
  options: {
    category?: AchievementCategory;
    impact?: string;
    linkedGoalIds?: string[];
  } = {}
): Promise<Achievement> {
  return addAchievement(taskContent, {
    source: 'task_completed',
    category: options.category || 'delivery',
    externalId: taskId,
    impact: options.impact,
    linkedGoalIds: options.linkedGoalIds,
  });
}

/**
 * Add achievement from JIRA ticket
 */
export async function addAchievementFromJira(
  ticketKey: string,
  summary: string,
  options: {
    description?: string;
    completedDate?: string;
    category?: AchievementCategory;
    impact?: string;
    url?: string;
  } = {}
): Promise<Achievement> {
  // Check if already exists
  const store = await loadAchievementStore();
  const existing = store.achievements.find(
    a => a.source === 'jira_ticket' && a.externalId === ticketKey
  );
  
  if (existing) {
    // Update existing
    return updateAchievement(existing.id, {
      title: summary,
      description: options.description,
      date: options.completedDate,
      category: options.category,
      impact: options.impact,
    }) as Promise<Achievement>;
  }
  
  return addAchievement(summary, {
    source: 'jira_ticket',
    category: options.category || 'delivery',
    externalId: ticketKey,
    url: options.url,
    description: options.description,
    date: options.completedDate,
    impact: options.impact,
    tags: ['jira'],
  });
}

/**
 * Add achievement from Confluence page
 */
export async function addAchievementFromConfluence(
  pageId: string,
  title: string,
  options: {
    url?: string;
    space?: string;
    createdDate?: string;
    category?: AchievementCategory;
  } = {}
): Promise<Achievement> {
  // Check if already exists
  const store = await loadAchievementStore();
  const existing = store.achievements.find(
    a => a.source === 'confluence_page' && a.externalId === pageId
  );
  
  if (existing) {
    return existing;
  }
  
  return addAchievement(`Authored: ${title}`, {
    source: 'confluence_page',
    category: options.category || 'documentation',
    externalId: pageId,
    url: options.url,
    date: options.createdDate,
    tags: ['confluence', options.space || 'unknown-space'],
  });
}

/**
 * Add achievement from GitHub PR
 */
export async function addAchievementFromGitHubPR(
  prNumber: number,
  title: string,
  options: {
    repoUrl?: string;
    url?: string;
    mergedDate?: string;
    category?: AchievementCategory;
    linesAdded?: number;
    linesRemoved?: number;
  } = {}
): Promise<Achievement> {
  const externalId = options.repoUrl ? `${options.repoUrl}#${prNumber}` : `#${prNumber}`;
  
  // Check if already exists
  const store = await loadAchievementStore();
  const existing = store.achievements.find(
    a => a.source === 'github_pr' && a.externalId === externalId
  );
  
  if (existing) {
    return existing;
  }
  
  const metrics: Record<string, string | number> = {};
  if (options.linesAdded !== undefined) metrics.linesAdded = options.linesAdded;
  if (options.linesRemoved !== undefined) metrics.linesRemoved = options.linesRemoved;
  
  return addAchievement(`PR: ${title}`, {
    source: 'github_pr',
    category: options.category || 'delivery',
    externalId,
    url: options.url,
    date: options.mergedDate,
    metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
    tags: ['github', 'pull-request'],
  });
}

/**
 * Add achievement from Google Doc
 */
export async function addAchievementFromGoogleDoc(
  docId: string,
  title: string,
  options: {
    url?: string;
    createdDate?: string;
    category?: AchievementCategory;
  } = {}
): Promise<Achievement> {
  // Check if already exists
  const store = await loadAchievementStore();
  const existing = store.achievements.find(
    a => a.source === 'google_doc' && a.externalId === docId
  );
  
  if (existing) {
    return existing;
  }
  
  return addAchievement(`Document: ${title}`, {
    source: 'google_doc',
    category: options.category || 'documentation',
    externalId: docId,
    url: options.url,
    date: options.createdDate,
    tags: ['google-docs'],
  });
}

/**
 * Add a technical document link as an achievement
 */
export async function addTechDocAchievement(
  title: string,
  url: string,
  options: {
    description?: string;
    date?: string;
    category?: AchievementCategory;
    source?: AchievementSource;
  } = {}
): Promise<Achievement> {
  return addAchievement(title, {
    source: options.source || 'tech_document',
    category: options.category || 'documentation',
    url,
    description: options.description,
    date: options.date,
    tags: ['technical-document'],
  });
}

/**
 * Update an achievement
 */
export async function updateAchievement(
  achievementId: string,
  updates: Partial<Omit<Achievement, 'id' | 'createdAt'>>
): Promise<Achievement | null> {
  const store = await loadAchievementStore();
  
  const index = store.achievements.findIndex(a => a.id === achievementId);
  if (index === -1) {
    return null;
  }
  
  store.achievements[index] = {
    ...store.achievements[index],
    ...updates,
    updatedAt: Date.now(),
  };
  
  await saveAchievementStore(store);
  return store.achievements[index];
}

/**
 * Delete an achievement
 */
export async function deleteAchievement(achievementId: string): Promise<boolean> {
  const store = await loadAchievementStore();
  
  const initialLength = store.achievements.length;
  store.achievements = store.achievements.filter(a => a.id !== achievementId);
  
  if (store.achievements.length !== initialLength) {
    await saveAchievementStore(store);
    return true;
  }
  return false;
}

/**
 * Link an achievement to a PDP goal
 */
export async function linkAchievementToGoal(achievementId: string, goalId: string): Promise<boolean> {
  const store = await loadAchievementStore();
  
  const achievement = store.achievements.find(a => a.id === achievementId);
  if (!achievement) {
    return false;
  }
  
  if (!achievement.linkedGoalIds) {
    achievement.linkedGoalIds = [];
  }
  
  if (!achievement.linkedGoalIds.includes(goalId)) {
    achievement.linkedGoalIds.push(goalId);
    achievement.updatedAt = Date.now();
    await saveAchievementStore(store);
  }
  
  return true;
}

// ===== Query Functions =====

/**
 * Get achievements with optional filtering
 */
export async function getAchievements(filter?: {
  source?: AchievementSource | AchievementSource[];
  category?: AchievementCategory | AchievementCategory[];
  tags?: string[];
  dateFrom?: string; // ISO date
  dateTo?: string;   // ISO date
  linkedGoalId?: string;
  search?: string;   // Text search in title/description
}): Promise<Achievement[]> {
  const store = await loadAchievementStore();
  let achievements = store.achievements;
  
  if (filter) {
    if (filter.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      achievements = achievements.filter(a => sources.includes(a.source));
    }
    if (filter.category) {
      const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
      achievements = achievements.filter(a => categories.includes(a.category));
    }
    if (filter.tags?.length) {
      achievements = achievements.filter(a => 
        a.tags?.some(t => filter.tags!.includes(t))
      );
    }
    if (filter.dateFrom) {
      achievements = achievements.filter(a => a.date >= filter.dateFrom!);
    }
    if (filter.dateTo) {
      achievements = achievements.filter(a => a.date <= filter.dateTo!);
    }
    if (filter.linkedGoalId) {
      achievements = achievements.filter(a => 
        a.linkedGoalIds?.includes(filter.linkedGoalId!)
      );
    }
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      achievements = achievements.filter(a => 
        a.title.toLowerCase().includes(searchLower) ||
        a.description?.toLowerCase().includes(searchLower)
      );
    }
  }
  
  // Sort by date (most recent first)
  return achievements.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get achievements by time period
 */
export async function getAchievementsByPeriod(period: 'week' | 'month' | 'quarter' | 'year'): Promise<Achievement[]> {
  const now = new Date();
  let dateFrom: Date;
  
  switch (period) {
    case 'week':
      dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter':
      const quarter = Math.floor(now.getMonth() / 3);
      dateFrom = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    case 'year':
      dateFrom = new Date(now.getFullYear(), 0, 1);
      break;
  }
  
  return getAchievements({ dateFrom: dateFrom.toISOString().split('T')[0] });
}

/**
 * Get achievements linked to a specific PDP goal
 */
export async function getAchievementsForGoal(goalId: string): Promise<Achievement[]> {
  return getAchievements({ linkedGoalId: goalId });
}

/**
 * Check if an achievement already exists for an external ID
 */
export async function achievementExistsForExternalId(source: AchievementSource, externalId: string): Promise<boolean> {
  const store = await loadAchievementStore();
  return store.achievements.some(a => a.source === source && a.externalId === externalId);
}

// ===== Summary & Reporting =====

/**
 * Get a summary of achievements
 */
export async function getAchievementsSummary(period?: 'week' | 'month' | 'quarter' | 'year'): Promise<string> {
  const achievements = period 
    ? await getAchievementsByPeriod(period)
    : await getAchievements();
  
  if (achievements.length === 0) {
    return period 
      ? `No achievements recorded for this ${period}.`
      : 'No achievements recorded yet.';
  }
  
  const lines: string[] = [];
  const periodLabel = period ? ` (This ${period.charAt(0).toUpperCase() + period.slice(1)})` : '';
  
  lines.push(`## Achievements Summary${periodLabel}`);
  lines.push('');
  lines.push(`**Total:** ${achievements.length} achievements`);
  lines.push('');
  
  // Group by category
  const byCategory: Record<string, Achievement[]> = {};
  for (const ach of achievements) {
    if (!byCategory[ach.category]) {
      byCategory[ach.category] = [];
    }
    byCategory[ach.category].push(ach);
  }
  
  const categoryEmojis: Record<string, string> = {
    delivery: '🚀',
    documentation: '📝',
    collaboration: '🤝',
    leadership: '👑',
    technical: '⚙️',
    incident: '🚨',
    learning: '📚',
    other: '📌',
  };
  
  for (const [category, items] of Object.entries(byCategory)) {
    const emoji = categoryEmojis[category] || '📌';
    lines.push(`### ${emoji} ${category.charAt(0).toUpperCase() + category.slice(1)} (${items.length})`);
    
    for (const ach of items.slice(0, 10)) { // Show top 10 per category
      const date = ach.date;
      const link = ach.url ? ` [🔗](${ach.url})` : '';
      lines.push(`- ${date}: **${ach.title}**${link}`);
      if (ach.impact) {
        lines.push(`  - Impact: ${ach.impact}`);
      }
    }
    
    if (items.length > 10) {
      lines.push(`  - ... and ${items.length - 10} more`);
    }
    lines.push('');
  }
  
  // Source breakdown
  const bySource: Record<string, number> = {};
  for (const ach of achievements) {
    bySource[ach.source] = (bySource[ach.source] || 0) + 1;
  }
  
  lines.push('### Sources');
  for (const [source, count] of Object.entries(bySource)) {
    const label = source.replace(/_/g, ' ');
    lines.push(`- ${label}: ${count}`);
  }
  
  return lines.join('\n');
}

/**
 * Get achievements formatted for export or review
 */
export async function exportAchievements(options?: {
  period?: 'week' | 'month' | 'quarter' | 'year';
  format?: 'markdown' | 'json' | 'csv';
}): Promise<string> {
  const achievements = options?.period
    ? await getAchievementsByPeriod(options.period)
    : await getAchievements();
  
  const format = options?.format || 'markdown';
  
  if (format === 'json') {
    return JSON.stringify(achievements, null, 2);
  }
  
  if (format === 'csv') {
    const headers = ['Date', 'Title', 'Category', 'Source', 'URL', 'Impact'];
    const rows = achievements.map(a => [
      a.date,
      `"${a.title.replace(/"/g, '""')}"`,
      a.category,
      a.source,
      a.url || '',
      `"${(a.impact || '').replace(/"/g, '""')}"`,
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
  
  // Default: markdown
  return getAchievementsSummary(options?.period);
}

/**
 * Get achievements count by category
 */
export async function getAchievementStats(): Promise<{
  total: number;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
  byMonth: Record<string, number>;
}> {
  const achievements = await getAchievements();
  
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  
  for (const ach of achievements) {
    byCategory[ach.category] = (byCategory[ach.category] || 0) + 1;
    bySource[ach.source] = (bySource[ach.source] || 0) + 1;
    
    const month = ach.date.substring(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + 1;
  }
  
  return {
    total: achievements.length,
    byCategory,
    bySource,
    byMonth,
  };
}

/**
 * Get recent achievements for AI context
 */
export async function getRecentAchievementsForContext(limit: number = 10): Promise<string> {
  const achievements = await getAchievementsByPeriod('month');
  const recent = achievements.slice(0, limit);
  
  if (recent.length === 0) {
    return 'No recent achievements recorded.';
  }
  
  const lines = ['Recent achievements:'];
  for (const ach of recent) {
    lines.push(`- ${ach.date}: [${ach.category}] ${ach.title}`);
  }
  
  return lines.join('\n');
}



