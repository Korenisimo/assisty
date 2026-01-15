export interface HNItem {
  id: number;
  type: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time: number;
  text?: string;
  dead?: boolean;
  parent?: number;
  poll?: number;
  kids?: number[];
  url?: string;
  score?: number;
  title?: string;
  parts?: number[];
  descendants?: number;
}

export interface HNStory extends HNItem {
  type: 'story';
  title: string;
  descendants: number;
}

export interface SavedPost {
  id: number;
  title: string;
  url?: string;
  by: string;
  score: number;
  descendants: number;
  time: number;
  savedAt: number;
  embedding?: number[];
}

export interface SkippedPost {
  id: number;
  skippedAt: number;
  skipUntil: number; // timestamp when it can be shown again
}

export interface StorageData {
  savedPosts: SavedPost[];
  skippedPosts: SkippedPost[];
  lastUpdated: number;
  temperature?: number; // LLM temperature setting
}

export interface DisplayPost {
  id: number;
  rank: number;
  title: string;
  url?: string;
  by: string;
  score: number;
  comments: number;
  time: number;
  timeAgo: string;
}

