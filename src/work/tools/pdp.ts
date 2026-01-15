// Personal Development Plan (PDP) tracking
// Stores the PDP locally and syncs with Google Docs

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { 
  getGoogleDoc, 
  getGoogleDocComments, 
  extractDocId,
  GoogleDoc,
  GoogleDocComment,
} from '../clients/googledocs.js';

// ===== Types =====

export interface PDPGoal {
  id: string;
  title: string;
  description?: string;
  category: 'technical' | 'leadership' | 'communication' | 'collaboration' | 'other';
  status: 'not_started' | 'in_progress' | 'completed' | 'paused';
  targetDate?: string;
  progress?: number; // 0-100
  notes?: string;
  linkedAchievements?: string[]; // IDs of linked achievements
  createdAt: number;
  updatedAt: number;
}

export interface PDPFeedback {
  id: string;
  source: 'google_doc_comment' | 'manager' | 'peer' | 'self';
  content: string;
  author?: string;
  goalId?: string; // Link to specific goal if applicable
  sentiment?: 'positive' | 'neutral' | 'constructive';
  createdAt: number;
  syncedFromCommentId?: string; // For Google Doc comments
}

export interface PDPConfig {
  googleDocUrl?: string;
  googleDocId?: string;
  lastSyncAt?: number;
  lastCommentSyncAt?: number;
  ownerName?: string; // Your name for attribution matching
  ownerEmail?: string;
  autoSyncEnabled?: boolean;
}

export interface PDPStore {
  config: PDPConfig;
  goals: PDPGoal[];
  feedback: PDPFeedback[];
  rawDocContent?: string; // Cached Google Doc content
  lastUpdated: number;
}

// ===== Storage =====

function getPDPStorePath(): string {
  return join(homedir(), '.hn-work-assistant', 'pdp.json');
}

async function ensureConfigDir(): Promise<void> {
  const configDir = join(homedir(), '.hn-work-assistant');
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

async function loadPDPStore(): Promise<PDPStore> {
  const storePath = getPDPStorePath();
  
  if (!existsSync(storePath)) {
    return {
      config: {},
      goals: [],
      feedback: [],
      lastUpdated: Date.now(),
    };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as PDPStore;
  } catch {
    return {
      config: {},
      goals: [],
      feedback: [],
      lastUpdated: Date.now(),
    };
  }
}

async function savePDPStore(store: PDPStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getPDPStorePath();
  store.lastUpdated = Date.now();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `pdp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ===== Configuration =====

/**
 * Set the Google Doc URL for the PDP
 */
export async function setPDPGoogleDoc(url: string, ownerName?: string, ownerEmail?: string): Promise<PDPConfig> {
  const store = await loadPDPStore();
  
  const docId = extractDocId(url);
  
  store.config = {
    ...store.config,
    googleDocUrl: url,
    googleDocId: docId,
    ownerName,
    ownerEmail,
  };
  
  await savePDPStore(store);
  return store.config;
}

/**
 * Get current PDP configuration
 */
export async function getPDPConfig(): Promise<PDPConfig> {
  const store = await loadPDPStore();
  return store.config;
}

/**
 * Update PDP owner info (for matching in JIRA/Confluence)
 */
export async function setPDPOwner(name: string, email?: string): Promise<void> {
  const store = await loadPDPStore();
  store.config.ownerName = name;
  store.config.ownerEmail = email;
  await savePDPStore(store);
}

// ===== Google Doc Sync =====

/**
 * Sync the PDP from Google Docs
 * Returns the document content and any new comments
 */
export async function syncPDPFromGoogleDoc(): Promise<{
  doc: GoogleDoc;
  newComments: GoogleDocComment[];
  hasChanges: boolean;
}> {
  const store = await loadPDPStore();
  
  if (!store.config.googleDocId) {
    throw new Error('No Google Doc configured for PDP. Use setPDPGoogleDoc first.');
  }
  
  // Fetch the document
  const doc = await getGoogleDoc(store.config.googleDocId);
  
  // Check if content changed
  const hasContentChanges = doc.content !== store.rawDocContent;
  
  // Update cached content
  store.rawDocContent = doc.content;
  store.config.lastSyncAt = Date.now();
  
  // Fetch comments
  const allComments = await getGoogleDocComments(store.config.googleDocId);
  
  // Find new comments (not yet synced)
  const syncedCommentIds = new Set(
    store.feedback
      .filter(f => f.syncedFromCommentId)
      .map(f => f.syncedFromCommentId)
  );
  
  const newComments = allComments.filter(c => !syncedCommentIds.has(c.id));
  
  // Convert new comments to feedback
  for (const comment of newComments) {
    const feedback: PDPFeedback = {
      id: generateId(),
      source: 'google_doc_comment',
      content: comment.content,
      author: comment.author,
      createdAt: new Date(comment.createdTime).getTime(),
      syncedFromCommentId: comment.id,
      sentiment: detectSentiment(comment.content),
    };
    
    store.feedback.push(feedback);
    
    // Also add replies as separate feedback
    for (const reply of comment.replies) {
      const replyFeedback: PDPFeedback = {
        id: generateId(),
        source: 'google_doc_comment',
        content: reply.content,
        author: reply.author,
        createdAt: new Date(reply.createdTime).getTime(),
        syncedFromCommentId: `${comment.id}:${reply.id}`,
        sentiment: detectSentiment(reply.content),
      };
      store.feedback.push(replyFeedback);
    }
  }
  
  store.config.lastCommentSyncAt = Date.now();
  await savePDPStore(store);
  
  return {
    doc,
    newComments,
    hasChanges: hasContentChanges || newComments.length > 0,
  };
}

/**
 * Get the cached PDP content (without fetching from Google)
 */
export async function getCachedPDPContent(): Promise<string | null> {
  const store = await loadPDPStore();
  return store.rawDocContent || null;
}

// ===== Goals Management =====

/**
 * Add a new PDP goal
 */
export async function addPDPGoal(
  title: string,
  options: {
    description?: string;
    category?: PDPGoal['category'];
    targetDate?: string;
    notes?: string;
  } = {}
): Promise<PDPGoal> {
  const store = await loadPDPStore();
  
  const goal: PDPGoal = {
    id: generateId(),
    title,
    description: options.description,
    category: options.category || 'other',
    status: 'not_started',
    targetDate: options.targetDate,
    notes: options.notes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  store.goals.push(goal);
  await savePDPStore(store);
  
  return goal;
}

/**
 * Update a PDP goal
 */
export async function updatePDPGoal(
  goalId: string,
  updates: Partial<Omit<PDPGoal, 'id' | 'createdAt'>>
): Promise<PDPGoal | null> {
  const store = await loadPDPStore();
  
  const goalIndex = store.goals.findIndex(g => g.id === goalId);
  if (goalIndex === -1) {
    return null;
  }
  
  store.goals[goalIndex] = {
    ...store.goals[goalIndex],
    ...updates,
    updatedAt: Date.now(),
  };
  
  await savePDPStore(store);
  return store.goals[goalIndex];
}

/**
 * Get all PDP goals
 */
export async function getPDPGoals(filter?: {
  status?: PDPGoal['status'] | PDPGoal['status'][];
  category?: PDPGoal['category'] | PDPGoal['category'][];
}): Promise<PDPGoal[]> {
  const store = await loadPDPStore();
  let goals = store.goals;
  
  if (filter) {
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      goals = goals.filter(g => statuses.includes(g.status));
    }
    if (filter.category) {
      const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
      goals = goals.filter(g => categories.includes(g.category));
    }
  }
  
  return goals;
}

/**
 * Link an achievement to a goal
 */
export async function linkAchievementToGoal(goalId: string, achievementId: string): Promise<boolean> {
  const store = await loadPDPStore();
  
  const goal = store.goals.find(g => g.id === goalId);
  if (!goal) {
    return false;
  }
  
  if (!goal.linkedAchievements) {
    goal.linkedAchievements = [];
  }
  
  if (!goal.linkedAchievements.includes(achievementId)) {
    goal.linkedAchievements.push(achievementId);
    goal.updatedAt = Date.now();
    await savePDPStore(store);
  }
  
  return true;
}

// ===== Feedback Management =====

/**
 * Add manual feedback (not from Google Doc sync)
 */
export async function addPDPFeedback(
  content: string,
  options: {
    source?: PDPFeedback['source'];
    author?: string;
    goalId?: string;
    sentiment?: PDPFeedback['sentiment'];
  } = {}
): Promise<PDPFeedback> {
  const store = await loadPDPStore();
  
  const feedback: PDPFeedback = {
    id: generateId(),
    source: options.source || 'self',
    content,
    author: options.author,
    goalId: options.goalId,
    sentiment: options.sentiment || detectSentiment(content),
    createdAt: Date.now(),
  };
  
  store.feedback.push(feedback);
  await savePDPStore(store);
  
  return feedback;
}

/**
 * Get all feedback
 */
export async function getPDPFeedback(filter?: {
  source?: PDPFeedback['source'];
  goalId?: string;
  since?: number; // Unix timestamp
}): Promise<PDPFeedback[]> {
  const store = await loadPDPStore();
  let feedback = store.feedback;
  
  if (filter) {
    if (filter.source) {
      feedback = feedback.filter(f => f.source === filter.source);
    }
    if (filter.goalId) {
      feedback = feedback.filter(f => f.goalId === filter.goalId);
    }
    if (filter.since) {
      const sinceTs = filter.since;
      feedback = feedback.filter(f => f.createdAt >= sinceTs);
    }
  }
  
  // Sort by most recent first
  return feedback.sort((a, b) => b.createdAt - a.createdAt);
}

// ===== Summary & Reporting =====

/**
 * Get a summary of the PDP status
 */
export async function getPDPSummary(): Promise<string> {
  const store = await loadPDPStore();
  const lines: string[] = [];
  
  lines.push('## Personal Development Plan Summary');
  lines.push('');
  
  // Config status
  if (store.config.googleDocUrl) {
    lines.push(`📄 **Linked Google Doc:** [PDP Document](${store.config.googleDocUrl})`);
    if (store.config.lastSyncAt) {
      const lastSync = new Date(store.config.lastSyncAt).toLocaleString();
      lines.push(`🔄 **Last synced:** ${lastSync}`);
    }
  } else {
    lines.push('⚠️ No Google Doc linked. Use `set_pdp_google_doc` to link your PDP.');
  }
  
  lines.push('');
  
  // Goals summary
  const goalsByStatus = {
    not_started: store.goals.filter(g => g.status === 'not_started'),
    in_progress: store.goals.filter(g => g.status === 'in_progress'),
    completed: store.goals.filter(g => g.status === 'completed'),
    paused: store.goals.filter(g => g.status === 'paused'),
  };
  
  lines.push('### Goals Overview');
  lines.push(`- 🎯 In Progress: ${goalsByStatus.in_progress.length}`);
  lines.push(`- ✅ Completed: ${goalsByStatus.completed.length}`);
  lines.push(`- 📋 Not Started: ${goalsByStatus.not_started.length}`);
  lines.push(`- ⏸️ Paused: ${goalsByStatus.paused.length}`);
  lines.push('');
  
  // Active goals
  if (goalsByStatus.in_progress.length > 0) {
    lines.push('### Active Goals');
    for (const goal of goalsByStatus.in_progress) {
      const progress = goal.progress ? ` (${goal.progress}%)` : '';
      const target = goal.targetDate ? ` - Target: ${goal.targetDate}` : '';
      lines.push(`- **${goal.title}**${progress}${target}`);
      if (goal.linkedAchievements?.length) {
        lines.push(`  - 🏆 ${goal.linkedAchievements.length} linked achievements`);
      }
    }
    lines.push('');
  }
  
  // Recent feedback
  const recentFeedback = store.feedback
    .filter(f => Date.now() - f.createdAt < 30 * 24 * 60 * 60 * 1000) // Last 30 days
    .slice(0, 5);
  
  if (recentFeedback.length > 0) {
    lines.push('### Recent Feedback');
    for (const fb of recentFeedback) {
      const date = new Date(fb.createdAt).toLocaleDateString();
      const source = fb.source === 'google_doc_comment' ? '💬' : fb.source === 'manager' ? '👔' : fb.source === 'peer' ? '👥' : '🪞';
      const preview = fb.content.length > 100 ? fb.content.substring(0, 100) + '...' : fb.content;
      lines.push(`- ${source} ${date}: "${preview}" ${fb.author ? `— ${fb.author}` : ''}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Get goals formatted for AI context
 */
export async function getPDPGoalsForContext(): Promise<string> {
  const goals = await getPDPGoals({ status: ['in_progress', 'not_started'] });
  
  if (goals.length === 0) {
    return 'No active PDP goals defined.';
  }
  
  const lines = ['Current PDP Goals:'];
  for (const goal of goals) {
    lines.push(`- [${goal.category}] ${goal.title} (${goal.status})${goal.description ? ': ' + goal.description : ''}`);
  }
  
  return lines.join('\n');
}

// ===== Helpers =====

/**
 * Simple sentiment detection based on keywords
 */
function detectSentiment(text: string): PDPFeedback['sentiment'] {
  const lowerText = text.toLowerCase();
  
  const positiveWords = ['great', 'excellent', 'good', 'well done', 'impressive', 'fantastic', 'amazing', 'love', 'perfect', 'awesome'];
  const constructiveWords = ['consider', 'suggest', 'could', 'might want', 'opportunity', 'improve', 'should', 'recommend', 'think about'];
  
  const hasPositive = positiveWords.some(w => lowerText.includes(w));
  const hasConstructive = constructiveWords.some(w => lowerText.includes(w));
  
  if (hasPositive && !hasConstructive) {
    return 'positive';
  }
  if (hasConstructive) {
    return 'constructive';
  }
  return 'neutral';
}

/**
 * Check if PDP is configured
 */
export async function isPDPConfigured(): Promise<boolean> {
  const store = await loadPDPStore();
  return !!store.config.googleDocId;
}

