// PR Watch Types - Shared types for PR tracking and watching
// Extracted from pr-tracking.ts for better modularity

import { CheckRunAnnotation } from '../clients/github.js';
import { CursorResponse } from './cursor.js';

export interface PRWatchSession {
  sessionId: string;           // Unique identifier for this session
  repoUrl: string;
  prNumber: number;
  localRepoPath: string;
  branch: string;
  baseBranch: string;
  status: 'watching' | 'fixing' | 'awaiting_user' | 'waiting_for_ci' | 'success' | 'stopped';
  startedAt: number;
  initialCommitSha: string;  // SHA when watch started (for squash)
  currentSha: string;        // Current head SHA
  fixAttempts: number;       // Total fix attempts
  currentFailure?: FailureInfo;
  fixHistory: FixAttempt[];
  lastPolled?: number;       // Timestamp of last poll
  // Callbacks for state changes
  onStateChange?: PRWatchCallback;
}

export interface FailureInfo {
  checkName: string;
  checkType: 'check_run' | 'status';
  checkUrl: string | null;
  app?: string;  // e.g., 'circleci-checks', 'github-actions'
  annotations?: CheckRunAnnotation[];
  failedSteps?: string[];
  logs?: string;  // Manual logs provided by user
}

export interface FixAttempt {
  timestamp: number;
  failure: FailureInfo;
  attemptNumber: number;  // 1, 2, or 3
  method: 'templated' | 'llm' | 'manual';
  cursorResponse?: CursorResponse;
  commitSha?: string;
  success: boolean;
}

export type PRWatchEvent = 
  | { type: 'started'; session: PRWatchSession }
  | { type: 'polling'; sessionId: string; checksResult: any }
  | { type: 'failure_detected'; sessionId: string; failure: FailureInfo }
  | { type: 'fixing'; sessionId: string; attempt: number; method: 'templated' | 'llm' | 'manual' }
  | { type: 'fix_skipped'; sessionId: string; reason: string }
  | { type: 'fix_committed'; sessionId: string; sha: string }
  | { type: 'success'; sessionId: string; commitCount: number }
  | { type: 'max_attempts'; sessionId: string; failure: FailureInfo }
  | { type: 'stopped'; sessionId: string; reason: string }
  | { type: 'context_switch'; fromSessionId: string; toSessionId: string; reason: string }
  | { type: 'error'; sessionId: string; error: string };

export type PRWatchCallback = (event: PRWatchEvent) => void;

export interface PRWatchQueueStatus {
  active: boolean;
  sessions: PRWatchSessionStatus[];
  currentFocus?: string;  // sessionId of current focus
}

export interface PRWatchSessionStatus {
  sessionId: string;
  repoUrl: string;
  prNumber: number;
  branch: string;
  status: PRWatchSession['status'];
  statusMessage: string;
  fixAttempts: number;
  currentFailure?: {
    checkName: string;
    app?: string;
  };
  minutesSinceStart: number;
  lastPolled?: number;
  workspace: string;
}

