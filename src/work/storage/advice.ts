// Advice Storage - Manages watched channels, scan state, and advice topics
// Used by the background Slack scanner to provide proactive recommendations

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

// Storage paths (using platform-appropriate config directory)
function getConfigDir(): string {
  return ensurePlatformConfigDir();
}

function getAdviceConfigFile(): string {
  return join(getConfigDir(), 'advice-config.json');
}

function getAdviceTopicsFile(): string {
  return join(getConfigDir(), 'advice-topics.json');
}

// Ensure config directory exists (delegates to platform utils)
function ensureConfigDir(): void {
  ensurePlatformConfigDir();
}

// Types

export interface WatchedChannel {
  name: string;
  id?: string;  // Slack channel ID if known
  lastScannedAt?: string;  // ISO timestamp
  lastMessageTimestamp?: string;  // Timestamp of last seen message
  enabled: boolean;
  isVip?: boolean;  // VIP channels get deeper investigation and can trigger auto-responses
}

export interface AdviceConfig {
  watchedChannels: WatchedChannel[];
  scanIntervalMinutes: number;  // How often to scan (default: 15)
  maxMessagesPerChannel: number;  // Max messages to analyze per scan (default: 20)
  enabled: boolean;  // Master switch for advice feature
  lastFullScan?: string;  // ISO timestamp of last complete scan
}

export interface AdviceTopic {
  id: string;
  title: string;  // Short title for the topic
  summary: string;  // Brief summary of what this is about
  relevanceReason: string;  // Why this is relevant to the user
  sourceChannel: string;  // Which channel this came from
  sourceMessages: Array<{
    author: string;
    timestamp: string;
    content: string;
    threadUrl?: string;
  }>;
  references?: Array<{  // External links investigated (from VIP analysis)
    url: string;
    title?: string;
    summary?: string;
    relevance?: string;
  }>;
  createdAt: string;  // ISO timestamp
  readAt?: string;  // ISO timestamp when user viewed it
  dismissed: boolean;  // User dismissed this advice
  priority: 'low' | 'medium' | 'high';  // How relevant/urgent
  tags: string[];  // Related tags (e.g., "incident", "announcement", "discussion")
  relatedTaskIds?: string[];  // If this relates to user's tasks
  relatedGoalIds?: string[];  // If this relates to PDP goals
}

export interface AdviceTopicsStore {
  topics: AdviceTopic[];
  version: number;
}

// Default config
const DEFAULT_CONFIG: AdviceConfig = {
  watchedChannels: [],
  scanIntervalMinutes: 15,
  maxMessagesPerChannel: 20,
  enabled: false,
};

// Config operations

export function loadAdviceConfig(): AdviceConfig {
  try {
    const configFile = getAdviceConfigFile();
    if (!existsSync(configFile)) {
      return { ...DEFAULT_CONFIG };
    }
    const data = readFileSync(configFile, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAdviceConfig(config: AdviceConfig): void {
  ensureConfigDir();
  writeFileSync(getAdviceConfigFile(), JSON.stringify(config, null, 2));
}

export function addWatchedChannel(channelName: string, channelId?: string): AdviceConfig {
  const config = loadAdviceConfig();
  
  // Check if already watching
  const existing = config.watchedChannels.find(
    ch => ch.name.toLowerCase() === channelName.toLowerCase()
  );
  
  if (existing) {
    existing.enabled = true;
    if (channelId) existing.id = channelId;
  } else {
    config.watchedChannels.push({
      name: channelName,
      id: channelId,
      enabled: true,
    });
  }
  
  saveAdviceConfig(config);
  return config;
}

export function removeWatchedChannel(channelName: string): AdviceConfig {
  const config = loadAdviceConfig();
  config.watchedChannels = config.watchedChannels.filter(
    ch => ch.name.toLowerCase() !== channelName.toLowerCase()
  );
  saveAdviceConfig(config);
  return config;
}

export function toggleWatchedChannel(channelName: string, enabled: boolean): AdviceConfig {
  const config = loadAdviceConfig();
  const channel = config.watchedChannels.find(
    ch => ch.name.toLowerCase() === channelName.toLowerCase()
  );
  if (channel) {
    channel.enabled = enabled;
    saveAdviceConfig(config);
  }
  return config;
}

export function updateChannelScanTimestamp(channelName: string, timestamp: string, lastMessageTs?: string): void {
  const config = loadAdviceConfig();
  const channel = config.watchedChannels.find(
    ch => ch.name.toLowerCase() === channelName.toLowerCase()
  );
  if (channel) {
    channel.lastScannedAt = timestamp;
    if (lastMessageTs) {
      channel.lastMessageTimestamp = lastMessageTs;
    }
    saveAdviceConfig(config);
  }
}

export function setAdviceEnabled(enabled: boolean): AdviceConfig {
  const config = loadAdviceConfig();
  config.enabled = enabled;
  saveAdviceConfig(config);
  return config;
}

export function setScanInterval(minutes: number): AdviceConfig {
  const config = loadAdviceConfig();
  config.scanIntervalMinutes = Math.max(5, Math.min(60, minutes));  // Clamp 5-60 min
  saveAdviceConfig(config);
  return config;
}

// Topics operations

export function loadAdviceTopics(): AdviceTopic[] {
  try {
    const topicsFile = getAdviceTopicsFile();
    if (!existsSync(topicsFile)) {
      return [];
    }
    const data = readFileSync(topicsFile, 'utf-8');
    const store: AdviceTopicsStore = JSON.parse(data);
    return store.topics || [];
  } catch {
    return [];
  }
}

export function saveAdviceTopics(topics: AdviceTopic[]): void {
  ensureConfigDir();
  const store: AdviceTopicsStore = {
    topics,
    version: 1,
  };
  writeFileSync(getAdviceTopicsFile(), JSON.stringify(store, null, 2));
}

export function addAdviceTopic(topic: Omit<AdviceTopic, 'id' | 'createdAt' | 'dismissed'>): AdviceTopic {
  const topics = loadAdviceTopics();
  
  const newTopic: AdviceTopic = {
    ...topic,
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    createdAt: new Date().toISOString(),
    dismissed: false,
  };
  
  topics.unshift(newTopic);  // Add to front (newest first)
  
  // Keep only last 100 topics
  if (topics.length > 100) {
    topics.splice(100);
  }
  
  saveAdviceTopics(topics);
  return newTopic;
}

export function markTopicRead(topicId: string): void {
  const topics = loadAdviceTopics();
  const topic = topics.find(t => t.id === topicId);
  if (topic) {
    topic.readAt = new Date().toISOString();
    saveAdviceTopics(topics);
  }
}

export function dismissTopic(topicId: string): void {
  const topics = loadAdviceTopics();
  const topic = topics.find(t => t.id === topicId);
  if (topic) {
    topic.dismissed = true;
    saveAdviceTopics(topics);
  }
}

export function getUnreadTopics(): AdviceTopic[] {
  const topics = loadAdviceTopics();
  return topics.filter(t => !t.readAt && !t.dismissed);
}

export function getActiveTopics(): AdviceTopic[] {
  const topics = loadAdviceTopics();
  return topics.filter(t => !t.dismissed);
}

export function clearDismissedTopics(): void {
  const topics = loadAdviceTopics();
  const active = topics.filter(t => !t.dismissed);
  saveAdviceTopics(active);
}

export function getTopicById(topicId: string): AdviceTopic | undefined {
  const topics = loadAdviceTopics();
  return topics.find(t => t.id === topicId);
}

export function setChannelVip(channelName: string, isVip: boolean): AdviceConfig {
  const config = loadAdviceConfig();
  const channel = config.watchedChannels.find(
    ch => ch.name.toLowerCase() === channelName.toLowerCase()
  );
  if (channel) {
    channel.isVip = isVip;
    saveAdviceConfig(config);
  }
  return config;
}

export function getVipChannels(): WatchedChannel[] {
  const config = loadAdviceConfig();
  return config.watchedChannels.filter(ch => ch.isVip && ch.enabled);
}

/**
 * Format advice configuration for inclusion in system prompt
 * Shows the assistant what channels are being monitored
 */
export function getAdviceConfigForPrompt(): string | null {
  const config = loadAdviceConfig();
  
  if (!config.enabled || config.watchedChannels.length === 0) {
    return null;
  }
  
  const enabledChannels = config.watchedChannels.filter(ch => ch.enabled);
  if (enabledChannels.length === 0) {
    return null;
  }
  
  const vipChannels = enabledChannels.filter(ch => ch.isVip);
  const regularChannels = enabledChannels.filter(ch => !ch.isVip);
  
  let section = '\n=== ADVICE MONITORING CONFIGURATION ===\n\n';
  section += 'Background monitoring is ENABLED. You are watching the following Slack channels:\n\n';
  
  if (vipChannels.length > 0) {
    section += '**VIP Channels** (deep investigation + auto-response capability):\n';
    for (const ch of vipChannels) {
      section += `- ${ch.name}`;
      if (ch.lastScannedAt) {
        const date = new Date(ch.lastScannedAt);
        section += ` (last scanned: ${date.toLocaleString()})`;
      }
      section += '\n';
    }
    section += '\n';
  }
  
  if (regularChannels.length > 0) {
    section += '**Regular Channels** (monitoring only):\n';
    for (const ch of regularChannels) {
      section += `- ${ch.name}`;
      if (ch.lastScannedAt) {
        const date = new Date(ch.lastScannedAt);
        section += ` (last scanned: ${date.toLocaleString()})`;
      }
      section += '\n';
    }
    section += '\n';
  }
  
  section += `Scan interval: ${config.scanIntervalMinutes} minutes\n`;
  
  if (config.lastFullScan) {
    const lastScan = new Date(config.lastFullScan);
    section += `Last full scan: ${lastScan.toLocaleString()}\n`;
  }
  
  // Add unread topics count
  const topics = loadAdviceTopics();
  const unreadCount = topics.filter(t => !t.readAt && !t.dismissed).length;
  if (unreadCount > 0) {
    section += `\n**You have ${unreadCount} unread advice topic${unreadCount > 1 ? 's' : ''} from recent scans.**\n`;
  }
  
  section += '\nWhen user asks "scan slack", "check interesting channels", or similar, use advice_monitoring_scan.\n';
  
  return section;
}

