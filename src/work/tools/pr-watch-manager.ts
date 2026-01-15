// PR Watch Manager - Persistent multi-PR queue and polling system
// Manages multiple PR watch sessions with intelligent context switching

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { 
  PRWatchSession, 
  PRWatchCallback, 
  PRWatchEvent,
  PRWatchQueueStatus,
  PRWatchSessionStatus,
  FailureInfo
} from './pr-watch-types.js';
import { getPRChecks, getPullRequest, PRChecksResult } from '../clients/github.js';
import { 
  createPRWorkspace, 
  ensureCorrectBranch,
  getCurrentCommitSha,
  extractFailureInfo,
  handleSessionFailure,
  handleSessionSuccess
} from './pr-tracking.js';

const MASTER_POLL_INTERVAL_MS = 30000;  // 30 seconds
const MAX_CONCURRENT_FIXES = 1;  // Only fix one PR at a time

/**
 * Singleton manager for all PR watch sessions
 * Provides persistent polling and intelligent queue management
 */
class PRWatchManager extends EventEmitter {
  private static instance: PRWatchManager;
  private sessions: Map<string, PRWatchSession> = new Map();
  private masterPollInterval?: NodeJS.Timeout;
  private globalCallback?: PRWatchCallback;
  private activeFixes: Set<string> = new Set();  // sessionIds currently being fixed
  
  // NEW: Map sessionId to workstreamId for status updates
  private sessionToWorkstream: Map<string, string> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): PRWatchManager {
    if (!PRWatchManager.instance) {
      PRWatchManager.instance = new PRWatchManager();
    }
    return PRWatchManager.instance;
  }

  /**
   * Set a global callback for all PR watch events
   */
  setGlobalCallback(callback: PRWatchCallback): void {
    this.globalCallback = callback;
  }

  /**
   * Add a PR to the watch queue
   * @param workstreamId Optional workstream ID to link this watch to
   */
  async addPRWatch(
    repoUrl: string,
    prNumber: number,
    onStateChange?: PRWatchCallback,
    workstreamId?: string
  ): Promise<{ success: boolean; session?: PRWatchSession; error?: string }> {
    try {
      // Check if already watching this PR
      const existing = this.findSession(repoUrl, prNumber);
      if (existing) {
        return {
          success: false,
          error: `Already watching PR #${prNumber} on ${repoUrl}. Session ID: ${existing.sessionId}`,
        };
      }

      // Get PR details
      const pr = await getPullRequest(repoUrl, prNumber);
      if (!pr) {
        return { success: false, error: `PR #${prNumber} not found` };
      }

      if (pr.state !== 'open') {
        return { success: false, error: `PR #${prNumber} is ${pr.state}, not open` };
      }

      // Create isolated workspace for this PR
      const localRepoPath = await createPRWorkspace(repoUrl, prNumber, pr.head.ref);

      // Get initial commit SHA
      const initialSha = await getCurrentCommitSha(localRepoPath);

      // Create session with unique ID
      const sessionId = randomUUID();
      const session: PRWatchSession = {
        sessionId,
        repoUrl,
        prNumber,
        localRepoPath,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        status: 'watching',
        startedAt: Date.now(),
        initialCommitSha: initialSha,
        currentSha: pr.head.sha,
        fixAttempts: 0,
        fixHistory: [],
        onStateChange,
      };

      this.sessions.set(sessionId, session);

      // NEW: Link to workstream if provided
      if (workstreamId) {
        this.sessionToWorkstream.set(sessionId, workstreamId);
      }

      // Start master poller if not running
      this.startMasterPoller();

      // Emit started event
      this.emitEvent({ type: 'started', session });

      // Do immediate poll
      this.pollSession(session).catch(err => {
        this.emitEvent({
          type: 'error',
          sessionId,
          error: `Initial poll failed: ${err.message || err}`
        });
      });

      return { success: true, session };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errMsg };
    }
  }

  /**
   * Stop watching a specific PR
   */
  stopPRWatch(sessionId: string, reason: string = 'User requested'): { 
    stopped: boolean; 
    session?: PRWatchSession;
    error?: string;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { stopped: false, error: 'Session not found' };
    }

    session.status = 'stopped';
    this.emitEvent({ type: 'stopped', sessionId, reason });
    
    // Clean up workstream mapping
    this.sessionToWorkstream.delete(sessionId);
    
    // Keep session in map for reference but mark as stopped
    // Clean up after a while
    setTimeout(() => {
      this.sessions.delete(sessionId);
      
      // Stop master poller if no active sessions
      if (this.getActiveSessions().length === 0) {
        this.stopMasterPoller();
      }
    }, 60000); // Keep for 1 minute

    return { stopped: true, session };
  }

  /**
   * Stop all watches
   */
  stopAll(reason: string = 'Stop all requested'): number {
    const activeSessions = this.getActiveSessions();
    activeSessions.forEach(session => {
      this.stopPRWatch(session.sessionId, reason);
    });
    return activeSessions.length;
  }

  /**
   * Get status of all watches
   */
  getStatus(): PRWatchQueueStatus {
    const sessions = Array.from(this.sessions.values());
    const activeSessions = sessions.filter(s => s.status !== 'stopped');
    
    if (activeSessions.length === 0) {
      return { active: false, sessions: [] };
    }

    const currentFocus = this.determineFocus(activeSessions);

    return {
      active: true,
      currentFocus: currentFocus?.sessionId,
      sessions: activeSessions.map(s => this.sessionToStatus(s)),
    };
  }

  /**
   * Get status of a specific session
   */
  getSessionStatus(sessionId: string): PRWatchSessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.sessionToStatus(session);
  }

  /**
   * Get full session object (for operations like squashing)
   */
  getSession(sessionId: string): PRWatchSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get workstream ID linked to a session (if any)
   */
  getWorkstreamForSession(sessionId: string): string | undefined {
    return this.sessionToWorkstream.get(sessionId);
  }

  /**
   * Get session ID for a workstream (if any)
   */
  getSessionForWorkstream(workstreamId: string): string | undefined {
    for (const [sessionId, wsId] of this.sessionToWorkstream.entries()) {
      if (wsId === workstreamId) {
        return sessionId;
      }
    }
    return undefined;
  }
  findSession(repoUrl: string, prNumber: number): PRWatchSession | undefined {
    return Array.from(this.sessions.values()).find(
      s => s.repoUrl === repoUrl && s.prNumber === prNumber && s.status !== 'stopped'
    );
  }

  /**
   * Provide manual logs for a session awaiting user input
   */
  async provideManualLogs(sessionId: string, logs: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.status !== 'awaiting_user') {
      return { 
        success: false, 
        error: `Session is in '${session.status}' state, not awaiting user input` 
      };
    }

    if (!session.currentFailure) {
      return { success: false, error: 'No current failure to provide logs for' };
    }

    // Add logs to current failure
    session.currentFailure.logs = logs;

    // Trigger fix with the logs
    await handleSessionFailure(session, session.currentFailure, this.emitEvent.bind(this));

    return { success: true };
  }

  // ===== Private Methods =====

  private startMasterPoller(): void {
    if (this.masterPollInterval) return;

    // Emit event instead of console.log
    this.emit('poller-started', { intervalMs: MASTER_POLL_INTERVAL_MS });

    this.masterPollInterval = setInterval(async () => {
      try {
        await this.pollAllSessions();
      } catch (error) {
        // Emit error event instead of console.error
        this.emitEvent({
          type: 'error',
          sessionId: 'system',
          error: `Poll cycle error: ${error instanceof Error ? error.message : error}`
        });
      }
    }, MASTER_POLL_INTERVAL_MS);

    // Don't keep process alive just for polling
    this.masterPollInterval.unref();
  }

  private stopMasterPoller(): void {
    if (this.masterPollInterval) {
      this.emit('poller-stopped', {});
      clearInterval(this.masterPollInterval);
      this.masterPollInterval = undefined;
    }
  }

  private async pollAllSessions(): Promise<void> {
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length === 0) {
      this.stopMasterPoller();
      return;
    }

    // Priority order: fixing > watching > waiting_for_ci
    const prioritized = this.prioritizeSessions(activeSessions);

    for (const session of prioritized) {
      try {
        await this.pollSession(session);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        this.emitEvent({
          type: 'error',
          sessionId: session.sessionId,
          error: `Poll failed: ${errMsg}`
        });
      }
    }

    // Check for context switching opportunities
    await this.checkContextSwitch(activeSessions);
  }

  private async pollSession(session: PRWatchSession): Promise<void> {
    // Don't poll if awaiting user or stopped
    if (session.status === 'awaiting_user' || session.status === 'stopped') {
      return;
    }

    // Don't poll if currently fixing (unless enough time has passed to check CI)
    if (session.status === 'fixing' && this.activeFixes.has(session.sessionId)) {
      return;
    }

    session.lastPolled = Date.now();

    // Ensure we're on correct branch
    await ensureCorrectBranch(session);

    // Get CI status
    const checksResult = await getPRChecks(session.repoUrl, session.prNumber);
    
    this.emitEvent({ 
      type: 'polling', 
      sessionId: session.sessionId,
      checksResult 
    });

    // Update current SHA
    session.currentSha = checksResult.sha;

    const { summary } = checksResult;

    if (summary.pending > 0) {
      // Checks are pending - mark as waiting for CI if we were fixing
      if (session.status === 'fixing') {
        session.status = 'waiting_for_ci';
        this.activeFixes.delete(session.sessionId);
      } else if (session.status === 'watching') {
        session.status = 'waiting_for_ci';
      }
      return;
    }

    if (summary.failing > 0) {
      // Failure detected
      const failure = await extractFailureInfo(checksResult, session);
      
      // Check if this is the same failure we already know about
      const isSameFailure = session.currentFailure?.checkName === failure.checkName;
      
      // Check if we're already fixing this session
      const alreadyFixing = this.activeFixes.has(session.sessionId);
      
      // Only start a NEW fix if:
      // 1. We're not already fixing this session
      // 2. We have capacity OR it's a retry for the same failure
      if (!alreadyFixing) {
        if (this.activeFixes.size >= MAX_CONCURRENT_FIXES && !isSameFailure) {
          // Queue this failure for later
          this.emitEvent({
            type: 'error',
            sessionId: session.sessionId,
            error: `Max concurrent fixes reached. Queuing ${failure.checkName} until current fix completes.`
          });
          session.currentFailure = failure;
          return;
        }

        session.currentFailure = failure;
        session.status = 'fixing';
        this.activeFixes.add(session.sessionId);

        this.emitEvent({ 
          type: 'failure_detected', 
          sessionId: session.sessionId,
          failure 
        });

        // Handle the failure asynchronously
        handleSessionFailure(session, failure, this.emitEvent.bind(this))
          .then(() => {
            // Remove from active fixes so next poll can retry if still failing
            this.activeFixes.delete(session.sessionId);
            // Don't change status here - let the next poll detect the result
            if (session.status === 'fixing') {
              session.status = 'watching';
            }
          })
          .catch(err => {
            this.activeFixes.delete(session.sessionId);
            // Set status back to watching so next poll can retry
            if (session.status === 'fixing') {
              session.status = 'watching';
            }
            this.emitEvent({
              type: 'error',
              sessionId: session.sessionId,
              error: `Fix failed: ${err.message || err}`
            });
          });
      }

    } else if (summary.failing === 0 && summary.pending === 0) {
      // All checks passing!
      if (session.status === 'waiting_for_ci' || session.status === 'watching' || session.status === 'fixing') {
        await handleSessionSuccess(session, this.emitEvent.bind(this));
        this.activeFixes.delete(session.sessionId);
      }
    }
  }

  private async checkContextSwitch(activeSessions: PRWatchSession[]): Promise<void> {
    // Find sessions waiting for CI
    const waitingSessions = activeSessions.filter(s => s.status === 'waiting_for_ci');
    
    // Find sessions that need attention (watching or fixing)
    const needAttention = activeSessions.filter(
      s => (s.status === 'watching' && s.currentFailure) || 
           (s.status === 'fixing' && !this.activeFixes.has(s.sessionId))
    );

    if (waitingSessions.length > 0 && needAttention.length > 0) {
      // We have PRs waiting for CI and PRs that need work
      // The prioritization in pollAllSessions will naturally handle this
      const from = waitingSessions[0];
      const to = needAttention[0];
      
      this.emitEvent({
        type: 'context_switch',
        fromSessionId: from.sessionId,
        toSessionId: to.sessionId,
        reason: `PR #${from.prNumber} waiting for CI, switching to PR #${to.prNumber}`
      });
    }
  }

  private prioritizeSessions(sessions: PRWatchSession[]): PRWatchSession[] {
    const priority = { 
      fixing: 3, 
      watching: 2, 
      waiting_for_ci: 1,
      awaiting_user: 0,
      success: 0,
      stopped: -1 
    };
    
    return sessions.sort((a, b) => {
      const aPriority = priority[a.status] || 0;
      const bPriority = priority[b.status] || 0;
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      // Same priority - oldest first
      return a.startedAt - b.startedAt;
    });
  }

  private determineFocus(sessions: PRWatchSession[]): PRWatchSession | undefined {
    const prioritized = this.prioritizeSessions(sessions);
    return prioritized[0];
  }

  private getActiveSessions(): PRWatchSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status !== 'stopped');
  }

  private sessionToStatus(session: PRWatchSession): PRWatchSessionStatus {
    let statusMessage = '';
    switch (session.status) {
      case 'watching':
        statusMessage = 'Monitoring for failures';
        break;
      case 'fixing':
        statusMessage = `Fixing attempt #${session.fixAttempts}`;
        if (session.currentFailure) {
          statusMessage += ` (${session.currentFailure.checkName})`;
        }
        break;
      case 'waiting_for_ci':
        statusMessage = 'Waiting for CI checks';
        break;
      case 'awaiting_user':
        statusMessage = 'Awaiting user input';
        break;
      case 'success':
        statusMessage = 'All checks passing';
        break;
      case 'stopped':
        statusMessage = 'Stopped';
        break;
    }

    return {
      sessionId: session.sessionId,
      repoUrl: session.repoUrl,
      prNumber: session.prNumber,
      branch: session.branch,
      status: session.status,
      statusMessage,
      fixAttempts: session.fixAttempts,
      currentFailure: session.currentFailure ? {
        checkName: session.currentFailure.checkName,
        app: session.currentFailure.app,
      } : undefined,
      minutesSinceStart: Math.floor((Date.now() - session.startedAt) / 60000),
      lastPolled: session.lastPolled,
      workspace: session.localRepoPath,
    };
  }

  private emitEvent(event: PRWatchEvent): void {
    // Emit to specific session callback if it exists
    if ('sessionId' in event) {
      const session = this.sessions.get(event.sessionId);
      session?.onStateChange?.(event);
    } else if (event.type === 'started') {
      event.session.onStateChange?.(event);
    }

    // Emit to global callback
    this.globalCallback?.(event);

    // Emit as EventEmitter event
    this.emit('pr-watch-event', event);
  }
}

// Export singleton instance
export const prWatchManager = PRWatchManager.getInstance();

// Export for testing
export { PRWatchManager };

