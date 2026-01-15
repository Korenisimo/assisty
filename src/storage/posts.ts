import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { SavedPost, StorageData, HNStory, SkippedPost } from '../types.js';

// Store data in user's home directory for global access
const DATA_DIR = join(homedir(), '.hn-cli');
const STORAGE_FILE = join(DATA_DIR, 'saved-posts.json');

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function loadStorage(): Promise<StorageData> {
  await ensureDataDir();
  
  if (!existsSync(STORAGE_FILE)) {
    return { savedPosts: [], skippedPosts: [], lastUpdated: Date.now(), temperature: 0.7 };
  }
  
  const data = await readFile(STORAGE_FILE, 'utf-8');
  const parsed = JSON.parse(data);
  // Ensure backward compatibility
  return {
    savedPosts: parsed.savedPosts || [],
    skippedPosts: parsed.skippedPosts || [],
    lastUpdated: parsed.lastUpdated || Date.now(),
    temperature: parsed.temperature ?? 0.7,
  };
}

async function saveStorage(data: StorageData): Promise<void> {
  await ensureDataDir();
  data.lastUpdated = Date.now();
  await writeFile(STORAGE_FILE, JSON.stringify(data, null, 2));
}

export async function getSavedPosts(): Promise<SavedPost[]> {
  const storage = await loadStorage();
  return storage.savedPosts;
}

export async function savePost(story: HNStory): Promise<boolean> {
  const storage = await loadStorage();
  
  // Check if already saved
  if (storage.savedPosts.some(p => p.id === story.id)) {
    return false;
  }
  
  const savedPost: SavedPost = {
    id: story.id,
    title: story.title,
    url: story.url,
    by: story.by || 'unknown',
    score: story.score || 0,
    descendants: story.descendants,
    time: story.time,
    savedAt: Date.now()
  };
  
  storage.savedPosts.push(savedPost);
  await saveStorage(storage);
  return true;
}

export async function removePost(id: number): Promise<boolean> {
  const storage = await loadStorage();
  const initialLength = storage.savedPosts.length;
  storage.savedPosts = storage.savedPosts.filter(p => p.id !== id);
  
  if (storage.savedPosts.length < initialLength) {
    await saveStorage(storage);
    return true;
  }
  return false;
}

export async function updatePostEmbedding(id: number, embedding: number[]): Promise<void> {
  const storage = await loadStorage();
  const post = storage.savedPosts.find(p => p.id === id);
  if (post) {
    post.embedding = embedding;
    await saveStorage(storage);
  }
}

export async function getPostsWithEmbeddings(): Promise<SavedPost[]> {
  const posts = await getSavedPosts();
  return posts.filter(p => p.embedding && p.embedding.length > 0);
}

export async function getPostsWithoutEmbeddings(): Promise<SavedPost[]> {
  const posts = await getSavedPosts();
  return posts.filter(p => !p.embedding || p.embedding.length === 0);
}

export function isPostSaved(savedPosts: SavedPost[], id: number): boolean {
  return savedPosts.some(p => p.id === id);
}

export async function skipPost(id: number, days: number = 10): Promise<void> {
  const storage = await loadStorage();
  const skipUntil = Date.now() + (days * 24 * 60 * 60 * 1000);
  
  // Remove if already exists
  storage.skippedPosts = storage.skippedPosts.filter(p => p.id !== id);
  
  // Add new skip entry
  storage.skippedPosts.push({
    id,
    skippedAt: Date.now(),
    skipUntil,
  });
  
  await saveStorage(storage);
}

export async function getSkippedPostIds(): Promise<number[]> {
  const storage = await loadStorage();
  const now = Date.now();
  
  // Filter out expired skips
  const activeSkips = storage.skippedPosts.filter(skip => skip.skipUntil > now);
  
  // Clean up expired skips
  if (activeSkips.length !== storage.skippedPosts.length) {
    storage.skippedPosts = activeSkips;
    await saveStorage(storage);
  }
  
  return activeSkips.map(skip => skip.id);
}

export async function getTemperature(): Promise<number> {
  const storage = await loadStorage();
  return storage.temperature ?? 0.7;
}

export async function setTemperature(temp: number): Promise<void> {
  const storage = await loadStorage();
  storage.temperature = Math.max(0, Math.min(2, temp)); // Clamp between 0 and 2
  await saveStorage(storage);
}

