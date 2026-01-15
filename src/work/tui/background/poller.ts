// Background Poller
// Orchestrates polling for external status updates (PRs, Jira, etc.)

import { EventEmitter } from 'events';
import { WorkstreamManager } from '../state/workstreams.js';
import { NotificationManager } from '../state/notifications.js';
import { Workstream } from '../types.js';
import { getPRChecks, isGitHubConfigured } from '../../clients/github.js';

interface PollerConfig {
  prPollIntervalMs: number;
  jiraPollIntervalMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: PollerConfig = {
  prPollIntervalMs: 30000, // 30 seconds
  jiraPollIntervalMs: 60000, // 1 minute
  enabled: true,
};

// Track last known status to detect changes
interface PRStatusCache {
  workstreamId: string;
  lastStatus: 'pending' | 'success' | 'failure' | 'unknown';
  lastChecked: number;
}

export class BackgroundPoller extends EventEmitter {
  private notificationManager: NotificationManager;
  private workstreamManager: WorkstreamManager;
  private config: PollerConfig;
  private prPollTimer: NodeJS.Timeout | null = null;
  private prStatusCache: Map<string, PRStatusCache> = new Map();
  private running: boolean = false;

  constructor(
    notificationManager: NotificationManager,
    workstreamManager: WorkstreamManager,
    config: Partial<PollerConfig> = {}
  ) {
    super();
    this.notificationManager = notificationManager;
    this.workstreamManager = workstreamManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Start PR polling if GitHub is configured
    if (isGitHubConfigured()) {
      this.startPRPolling();
    }
  }

  stop(): void {
    this.running = false;
    
    if (this.prPollTimer) {
      clearInterval(this.prPollTimer);
      this.prPollTimer = null;
    }
  }

  private startPRPolling(): void {
    // Initial poll
    this.pollPRs();
    
    // Set up interval
    this.prPollTimer = setInterval(() => {
      if (this.running) {
        this.pollPRs();
      }
    }, this.config.prPollIntervalMs);
  }

  private async pollPRs(): Promise<void> {
    const prWorkstreams = this.workstreamManager.getByType('pr')
      .filter(w => w.status !== 'done' && w.metadata?.prUrl);

    for (const workstream of prWorkstreams) {
      try {
        await this.checkPRStatus(workstream);
      } catch (error) {
        // Log but don't crash on individual PR check failures
        console.error(`Error checking PR for ${workstream.name}:`, error);
      }
    }
  }

  private async checkPRStatus(workstream: Workstream): Promise<void> {
    if (!workstream.metadata?.prUrl || !workstream.metadata?.prNumber) return;

    const { prUrl, prNumber } = workstream.metadata;
    
    try {
      const checks = await getPRChecks(prUrl, prNumber);
      // Compute overall status from counts
      const overall = this.computeOverallStatus(checks.summary);
      const currentStatus = this.mapCheckStatus(overall);
      
      // Get cached status
      const cached = this.prStatusCache.get(workstream.id);
      const previousStatus = cached?.lastStatus || 'unknown';
      
      // Update cache
      this.prStatusCache.set(workstream.id, {
        workstreamId: workstream.id,
        lastStatus: currentStatus,
        lastChecked: Date.now(),
      });
      
      // Detect status changes
      if (previousStatus !== 'unknown' && previousStatus !== currentStatus) {
        await this.handlePRStatusChange(workstream, previousStatus, currentStatus, checks);
      }
      
      // Update workstream status message
      const statusMessage = this.formatPRStatusMessage(checks);
      await this.workstreamManager.update(workstream.id, {
        statusMessage,
        status: currentStatus === 'failure' ? 'error' 
              : currentStatus === 'success' ? 'waiting'
              : 'in_progress',
      });
      
    } catch (error) {
      // On error, update workstream but don't spam notifications
      await this.workstreamManager.update(workstream.id, {
        statusMessage: `Error checking PR: ${error instanceof Error ? error.message : 'Unknown'}`,
      });
    }
  }

  private computeOverallStatus(summary: { pending: number; passing: number; failing: number; total: number }): string {
    if (summary.failing > 0) return 'failure';
    if (summary.pending > 0) return 'pending';
    if (summary.passing === summary.total && summary.total > 0) return 'success';
    return 'unknown';
  }

  private mapCheckStatus(overall: string): 'pending' | 'success' | 'failure' | 'unknown' {
    switch (overall) {
      case 'success':
        return 'success';
      case 'failure':
      case 'error':
        return 'failure';
      case 'pending':
      case 'in_progress':
        return 'pending';
      default:
        return 'unknown';
    }
  }

  private async handlePRStatusChange(
    workstream: Workstream,
    previousStatus: string,
    currentStatus: string,
    checks: any
  ): Promise<void> {
    let notificationType: 'pr_update' | 'error' | 'info';
    let message: string;

    if (currentStatus === 'success') {
      notificationType = 'pr_update';
      message = `✅ ${workstream.name}: All checks passed!`;
    } else if (currentStatus === 'failure') {
      notificationType = 'error';
      const failedNames = checks.summary.failedChecks
        ?.map((c: any) => c.name)
        .slice(0, 3)
        .join(', ') || 'Unknown checks';
      message = `❌ ${workstream.name}: Checks failed (${failedNames})`;
    } else if (previousStatus === 'failure' && currentStatus === 'pending') {
      notificationType = 'info';
      message = `🔄 ${workstream.name}: Checks restarted`;
    } else {
      // Don't notify on other transitions
      return;
    }

    this.notificationManager.add({
      type: notificationType,
      message,
      workstreamId: workstream.id,
    });

    this.emit('notification');
  }

  private formatPRStatusMessage(checks: any): string {
    const { passing, pending, failing, total } = checks.summary;
    const overall = this.computeOverallStatus(checks.summary);
    
    if (overall === 'success') {
      return `✅ All ${total} checks passed`;
    } else if (overall === 'failure') {
      return `❌ ${failing}/${total} checks failed`;
    } else if (overall === 'pending') {
      return `⏳ ${passing}/${total} passed, ${pending} pending`;
    } else {
      return `Checks: ${passing} passed, ${pending} pending, ${failing} failed`;
    }
  }

  // Force immediate poll (useful when user creates a new PR workstream)
  async pollNow(): Promise<void> {
    await this.pollPRs();
    this.emit('notification');
  }

  // Get status for a specific workstream from cache (no API call)
  getCachedStatus(workstreamId: string): PRStatusCache | undefined {
    return this.prStatusCache.get(workstreamId);
  }
}

