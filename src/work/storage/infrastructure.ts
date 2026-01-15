// Infrastructure knowledge storage
// Separate from general memory - stores k8s, database, and DevOps commands/info

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

// Types of infrastructure knowledge
export type InfraCategory = 
  | 'database'      // DB connection strings, names, users
  | 'kubernetes'    // Namespaces, pod patterns, port mappings
  | 'command'       // Useful commands the user teaches
  | 'service'       // Service info (ports, hosts, etc.)
  | 'environment'   // Environment names, clusters
  | 'credential';   // User names, roles (not passwords!)

export interface InfraKnowledge {
  id: string;
  category: InfraCategory;
  key: string;          // What this knowledge is about (e.g., "app-dev-db")
  content: string;      // The actual knowledge/command
  context?: string;     // When to use this
  examples?: string[];  // Example usages
  learnedFrom?: string; // How we learned this (user taught, discovered, etc.)
  createdAt: number;
  updatedAt: number;
}

export interface InfraSession {
  id: string;
  type: 'database' | 'kubernetes' | 'port-forward';
  startedAt: number;
  terminalId?: string;  // To track which terminal window
  details: {
    database?: string;
    port?: number;
    pod?: string;
    namespace?: string;
    environment?: string;
  };
}

interface InfraStore {
  knowledge: InfraKnowledge[];
  activeSessions: InfraSession[];
}

// Get the infra store path (uses platform-appropriate config directory)
function getInfraStorePath(): string {
  const configDir = ensurePlatformConfigDir();
  return join(configDir, 'infrastructure.json');
}

// Ensure config directory exists (delegates to platform utils)
async function ensureConfigDir(): Promise<void> {
  ensurePlatformConfigDir();
}

// Load store
async function loadInfraStore(): Promise<InfraStore> {
  const storePath = getInfraStorePath();
  
  if (!existsSync(storePath)) {
    return { knowledge: [], activeSessions: [] };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as InfraStore;
  } catch {
    return { knowledge: [], activeSessions: [] };
  }
}

// Save store
async function saveInfraStore(store: InfraStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getInfraStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

// Generate ID
function generateId(): string {
  return `infra_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ===== PUBLIC API =====

/**
 * Get all infrastructure knowledge
 */
export async function getInfraKnowledge(): Promise<InfraKnowledge[]> {
  const store = await loadInfraStore();
  return store.knowledge;
}

/**
 * Get knowledge by category
 */
export async function getKnowledgeByCategory(category: InfraCategory): Promise<InfraKnowledge[]> {
  const store = await loadInfraStore();
  return store.knowledge.filter(k => k.category === category);
}

/**
 * Search knowledge by key or content
 */
export async function searchKnowledge(query: string): Promise<InfraKnowledge[]> {
  const store = await loadInfraStore();
  const queryLower = query.toLowerCase();
  
  return store.knowledge.filter(k => 
    k.key.toLowerCase().includes(queryLower) ||
    k.content.toLowerCase().includes(queryLower) ||
    k.context?.toLowerCase().includes(queryLower) ||
    k.examples?.some(e => e.toLowerCase().includes(queryLower))
  );
}

/**
 * Get knowledge by key (exact match)
 */
export async function getKnowledgeByKey(key: string): Promise<InfraKnowledge | null> {
  const store = await loadInfraStore();
  return store.knowledge.find(k => k.key.toLowerCase() === key.toLowerCase()) || null;
}

/**
 * Add new infrastructure knowledge
 */
export async function addKnowledge(
  category: InfraCategory,
  key: string,
  content: string,
  options?: {
    context?: string;
    examples?: string[];
    learnedFrom?: string;
  }
): Promise<InfraKnowledge> {
  const store = await loadInfraStore();
  
  // Check if key already exists
  const existing = store.knowledge.find(k => k.key.toLowerCase() === key.toLowerCase());
  if (existing) {
    // Update existing
    existing.content = content;
    existing.context = options?.context || existing.context;
    existing.examples = options?.examples || existing.examples;
    existing.updatedAt = Date.now();
    await saveInfraStore(store);
    return existing;
  }
  
  const knowledge: InfraKnowledge = {
    id: generateId(),
    category,
    key,
    content,
    context: options?.context,
    examples: options?.examples,
    learnedFrom: options?.learnedFrom || 'user taught',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  store.knowledge.push(knowledge);
  await saveInfraStore(store);
  
  return knowledge;
}

/**
 * Update existing knowledge
 */
export async function updateKnowledge(
  id: string,
  updates: Partial<Pick<InfraKnowledge, 'content' | 'context' | 'examples'>>
): Promise<InfraKnowledge | null> {
  const store = await loadInfraStore();
  
  const knowledge = store.knowledge.find(k => k.id === id);
  if (!knowledge) return null;
  
  if (updates.content) knowledge.content = updates.content;
  if (updates.context !== undefined) knowledge.context = updates.context;
  if (updates.examples !== undefined) knowledge.examples = updates.examples;
  knowledge.updatedAt = Date.now();
  
  await saveInfraStore(store);
  return knowledge;
}

/**
 * Delete knowledge
 */
export async function deleteKnowledge(id: string): Promise<boolean> {
  const store = await loadInfraStore();
  
  const index = store.knowledge.findIndex(k => k.id === id);
  if (index === -1) return false;
  
  store.knowledge.splice(index, 1);
  await saveInfraStore(store);
  return true;
}

/**
 * Get formatted knowledge for assistant context
 */
export async function getKnowledgeForPrompt(): Promise<string> {
  const knowledge = await getInfraKnowledge();
  
  if (knowledge.length === 0) {
    return '';
  }
  
  const grouped: Record<string, InfraKnowledge[]> = {};
  for (const k of knowledge) {
    if (!grouped[k.category]) {
      grouped[k.category] = [];
    }
    grouped[k.category].push(k);
  }
  
  const lines = ['=== INFRASTRUCTURE KNOWLEDGE ==='];
  
  const categoryLabels: Record<InfraCategory, string> = {
    database: 'Databases',
    kubernetes: 'Kubernetes',
    command: 'Commands',
    service: 'Services',
    environment: 'Environments',
    credential: 'Credentials/Users',
  };
  
  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`\n${categoryLabels[category as InfraCategory]}:`);
    for (const item of items) {
      lines.push(`- ${item.key}: ${item.content}`);
      if (item.context) {
        lines.push(`  Context: ${item.context}`);
      }
      if (item.examples?.length) {
        lines.push(`  Examples: ${item.examples.slice(0, 2).join(', ')}`);
      }
    }
  }
  
  return lines.join('\n');
}

// ===== SESSION TRACKING =====

/**
 * Track an active infrastructure session (DB proxy, port-forward, etc.)
 */
export async function startInfraSession(
  type: InfraSession['type'],
  details: InfraSession['details'],
  terminalId?: string
): Promise<InfraSession> {
  const store = await loadInfraStore();
  
  const session: InfraSession = {
    id: generateId(),
    type,
    startedAt: Date.now(),
    terminalId,
    details,
  };
  
  store.activeSessions.push(session);
  await saveInfraStore(store);
  
  return session;
}

/**
 * Get active sessions
 */
export async function getActiveSessions(): Promise<InfraSession[]> {
  const store = await loadInfraStore();
  return store.activeSessions;
}

/**
 * End a session
 */
export async function endInfraSession(sessionId: string): Promise<boolean> {
  const store = await loadInfraStore();
  
  const index = store.activeSessions.findIndex(s => s.id === sessionId);
  if (index === -1) return false;
  
  store.activeSessions.splice(index, 1);
  await saveInfraStore(store);
  return true;
}

/**
 * Clear stale sessions (older than 24 hours)
 */
export async function clearStaleSessions(): Promise<number> {
  const store = await loadInfraStore();
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  
  const originalLength = store.activeSessions.length;
  store.activeSessions = store.activeSessions.filter(s => s.startedAt > dayAgo);
  
  const removed = originalLength - store.activeSessions.length;
  if (removed > 0) {
    await saveInfraStore(store);
  }
  
  return removed;
}


