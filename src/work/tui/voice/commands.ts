// Voice command parser
// All valid voice commands must start with "COMMAND"

import { VoiceCommandType, ParsedVoiceCommand } from '../types.js';

// Command patterns with their variations for speech recognition flexibility
const COMMAND_PATTERNS: Array<{
  type: VoiceCommandType;
  patterns: RegExp[];
}> = [
  // Message commands
  {
    type: 'send',
    patterns: [
      /^send$/i,
      /^send message$/i,
      /^submit$/i,
      /^enter$/i,
    ],
  },
  {
    type: 'say',
    patterns: [
      /^say\s+(.+)$/i,        // "say hello world" - dictate and send
      /^send\s+(.+)$/i,       // "send hello world" - dictate and send
      /^message\s+(.+)$/i,    // "message hello world"
      /^tell\s+(.+)$/i,       // "tell them hello"
      /^ask\s+(.+)$/i,        // "ask what is the status"
    ],
  },
  {
    type: 'cancel',
    patterns: [
      /^cancel$/i,
      /^clear$/i,
      /^nevermind$/i,
      /^never mind$/i,
    ],
  },
  {
    type: 'stop',
    patterns: [
      /^stop$/i,
      /^interrupt$/i,
      /^halt$/i,
      /^abort$/i,
    ],
  },
  {
    type: 'continue',
    patterns: [
      /^continue$/i,
      /^resume$/i,
      /^go on$/i,
      /^keep going$/i,
    ],
  },

  // Navigation commands
  {
    type: 'workstream',
    patterns: [
      /^workstream\s+(.+)$/i,
      /^work\s*stream\s+(.+)$/i,      // "work stream 1"
      /^works\s*stream\s+(.+)$/i,     // "works stream 1" (common mishear)
      /^workspace\s+(.+)$/i,          // "workspace 1"
      /^open workstream\s+(.+)$/i,
      /^go to workstream\s+(.+)$/i,
      /^go to work\s*stream\s+(.+)$/i,
      /^switch to workstream\s+(.+)$/i,
      /^switch to work\s*stream\s+(.+)$/i,
      /^workstream number\s+(\d+)$/i,
      /^work\s*stream number\s+(\d+)$/i,
      /^workstream\s+(\d+)$/i,
      /^stream\s+(\d+)$/i,            // Just "stream 1"
    ],
  },
  {
    type: 'general_chat',
    patterns: [
      /^general chat$/i,
      /^chat$/i,
      /^open chat$/i,
      /^go to chat$/i,
    ],
  },
  {
    type: 'tasks',
    patterns: [
      /^tasks$/i,
      /^show tasks$/i,
      /^open tasks$/i,
      /^go to tasks$/i,
    ],
  },
  {
    type: 'advice',
    patterns: [
      /^advice$/i,
      /^show advice$/i,
      /^open advice$/i,
      /^go to advice$/i,
    ],
  },
  {
    type: 'list',
    patterns: [
      /^list$/i,
      /^show list$/i,
      /^workstreams$/i,
      /^show workstreams$/i,
    ],
  },

  // Workstream commands
  {
    type: 'new_workstream',
    patterns: [
      /^new workstream[,:]?\s+(.+)$/i,      // "new workstream, test" or "new workstream test"
      /^create workstream[,:]?\s+(.+)$/i,
      /^add workstream[,:]?\s+(.+)$/i,
      /^new work\s*stream[,:]?\s+(.+)$/i,   // "new work stream, test"
      /^new workstream$/i,                   // Without name triggers dialog
    ],
  },
  {
    type: 'delete_workstream',
    patterns: [
      /^delete workstream$/i,
      /^remove workstream$/i,
      /^close workstream$/i,
    ],
  },
  {
    type: 'reset',
    patterns: [
      /^reset$/i,
      /^reset conversation$/i,
      /^clear conversation$/i,
      /^start over$/i,
    ],
  },

  // Task commands
  {
    type: 'new_task',
    patterns: [
      /^new task[,:]?\s+(.+)$/i,       // "new task, do something" or "new task do something"
      /^create task[,:]?\s+(.+)$/i,
      /^add task[,:]?\s+(.+)$/i,
      /^task[,:]?\s+(.+)$/i,
    ],
  },
  {
    type: 'delete_task',
    patterns: [
      /^delete task$/i,
      /^remove task$/i,
    ],
  },
  {
    type: 'next_task',
    patterns: [
      /^next task$/i,
      /^next$/i,
      /^down$/i,
    ],
  },
  {
    type: 'previous_task',
    patterns: [
      /^previous task$/i,
      /^previous$/i,
      /^up$/i,
      /^back$/i,
    ],
  },

  // Utility commands
  {
    type: 'copy',
    patterns: [
      /^copy$/i,
      /^copy response$/i,
      /^copy last$/i,
    ],
  },
  {
    type: 'links',
    patterns: [
      /^links$/i,
      /^show links$/i,
      /^urls$/i,
      /^show urls$/i,
    ],
  },
  {
    type: 'help',
    patterns: [
      /^help$/i,
      /^show help$/i,
    ],
  },
  {
    type: 'commands',
    patterns: [
      /^commands$/i,
      /^list commands$/i,
      /^show commands$/i,
      /^voice commands$/i,
      /^what can (i|you) (say|do)$/i,
    ],
  },
  {
    type: 'scroll_up',
    patterns: [
      /^scroll up$/i,
      /^page up$/i,
      /^go up$/i,
    ],
  },
  {
    type: 'scroll_down',
    patterns: [
      /^scroll down$/i,
      /^page down$/i,
      /^go down$/i,
    ],
  },
  {
    type: 'quit',
    patterns: [
      /^quit$/i,
      /^exit$/i,
      /^close$/i,
    ],
  },

  // Voice control commands
  {
    type: 'voice_off',
    patterns: [
      /^voice off$/i,
      /^mute$/i,
      /^silence$/i,
      /^stop speaking$/i,
      /^turn off voice$/i,
    ],
  },
  {
    type: 'voice_on',
    patterns: [
      /^voice on$/i,
      /^unmute$/i,
      /^turn on voice$/i,
      /^speak$/i,
    ],
  },
  {
    type: 'read_again',
    patterns: [
      /^read again$/i,
      /^repeat$/i,
      /^say again$/i,
      /^read that again$/i,
    ],
  },
];

/**
 * Parse a transcribed voice command
 * Returns null if the text doesn't start with "COMMAND" or is not a valid command
 */
export function parseVoiceCommand(text: string): ParsedVoiceCommand | null {
  // Normalize the text - remove trailing punctuation and extra whitespace
  let normalized = text.trim()
    .replace(/[.!?]+$/, '')  // Remove trailing punctuation
    .trim();
  
  // Apply Whisper transcription normalization (fixes common mishearings)
  normalized = normalizeTranscription(normalized);
  
  // Check for COMMAND prefix (case-insensitive)
  // Allow for ANY punctuation after "command" (Whisper adds commas, hyphens, periods, etc.)
  const commandMatch = normalized.match(/^command[\s,.:;\-–—]+(.+)$/i);
  if (!commandMatch) {
    return null;  // Not a command - ignore
  }

  let commandText = commandMatch[1].trim()
    .replace(/[.!?]+$/, '')   // Remove trailing punctuation
    .replace(/[.!?]\s+/g, ' ') // Replace ". " with just " " (Whisper adds periods between phrases)
    .replace(/,\s+/g, ' ')    // Replace ", " with just " " (Whisper adds commas)
    .replace(/\s+/g, ' ')     // Normalize multiple spaces
    .trim();
  
  // Apply normalization to the command text too
  commandText = normalizeTranscription(commandText);

  // Try to match against known patterns
  for (const { type, patterns } of COMMAND_PATTERNS) {
    for (const pattern of patterns) {
      const match = commandText.match(pattern);
      if (match) {
        // Extract args if pattern has a capture group
        const args = match[1]?.trim();
        return { type, args };
      }
    }
  }

  // No pattern matched
  return null;
}

/**
 * Check if text starts with "COMMAND"
 */
export function isCommand(text: string): boolean {
  // Allow for ANY punctuation/separator after "command" (Whisper is unpredictable)
  // Matches: "command help", "command, help", "command-help", "command. help", etc.
  return /^command[\s,.:;\-–—]+/i.test(text.trim());
}

/**
 * Get a help string for available voice commands
 */
export function getVoiceCommandHelp(): string {
  return `
Voice Commands (prefix all with "COMMAND"):

MESSAGE COMMANDS:
  "command send"           - Send current message
  "command cancel"         - Clear current input
  "command stop"           - Interrupt the agent
  "command continue"       - Resume after step limit

NAVIGATION COMMANDS:
  "command workstream [name/number]" - Switch to workstream
  "command general chat"   - Switch to general chat
  "command tasks"          - Focus tasks panel
  "command advice"         - Focus advice panel
  "command list"           - Focus workstream list

WORKSTREAM COMMANDS:
  "command new workstream [name]" - Create new workstream
  "command delete workstream"     - Delete current workstream
  "command reset"          - Reset conversation

TASK COMMANDS:
  "command new task [description]" - Create a new task
  "command delete task"    - Delete selected task
  "command next task"      - Select next task
  "command previous task"  - Select previous task

UTILITY COMMANDS:
  "command copy"           - Copy last response
  "command links"          - Open link picker
  "command help"           - Show help
  "command scroll up/down" - Scroll conversation
  "command quit"           - Quit application

VOICE CONTROL:
  "command voice off"      - Turn off TTS
  "command voice on"       - Turn on TTS
  "command read again"     - Re-read last response
`.trim();
}

/**
 * Normalize common Whisper transcription variations
 */
function normalizeTranscription(text: string): string {
  return text
    // Workstream variations (Whisper often garbles this)
    .replace(/works?\s*str[eai]*[mn]e?/gi, 'workstream')  // workstreme, workstram, workstrcme
    .replace(/work\s*strc?m/gi, 'workstream')             // workstrcm
    .replace(/works?\s+stream/gi, 'workstream')           // work stream, works stream
    .replace(/work\s+space/gi, 'workspace')
    .replace(/workspace/gi, 'workstream')                  // workspace -> workstream
    // General chat
    .replace(/gen(?:eral)?\s+chat/gi, 'general chat')
    // Numbers (spoken as words)
    .replace(/\bone\b/gi, '1')
    .replace(/\btwo\b/gi, '2')
    .replace(/\bthree\b/gi, '3')
    .replace(/\bfour\b/gi, '4')
    .replace(/\bfive\b/gi, '5')
    .replace(/\bsix\b/gi, '6')
    .replace(/\bseven\b/gi, '7')
    .replace(/\beight\b/gi, '8')
    .replace(/\bnine\b/gi, '9')
    .replace(/\bten\b/gi, '10')
    // Common word mishearings
    .replace(/\btask\b/gi, 'tasks')
    .replace(/\btest\b/gi, 'tasks');
}

/**
 * Provide fuzzy matching for commands when exact match fails
 * This helps with speech recognition inaccuracies
 */
export function suggestCommand(text: string): string | null {
  if (!isCommand(text)) {
    return null;
  }

  const commandText = text.replace(/^command[,.:;]?\s+/i, '').trim().toLowerCase();
  
  // Simple suggestions based on common misheard words
  const suggestions: Record<string, string> = {
    'sand': 'send',
    'cent': 'send',
    'sent': 'send',
    'cancelled': 'cancel',
    'candle': 'cancel',
    'stopped': 'stop',
    'work stream': 'workstream',
    'works stream': 'workstream',
    'work streams': 'workstreams',
    'test': 'tasks',
    'task': 'tasks',
    'advise': 'advice',
    'copied': 'copy',
    'copying': 'copy',
    'link': 'links',
    'helped': 'help',
    'scroll': 'scroll up',
    'quite': 'quit',
    'quick': 'quit',
    'exit': 'quit',
    'voice of': 'voice off',
    'boys off': 'voice off',
    'voice own': 'voice on',
    'red again': 'read again',
    'reed again': 'read again',
    'command': 'commands',
    'commends': 'commands',
  };

  return suggestions[commandText] || null;
}

// Export normalize function for use in parseVoiceCommand
export { normalizeTranscription };

