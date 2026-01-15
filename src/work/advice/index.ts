// Advice Module - Proactive Slack monitoring and recommendations
// 
// This module provides:
// - Storage for watched channels and advice topics
// - Scanner for detecting new messages
// - AI-powered generator for creating advice topics
// - Background poller for periodic scanning

export * from './scanner.js';
export * from './generator.js';
export * from './poller.js';
export { 
  // Config
  loadAdviceConfig,
  saveAdviceConfig,
  addWatchedChannel,
  removeWatchedChannel,
  toggleWatchedChannel,
  updateChannelScanTimestamp,
  setAdviceEnabled,
  setScanInterval,
  getAdviceConfigForPrompt,
  // Topics
  loadAdviceTopics,
  saveAdviceTopics,
  addAdviceTopic,
  markTopicRead,
  dismissTopic,
  getUnreadTopics,
  getActiveTopics,
  clearDismissedTopics,
  getTopicById,
  // Types
  type WatchedChannel,
  type AdviceConfig,
  type AdviceTopic,
} from '../storage/advice.js';

