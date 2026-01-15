// Character storage for Work Mode assistant
// Stores custom characters that can be used as personas

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

export interface CustomCharacter {
  id: string;
  name: string; // e.g., "Hermione Granger"
  description: string; // Full personality description for the system prompt
  source: string; // e.g., "Harry Potter series"
  createdAt: number;
  createdBy: 'user' | 'assistant';
  traits?: string[]; // Optional quick traits list
}

interface CharacterStore {
  characters: CustomCharacter[];
}

// Get the character store path (uses platform-appropriate config directory)
function getCharacterStorePath(): string {
  const configDir = ensurePlatformConfigDir();
  return join(configDir, 'characters.json');
}

// Ensure config directory exists (delegates to platform utils)
async function ensureConfigDir(): Promise<void> {
  ensurePlatformConfigDir();
}

// Load character store
async function loadCharacterStore(): Promise<CharacterStore> {
  const storePath = getCharacterStorePath();
  
  if (!existsSync(storePath)) {
    return { characters: [] };
  }
  
  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as CharacterStore;
  } catch {
    return { characters: [] };
  }
}

// Save character store
async function saveCharacterStore(store: CharacterStore): Promise<void> {
  await ensureConfigDir();
  const storePath = getCharacterStorePath();
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

// Generate a simple ID from name
function generateCharacterId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `char_${slug}_${Date.now().toString(36)}`;
}

// ===== PUBLIC API =====

/**
 * Get all custom characters
 */
export async function getCustomCharacters(): Promise<CustomCharacter[]> {
  const store = await loadCharacterStore();
  return store.characters;
}

/**
 * Get a specific character by ID
 */
export async function getCharacterById(id: string): Promise<CustomCharacter | null> {
  const characters = await getCustomCharacters();
  return characters.find(c => c.id === id) || null;
}

/**
 * Get a character by name (case-insensitive)
 */
export async function getCharacterByName(name: string): Promise<CustomCharacter | null> {
  const characters = await getCustomCharacters();
  const nameLower = name.toLowerCase();
  return characters.find(c => c.name.toLowerCase() === nameLower) || null;
}

/**
 * Save a new character
 */
export async function saveCharacter(
  name: string,
  description: string,
  source: string,
  createdBy: 'user' | 'assistant' = 'assistant',
  traits?: string[]
): Promise<CustomCharacter> {
  const store = await loadCharacterStore();
  
  // Check if character already exists
  const existing = store.characters.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    throw new Error(`Character "${name}" already exists`);
  }
  
  const character: CustomCharacter = {
    id: generateCharacterId(name),
    name,
    description,
    source,
    createdAt: Date.now(),
    createdBy,
    traits,
  };
  
  store.characters.push(character);
  await saveCharacterStore(store);
  
  return character;
}

/**
 * Update an existing character
 */
export async function updateCharacter(
  id: string,
  updates: Partial<Pick<CustomCharacter, 'description' | 'traits' | 'source'>>
): Promise<CustomCharacter | null> {
  const store = await loadCharacterStore();
  
  const character = store.characters.find(c => c.id === id);
  if (!character) {
    return null;
  }
  
  Object.assign(character, updates);
  await saveCharacterStore(store);
  
  return character;
}

/**
 * Delete a character
 */
export async function deleteCharacter(id: string): Promise<boolean> {
  const store = await loadCharacterStore();
  
  const index = store.characters.findIndex(c => c.id === id);
  if (index === -1) {
    return false;
  }
  
  store.characters.splice(index, 1);
  await saveCharacterStore(store);
  
  return true;
}

/**
 * Check if a character exists by name
 */
export async function characterExists(name: string): Promise<boolean> {
  const character = await getCharacterByName(name);
  return character !== null;
}


