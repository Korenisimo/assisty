// TUI Types for k9s-style Work Mode

import { SerializedMessage } from '../storage/checkpoints.js';

// Workstream types
export type WorkstreamType = 'pr' | 'ticket' | 'ask' | 'investigation' | 'custom';
export type WorkstreamStatus = 'needs_input' | 'in_progress' | 'waiting' | 'done' | 'error';

export interface WorkstreamMetadata {
  prUrl?: string;
  prNumber?: number;
  prOwner?: string;
  prRepo?: string;
  ticketKey?: string;
  ticketUrl?: string;
  description?: string;
}

export interface Workstream {
  id: string;
  name: string;
  type: WorkstreamType;
  status: WorkstreamStatus;
  statusMessage?: string;
  createdAt: number;
  updatedAt: number;
  
  // Conversation state (leverages existing checkpoint format)
  messages: SerializedMessage[];
  tokenEstimate: number;
  turnCount: number;
  
  // Type-specific metadata
  metadata?: WorkstreamMetadata;
  
  // Agent config
  personality: string;
  character: string;
  datadogEnabled: boolean;
  
  // Model configuration (per-workstream)
  modelConfig?: {
    standardModel?: string;      // For analysis/chat (default: gemini-3-flash-preview)
    externalCommsModel?: string; // For Slack/JIRA posts (default: gemini-3-pro-preview)
  };
  
  // Processing state (per-workstream, not global)
  isProcessing?: boolean;
  
  // Live progress tracking (survives workstream switching)
  liveProgress?: {
    cursorStatus?: string;           // Current cursor status message
    cursorStartedAt?: number;        // When cursor started (for elapsed time)
    toolCalls?: Array<{              // Recent tool calls
      name: string;
      timestamp: number;
      preview: string;
    }>;
    lastUpdated: number;             // When liveProgress was last updated
  };
}

// Notification types
export type NotificationType = 'pr_update' | 'agent_done' | 'agent_stuck' | 'agent_needs_input' | 'reminder' | 'info' | 'error';

export interface Notification {
  id: string;
  workstreamId?: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  read: boolean;
}

// Status indicator mappings
export const STATUS_INDICATORS: Record<WorkstreamStatus, string> = {
  needs_input: '[!]',
  in_progress: '[~]',
  waiting: '[·]',
  done: '[✓]',
  error: '[✗]',
};

export const STATUS_COLORS: Record<WorkstreamStatus, string> = {
  needs_input: 'red',
  in_progress: 'yellow',
  waiting: 'cyan',
  done: 'green',
  error: 'red',
};

// Task type (from tasks.ts)
export interface Task {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: number;
  updatedAt: number;
  dueDate?: number;
  tags?: string[];
  context?: string;
  workstreamId?: string; // Link to a workstream if one exists
}

// Advice topic (from advice storage)
export interface AdviceTopicSummary {
  id: string;
  title: string;
  summary: string;
  relevanceReason: string;
  sourceChannel: string;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  readAt?: string;
  tags: string[];
}

// TUI State
export interface TUIState {
  workstreams: Workstream[];
  tasks: Task[];
  notifications: Notification[];
  adviceTopics: AdviceTopicSummary[];
  activeWorkstreamId: string | null;
  activeAdviceId: string | null;
  focusedPane: 'list' | 'tasks' | 'advice' | 'conversation';
  selectedTaskIndex: number;
  selectedAdviceIndex: number;
}

// Events emitted by components
export type TUIEvent = 
  | { type: 'workstream_select'; workstreamId: string }
  | { type: 'workstream_create'; workstreamType: WorkstreamType; name: string; metadata?: WorkstreamMetadata }
  | { type: 'workstream_delete'; workstreamId: string }
  | { type: 'task_create'; content: string; priority?: 'low' | 'medium' | 'high' | 'urgent' }
  | { type: 'task_delete'; taskId: string }
  | { type: 'advice_select'; adviceId: string }
  | { type: 'advice_dismiss'; adviceId: string }
  | { type: 'advice_refresh' }
  | { type: 'general_chat' }
  | { type: 'focus_change'; pane: 'list' | 'conversation' }
  | { type: 'message_send'; message: string }
  | { type: 'command'; command: string; args: string }
  | { type: 'interrupt' }
  | { type: 'notification_read'; notificationId: string }
  | { type: 'notification_click'; notificationId: string }
  | { type: 'trash_restore'; workstreamId: string }
  | { type: 'trash_permanent_delete'; workstreamId: string }
  | { type: 'trash_empty' }
  | { type: 'quit' };

// Callback types
export type EventHandler = (event: TUIEvent) => void;
export type ProgressCallback = (message: string) => void;
export type ResponseCallback = (response: string, done: boolean) => void;

// Voice control types
export interface VoiceState {
  ttsEnabled: boolean;           // Global TTS mode toggle
  isRecording: boolean;          // Currently recording audio
  isSpeaking: boolean;           // Currently playing TTS audio
  isTranscribing: boolean;       // Currently transcribing audio
  isPreprocessing: boolean;      // Currently preprocessing text for voice
  lastError?: string;            // Last error message for display
}

// Voice command types - all commands must start with "COMMAND"
export type VoiceCommandType =
  // Message commands
  | 'send'
  | 'say'
  | 'cancel'
  | 'stop'
  | 'continue'
  // Navigation commands
  | 'workstream'
  | 'general_chat'
  | 'tasks'
  | 'advice'
  | 'list'
  // Workstream commands
  | 'new_workstream'
  | 'delete_workstream'
  | 'reset'
  // Task commands
  | 'new_task'
  | 'delete_task'
  | 'next_task'
  | 'previous_task'
  // Utility commands
  | 'copy'
  | 'links'
  | 'help'
  | 'commands'
  | 'scroll_up'
  | 'scroll_down'
  | 'quit'
  // Voice control commands
  | 'voice_off'
  | 'voice_on'
  | 'read_again';

export interface ParsedVoiceCommand {
  type: VoiceCommandType;
  args?: string;  // Additional arguments (e.g., workstream name, task description)
}

// Voice events for TUI integration
export type VoiceEvent =
  | { type: 'voice_tts_toggle' }
  | { type: 'voice_recording_start' }
  | { type: 'voice_recording_stop' }
  | { type: 'voice_command'; command: ParsedVoiceCommand }
  | { type: 'voice_error'; error: string };

