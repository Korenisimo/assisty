import { HNItem, HNStory } from '../types.js';

const BASE_URL = 'https://hacker-news.firebaseio.com/v0';

export async function fetchItem(id: number): Promise<HNItem | null> {
  const response = await fetch(`${BASE_URL}/item/${id}.json`);
  if (!response.ok) return null;
  return response.json();
}

export async function fetchTopStories(): Promise<number[]> {
  const response = await fetch(`${BASE_URL}/topstories.json`);
  return response.json();
}

export async function fetchNewStories(): Promise<number[]> {
  const response = await fetch(`${BASE_URL}/newstories.json`);
  return response.json();
}

export async function fetchBestStories(): Promise<number[]> {
  const response = await fetch(`${BASE_URL}/beststories.json`);
  return response.json();
}

export async function fetchStoriesWithComments(
  storyIds: number[],
  limit: number = 30
): Promise<HNStory[]> {
  const stories: HNStory[] = [];
  
  // Fetch stories in batches for better performance
  const batchSize = 10;
  for (let i = 0; i < Math.min(storyIds.length, limit * 3); i += batchSize) {
    const batch = storyIds.slice(i, i + batchSize);
    const items = await Promise.all(batch.map(id => fetchItem(id)));
    
    for (const item of items) {
      if (item && item.type === 'story' && item.descendants && item.descendants > 0) {
        stories.push(item as HNStory);
      }
    }
    
    if (stories.length >= limit) break;
  }
  
  return stories.slice(0, limit);
}

export async function fetchTopCommentedStories(
  source: 'top' | 'new' | 'best',
  limit: number = 20
): Promise<HNStory[]> {
  let storyIds: number[];
  
  switch (source) {
    case 'top':
      storyIds = await fetchTopStories();
      break;
    case 'new':
      storyIds = await fetchNewStories();
      break;
    case 'best':
      storyIds = await fetchBestStories();
      break;
  }
  
  const stories = await fetchStoriesWithComments(storyIds, limit * 2);
  
  // Sort by comment count (descendants)
  stories.sort((a, b) => b.descendants - a.descendants);
  
  return stories.slice(0, limit);
}

export function getTimeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function getHNUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

