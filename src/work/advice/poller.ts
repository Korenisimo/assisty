// Advice Poller - Background polling for Slack channel updates
// Runs periodically to check watched channels and generate advice

import { EventEmitter } from 'events';
import { loadAdviceConfig } from '../storage/advice.js';
import { scanWatchedChannels } from './scanner.js';
import { generateAdviceTopics } from './generator.js';
import { AdviceTopic } from '../storage/advice.js';

interface AdvicePollerConfig {
  enabled: boolean;
  pollIntervalMs: number;  // Override from config
}

const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes

export class AdvicePoller extends EventEmitter {
  private config: AdvicePollerConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private isPolling: boolean = false;  // Prevent concurrent polls
  private lastPollResult: {
    success: boolean;
    error?: string;
    newTopicsCount: number;
    scannedAt: string;
  } | null = null;

  constructor(config: Partial<AdvicePollerConfig> = {}) {
    super();
    this.config = {
      enabled: config.enabled ?? true,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    };
  }

  // Start the poller
  async start(): Promise<void> {
    if (this.running) return;

    // Check if advice is enabled in config
    const adviceConfig = loadAdviceConfig();
    if (!adviceConfig.enabled) {
      this.emit('status', { message: 'Advice feature is disabled' });
      return;
    }

    if (adviceConfig.watchedChannels.filter(ch => ch.enabled).length === 0) {
      this.emit('status', { message: 'No channels to watch' });
      return;
    }

    this.running = true;
    
    // Use interval from advice config if set
    const intervalMs = adviceConfig.scanIntervalMinutes 
      ? adviceConfig.scanIntervalMinutes * 60 * 1000 
      : this.config.pollIntervalMs;

    this.emit('started', { intervalMinutes: intervalMs / 60000 });

    // Initial poll after short delay (let browser warm up)
    setTimeout(() => {
      if (this.running) {
        this.poll();
      }
    }, 5000);

    // Set up interval
    this.pollTimer = setInterval(() => {
      if (this.running && !this.isPolling) {
        this.poll();
      }
    }, intervalMs);
  }

  // Stop the poller
  stop(): void {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit('stopped', {});
  }

  // Run a single poll cycle
  async poll(): Promise<AdviceTopic[]> {
    if (this.isPolling) {
      this.emit('status', { message: 'Already polling, skipping' });
      return [];
    }

    this.isPolling = true;
    const newTopics: AdviceTopic[] = [];

    try {
      this.emit('scan_started', {});
      
      // Reload config in case it changed
      const config = loadAdviceConfig();
      if (!config.enabled) {
        this.emit('status', { message: 'Advice disabled, skipping' });
        this.isPolling = false;
        return [];
      }

      // Scan channels
      const scanResult = await scanWatchedChannels();
      
      if (!scanResult.success) {
        this.lastPollResult = {
          success: false,
          error: scanResult.error,
          newTopicsCount: 0,
          scannedAt: new Date().toISOString(),
        };
        this.emit('poll_error', scanResult.error);
        this.isPolling = false;
        return [];
      }

      // Check if there are new messages
      if (scanResult.totalNewMessages === 0) {
        this.lastPollResult = {
          success: true,
          newTopicsCount: 0,
          scannedAt: new Date().toISOString(),
        };
        this.emit('scan_completed', { newMessages: 0, newTopics: 0 });
        this.isPolling = false;
        return [];
      }

      this.emit('messages_found', { count: scanResult.totalNewMessages });

      // Generate advice topics
      const topics = await generateAdviceTopics(scanResult.channels);
      
      if (topics.length > 0) {
        newTopics.push(...topics);
        
        // Emit event for UI to update
        this.emit('new_topics', topics);
      }

      this.lastPollResult = {
        success: true,
        newTopicsCount: topics.length,
        scannedAt: new Date().toISOString(),
      };

      this.emit('scan_completed', { 
        newMessages: scanResult.totalNewMessages, 
        newTopics: topics.length 
      });

    } catch (error) {
      this.lastPollResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        newTopicsCount: 0,
        scannedAt: new Date().toISOString(),
      };
      this.emit('poll_error', error);
    } finally {
      this.isPolling = false;
    }

    return newTopics;
  }

  // Force an immediate poll (user triggered)
  async pollNow(): Promise<AdviceTopic[]> {
    return this.poll();
  }

  // Get last poll result
  getLastPollResult() {
    return this.lastPollResult;
  }

  // Check if currently polling
  isCurrentlyPolling(): boolean {
    return this.isPolling;
  }

  // Check if running
  isRunning(): boolean {
    return this.running;
  }

  // Update config at runtime
  updateConfig(config: Partial<AdvicePollerConfig>): void {
    if (config.enabled !== undefined) {
      this.config.enabled = config.enabled;
    }
    if (config.pollIntervalMs !== undefined) {
      this.config.pollIntervalMs = config.pollIntervalMs;
      
      // Restart with new interval if running
      if (this.running) {
        this.stop();
        this.start();
      }
    }
  }
}

// Singleton instance for the TUI
let advicePollerInstance: AdvicePoller | null = null;

export function getAdvicePoller(): AdvicePoller {
  if (!advicePollerInstance) {
    advicePollerInstance = new AdvicePoller();
  }
  return advicePollerInstance;
}

export function startAdvicePoller(): void {
  const poller = getAdvicePoller();
  poller.start();
}

export function stopAdvicePoller(): void {
  if (advicePollerInstance) {
    advicePollerInstance.stop();
  }
}

