// Memory system for Work Mode assistant
// Stores user preferences with approval workflow

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

export interface Memory {
  id: string;
  content: string;
  category: 'preference' | 'behavior' | 'context' | 'workflow';
  createdAt: number;
  source?: string; // What triggered this memory (e.g., "user correction", "explicit request")
}

export interface PendingMemory {
  id: string;
  content: string;
  category: Memory['category'];
  reason: string; // Why the assistant wants to remember this
  proposedAt: number;
}

interface MemoryStore {
  memories: Memory[];
  pending: PendingMemory[];
}

// Get the memory store path (uses platform-appropriate config directory)
function getMemoryStorePath(): string {
  const configDir = ensurePlatformConfigDir();
  return join(configDir, 'memories.json');
}

// Ensure config directory exists (delegates to platform utils)
async function ensureConfigDir(): Promise<void> {
  ensurePlatformConfigDir();
}

// Load memory store
async function loadMemoryStore(): Promise<MemoryStore> {
  const storePath = getMemoryStorePath();
  
  if (!existsSync(storePath)) {
    return { memories: [], pending: [] };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as MemoryStore;
  } catch {
    return { memories: [], pending: [] };
  }
}

// Save memory store
async function saveMemoryStore(store: MemoryStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getMemoryStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

// Generate a simple ID
function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ===== PUBLIC API =====

/**
 * Get all approved memories
 */
export async function getMemories(): Promise<Memory[]> {
  const store = await loadMemoryStore();
  return store.memories;
}

/**
 * Get memories formatted for system prompt
 */
export async function getMemoriesForPrompt(): Promise<string> {
  const memories = await getMemories();
  
  if (memories.length === 0) {
    return '';
  }
  
  const grouped: Record<string, Memory[]> = {};
  for (const mem of memories) {
    if (!grouped[mem.category]) {
      grouped[mem.category] = [];
    }
    grouped[mem.category].push(mem);
  }
  
  const lines = ['=== USER PREFERENCES (from memory) ==='];
  
  if (grouped.preference?.length) {
    lines.push('\nFormatting & Style:');
    for (const mem of grouped.preference) {
      lines.push(`- ${mem.content}`);
    }
  }
  
  if (grouped.behavior?.length) {
    lines.push('\nBehavior:');
    for (const mem of grouped.behavior) {
      lines.push(`- ${mem.content}`);
    }
  }
  
  if (grouped.workflow?.length) {
    lines.push('\nWorkflow:');
    for (const mem of grouped.workflow) {
      lines.push(`- ${mem.content}`);
    }
  }
  
  if (grouped.context?.length) {
    lines.push('\nContext:');
    for (const mem of grouped.context) {
      lines.push(`- ${mem.content}`);
    }
  }
  
  lines.push('\nRespect these preferences in all responses.');
  
  return lines.join('\n');
}

/**
 * Propose a new memory (requires user approval)
 */
export async function proposeMemory(
  content: string,
  category: Memory['category'],
  reason: string
): Promise<PendingMemory> {
  const store = await loadMemoryStore();
  
  const pending: PendingMemory = {
    id: generateId(),
    content,
    category,
    reason,
    proposedAt: Date.now(),
  };
  
  store.pending.push(pending);
  await saveMemoryStore(store);
  
  return pending;
}

/**
 * Get all pending memories awaiting approval
 */
export async function getPendingMemories(): Promise<PendingMemory[]> {
  const store = await loadMemoryStore();
  return store.pending;
}

/**
 * Approve a pending memory
 */
export async function approveMemory(pendingId: string): Promise<Memory | null> {
  const store = await loadMemoryStore();
  
  const pendingIndex = store.pending.findIndex(p => p.id === pendingId);
  if (pendingIndex === -1) {
    return null;
  }
  
  const pending = store.pending[pendingIndex];
  
  // Convert to approved memory
  const memory: Memory = {
    id: pending.id,
    content: pending.content,
    category: pending.category,
    createdAt: Date.now(),
    source: pending.reason,
  };
  
  // Remove from pending, add to memories
  store.pending.splice(pendingIndex, 1);
  store.memories.push(memory);
  await saveMemoryStore(store);
  
  return memory;
}

/**
 * Reject a pending memory
 */
export async function rejectMemory(pendingId: string): Promise<boolean> {
  const store = await loadMemoryStore();
  
  const pendingIndex = store.pending.findIndex(p => p.id === pendingId);
  if (pendingIndex === -1) {
    return false;
  }
  
  store.pending.splice(pendingIndex, 1);
  await saveMemoryStore(store);
  
  return true;
}

/**
 * Delete an approved memory
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  const store = await loadMemoryStore();
  
  const memoryIndex = store.memories.findIndex(m => m.id === memoryId);
  if (memoryIndex === -1) {
    return false;
  }
  
  store.memories.splice(memoryIndex, 1);
  await saveMemoryStore(store);
  
  return true;
}

/**
 * Add a memory directly (for explicit user requests like "remember that I prefer...")
 */
export async function addMemoryDirectly(
  content: string,
  category: Memory['category'],
  source: string = 'user request'
): Promise<Memory> {
  const store = await loadMemoryStore();
  
  const memory: Memory = {
    id: generateId(),
    content,
    category,
    createdAt: Date.now(),
    source,
  };
  
  store.memories.push(memory);
  await saveMemoryStore(store);
  
  return memory;
}

/**
 * Check if a similar memory already exists
 */
export async function hasSimirarMemory(content: string): Promise<boolean> {
  const memories = await getMemories();
  const contentLower = content.toLowerCase();
  
  return memories.some(m => 
    m.content.toLowerCase().includes(contentLower) ||
    contentLower.includes(m.content.toLowerCase())
  );
}

/**
 * Clear all memories (for testing/reset)
 */
export async function clearAllMemories(): Promise<void> {
  await saveMemoryStore({ memories: [], pending: [] });
}

