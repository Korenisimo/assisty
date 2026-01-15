// Project knowledge storage
// Stores project-related context that agent can query on-demand
// Unlike infra/preferences, this is NOT always injected - agent retrieves when relevant

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

// Types of project knowledge
export type ProjectCategory = 
  | 'api'           // API endpoints, parameters, behaviors
  | 'design'        // Design docs, RFCs, architecture decisions
  | 'link'          // Useful URLs (JIRA epics, Confluence pages, repos)
  | 'context'       // Project-specific context (what it does, who owns it)
  | 'troubleshoot'  // Known issues, workarounds, debugging tips
  | 'integration';  // How projects integrate with each other

export interface ProjectKnowledge {
  id: string;
  projectName: string;      // e.g., "user-api", "billing-service", "identity-service"
  category: ProjectCategory;
  title: string;            // Short description (searchable)
  content: string;          // The actual knowledge
  tags: string[];           // Additional searchable tags
  links?: string[];         // Related URLs
  learnedFrom?: string;     // How we learned this
  createdAt: number;
  updatedAt: number;
}

interface ProjectStore {
  knowledge: ProjectKnowledge[];
}

// Get the project store path (uses platform-appropriate config directory)
function getProjectStorePath(): string {
  const configDir = ensurePlatformConfigDir();
  return join(configDir, 'project-knowledge.json');
}

// Ensure config directory exists (delegates to platform utils)
async function ensureConfigDir(): Promise<void> {
  ensurePlatformConfigDir();
}

// Load store
async function loadProjectStore(): Promise<ProjectStore> {
  const storePath = getProjectStorePath();
  
  if (!existsSync(storePath)) {
    return { knowledge: [] };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as ProjectStore;
  } catch {
    return { knowledge: [] };
  }
}

// Save store
async function saveProjectStore(store: ProjectStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getProjectStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

// Generate ID
function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ===== PUBLIC API =====

/**
 * Get all project knowledge
 */
export async function getAllProjectKnowledge(): Promise<ProjectKnowledge[]> {
  const store = await loadProjectStore();
  return store.knowledge;
}

/**
 * Get knowledge for a specific project
 */
export async function getProjectKnowledge(projectName: string): Promise<ProjectKnowledge[]> {
  const store = await loadProjectStore();
  const nameLower = projectName.toLowerCase();
  return store.knowledge.filter(k => 
    k.projectName.toLowerCase().includes(nameLower) ||
    k.tags.some(t => t.toLowerCase().includes(nameLower))
  );
}

/**
 * Search knowledge by query (searches title, content, tags, projectName)
 */
export async function searchProjectKnowledge(query: string): Promise<ProjectKnowledge[]> {
  const store = await loadProjectStore();
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  // Score-based search - items with more matches rank higher
  const scored = store.knowledge.map(k => {
    let score = 0;
    const searchableText = [
      k.projectName,
      k.title,
      k.content,
      ...k.tags,
    ].join(' ').toLowerCase();
    
    // Exact phrase match gets highest score
    if (searchableText.includes(queryLower)) {
      score += 10;
    }
    
    // Individual word matches
    for (const word of queryWords) {
      if (k.projectName.toLowerCase().includes(word)) score += 5;
      if (k.title.toLowerCase().includes(word)) score += 3;
      if (k.tags.some(t => t.toLowerCase().includes(word))) score += 3;
      if (k.content.toLowerCase().includes(word)) score += 1;
    }
    
    return { knowledge: k, score };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.knowledge);
}

/**
 * Get knowledge by category
 */
export async function getKnowledgeByCategory(category: ProjectCategory): Promise<ProjectKnowledge[]> {
  const store = await loadProjectStore();
  return store.knowledge.filter(k => k.category === category);
}

/**
 * Add new project knowledge
 */
export async function addProjectKnowledge(
  projectName: string,
  category: ProjectCategory,
  title: string,
  content: string,
  options?: {
    tags?: string[];
    links?: string[];
    learnedFrom?: string;
  }
): Promise<ProjectKnowledge> {
  const store = await loadProjectStore();
  
  // Check if similar entry exists (same project, category, and similar title)
  const existing = store.knowledge.find(k => 
    k.projectName.toLowerCase() === projectName.toLowerCase() &&
    k.category === category &&
    k.title.toLowerCase() === title.toLowerCase()
  );
  
  if (existing) {
    // Update existing
    existing.content = content;
    existing.tags = options?.tags || existing.tags;
    existing.links = options?.links || existing.links;
    existing.updatedAt = Date.now();
    await saveProjectStore(store);
    return existing;
  }
  
  const knowledge: ProjectKnowledge = {
    id: generateId(),
    projectName,
    category,
    title,
    content,
    tags: options?.tags || [],
    links: options?.links,
    learnedFrom: options?.learnedFrom || 'conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  store.knowledge.push(knowledge);
  await saveProjectStore(store);
  
  return knowledge;
}

/**
 * Update existing knowledge
 */
export async function updateProjectKnowledge(
  id: string,
  updates: Partial<Pick<ProjectKnowledge, 'content' | 'title' | 'tags' | 'links'>>
): Promise<ProjectKnowledge | null> {
  const store = await loadProjectStore();
  
  const knowledge = store.knowledge.find(k => k.id === id);
  if (!knowledge) return null;
  
  if (updates.content) knowledge.content = updates.content;
  if (updates.title) knowledge.title = updates.title;
  if (updates.tags !== undefined) knowledge.tags = updates.tags;
  if (updates.links !== undefined) knowledge.links = updates.links;
  knowledge.updatedAt = Date.now();
  
  await saveProjectStore(store);
  return knowledge;
}

/**
 * Delete knowledge
 */
export async function deleteProjectKnowledge(id: string): Promise<boolean> {
  const store = await loadProjectStore();
  
  const index = store.knowledge.findIndex(k => k.id === id);
  if (index === -1) return false;
  
  store.knowledge.splice(index, 1);
  await saveProjectStore(store);
  return true;
}

/**
 * List all known project names
 */
export async function listKnownProjects(): Promise<string[]> {
  const store = await loadProjectStore();
  const projects = new Set(store.knowledge.map(k => k.projectName));
  return Array.from(projects).sort();
}

/**
 * Get formatted knowledge for a specific query/context
 * This is used when agent wants to inject relevant project knowledge
 */
export async function getRelevantProjectKnowledge(query: string, maxItems = 5): Promise<string> {
  const results = await searchProjectKnowledge(query);
  
  if (results.length === 0) {
    return '';
  }
  
  const items = results.slice(0, maxItems);
  const lines: string[] = [];
  
  for (const item of items) {
    lines.push(`**${item.projectName}** - ${item.title} [${item.category}]`);
    lines.push(item.content);
    if (item.links?.length) {
      lines.push(`Links: ${item.links.join(', ')}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}


