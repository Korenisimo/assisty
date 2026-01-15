// Cursor CLI integration for non-interactive agent orchestration
// Uses `cursor agent -p` for programmatic control with streaming output

import { spawn, execSync, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Platform, getAppConfigDir, ShellService } from '../../utils/platform/index.js';

/**
 * Spawn a process outside of Cursor's macOS sandbox.
 * When running inside Cursor IDE:
 * 1. Processes inherit a restrictive seatbelt sandbox that blocks auth credential access
 * 2. cursor-agent expects stdin to be inherited (hangs if stdin is 'ignore')
 * 
 * This function:
 * - Uses sandbox-exec to escape the sandbox restrictions
 * - Ensures stdin is inherited so cursor-agent doesn't hang waiting for TTY
 */
function spawnOutsideSandbox(
  command: string,
  args: string[],
  options: SpawnOptions
) {
  // Check if we're running inside Cursor's sandbox on macOS
  const isInCursorSandbox = process.platform === 'darwin' && process.env.CURSOR_SANDBOX === 'seatbelt';
  
  // Clean env vars (remove sandbox markers so child doesn't think it's sandboxed)
  const cleanEnv = { ...process.env };
  delete cleanEnv.CURSOR_SANDBOX;
  delete cleanEnv.CURSOR_AGENT;
  
  // CRITICAL: cursor-agent hangs if stdin is 'ignore' - must inherit stdin for TTY detection
  // Override stdio to ensure stdin is inherited while keeping stdout/stderr as pipes
  const stdioCfg = options.stdio;
  let fixedStdio: SpawnOptions['stdio'];
  if (Array.isArray(stdioCfg)) {
    // Replace 'ignore' with 'inherit' for stdin (index 0)
    fixedStdio = [stdioCfg[0] === 'ignore' ? 'inherit' : stdioCfg[0], stdioCfg[1], stdioCfg[2]];
  } else if (stdioCfg === 'pipe' || stdioCfg === 'ignore' || stdioCfg === undefined) {
    // Default: inherit stdin, pipe stdout/stderr
    fixedStdio = ['inherit', 'pipe', 'pipe'];
  } else {
    fixedStdio = stdioCfg;
  }
  
  if (isInCursorSandbox) {
    // Use sandbox-exec to escape the sandbox for auth access
    const sandboxProfile = '(version 1)(allow default)';
    return spawn('sandbox-exec', ['-p', sandboxProfile, command, ...args], {
      ...options,
      stdio: fixedStdio,
      env: { ...cleanEnv, ...options.env },
    });
  } else {
    // Not in sandbox, but STILL need to fix stdio - cursor-agent hangs without inherited stdin
    return spawn(command, args, {
      ...options,
      stdio: fixedStdio,
      env: { ...cleanEnv, ...options.env },
    });
  }
}

// Module-level progress callback for TUI integration
// Changed to include workstreamId to prevent cross-workstream message bleeding
let _cursorProgressCallback: ((message: string, workstreamId: string | null) => void) | null = null;

// Config file location for storing custom Cursor CLI path
// Uses platform-appropriate config directory (AppData on Windows, Library/Application Support on macOS, etc.)
const CURSOR_CONFIG_FILE = path.join(getAppConfigDir('hn-cli'), 'cursor-config.json');

interface CursorConfig {
  cliPath?: string;
}

function loadCursorConfig(): CursorConfig {
  try {
    if (fs.existsSync(CURSOR_CONFIG_FILE)) {
      const data = fs.readFileSync(CURSOR_CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch { /* ignore */ }
  return {};
}

function saveCursorConfig(config: CursorConfig): void {
  try {
    fs.writeFileSync(CURSOR_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save Cursor config:', err);
  }
}

/**
 * Set a progress callback for Cursor output
 * This routes all Cursor output through the TUI instead of stdout
 * Callback receives (message, sourceWorkstreamId) so TUI can filter by workstream
 */
export function setCursorProgressCallback(callback: ((message: string, workstreamId: string | null) => void) | null): void {
  _cursorProgressCallback = callback;
}

/**
 * Comprehensive ANSI/terminal escape code stripping
 * Handles colors, cursor movement, line clearing, etc.
 */
function stripAllTerminalCodes(text: string): string {
  // Remove all ANSI escape sequences including:
  // - Color codes: \x1b[...m
  // - Cursor movement: \x1b[...A/B/C/D/H/f
  // - Line operations: \x1b[...K/J
  // - OSC sequences: \x1b]...
  // - Various control sequences
  return text
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')  // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences
    .replace(/\x1b[78]/g, '')                // Save/restore cursor
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')    // Private mode set/reset
    .replace(/\x1b[=>]/g, '')                // Keypad mode
    .replace(/\r/g, '')                      // Carriage returns
    .replace(/\x07/g, '');                   // Bell character
}

// Track current workstream for cursorLog context
let _currentCursorWorkstreamId: string | null = null;

/**
 * Set the current workstream context for cursor logging
 */
export function setCursorLogWorkstream(workstreamId: string | null): void {
  _currentCursorWorkstreamId = workstreamId;
}

/**
 * Log Cursor output - goes to TUI if callback set, otherwise stdout
 * Includes workstream ID so TUI can filter messages to correct workstream
 */
function cursorLog(message: string, workstreamId?: string | null): void {
  // Use provided workstreamId or fall back to current context
  const wsId = workstreamId !== undefined ? workstreamId : _currentCursorWorkstreamId;
  
  if (_cursorProgressCallback) {
    // Clean the message before sending to TUI
    const cleaned = stripAllTerminalCodes(message);
    if (cleaned.trim()) {
      _cursorProgressCallback(cleaned, wsId);
    }
  } else {
    console.log(message);
  }
}

/**
 * Get platform-specific Cursor CLI path candidates
 * Returns paths in priority order for the current platform
 */
function getCursorCliCandidates(): string[] {
  if (Platform.isWindows) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const userProfile = process.env.USERPROFILE || '';
    
    return [
      'cursor',  // In PATH
      'cursor-agent',  // In PATH
      path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(localAppData, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.exe'),
      path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
      path.join(programFiles, 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(programFiles, 'Cursor', 'resources', 'app', 'bin', 'cursor.exe'),
      path.join(programFiles, 'Cursor', 'Cursor.exe'),
      path.join(programFilesX86, 'Cursor', 'Cursor.exe'),
      path.join(userProfile, 'AppData', 'Local', 'Programs', 'Cursor', 'Cursor.exe'),
    ];
  } else if (Platform.isMacOS) {
    const home = process.env.HOME || '';
    return [
      'cursor-agent',  // In PATH
      'cursor',  // In PATH
      '/usr/local/bin/cursor-agent',
      '/opt/homebrew/bin/cursor-agent',  // Homebrew on Apple Silicon
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      '/usr/local/bin/cursor',
      path.join(home, '.local/bin/cursor'),
      '/opt/homebrew/bin/cursor',
      path.join(home, 'Applications/Cursor.app/Contents/Resources/app/bin/cursor'),  // User-installed
    ];
  } else {
    // Linux
    const home = process.env.HOME || '';
    return [
      'cursor-agent',  // In PATH
      'cursor',  // In PATH
      '/usr/local/bin/cursor-agent',
      '/usr/local/bin/cursor',
      '/usr/bin/cursor',
      path.join(home, '.local/bin/cursor'),
      '/snap/bin/cursor',  // Snap package
      '/opt/cursor/cursor',  // Custom install location
    ];
  }
}

// Get candidates for current platform
const CURSOR_CLI_CANDIDATES = getCursorCliCandidates();

// Verify a cursor CLI path actually works
function verifyCursorCli(cliPath: string): boolean {
  try {
    // On Windows, .cmd files need to be run through cmd.exe
    if (Platform.isWindows && cliPath.endsWith('.cmd')) {
      execSync(`cmd /c "${cliPath}" --version`, { 
        encoding: 'utf-8', 
        stdio: ['pipe', 'pipe', 'pipe'], 
        timeout: 5000,
        windowsHide: true,
      });
    } else {
      // Try to run --version to verify it works
      execSync(`"${cliPath}" --version`, { 
        encoding: 'utf-8', 
        stdio: ['pipe', 'pipe', 'pipe'], 
        timeout: 5000,
        windowsHide: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}

// Find Cursor CLI path dynamically
function findCursorCli(): string | null {
  // Check config file first for manually set path
  const config = loadCursorConfig();
  if (config.cliPath && fs.existsSync(config.cliPath)) {
    return config.cliPath;
  }
  
  // Check if 'cursor-agent' or 'cursor' is in PATH using cross-platform detection
  for (const cmd of ['cursor-agent', 'cursor']) {
    if (ShellService.commandExists(cmd)) {
      // Try to get full path using platform-appropriate command
      try {
        const command = Platform.isWindows ? `where ${cmd}` : `which ${cmd}`;
        const pathResult = execSync(command, { 
          encoding: 'utf-8', 
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        }).trim().split('\n')[0]; // Windows 'where' returns multiple lines
        
        if (pathResult && fs.existsSync(pathResult) && verifyCursorCli(pathResult)) {
          return pathResult;
        }
      } catch {
        // Couldn't get full path, but command exists - try bare name
        if (verifyCursorCli(cmd)) {
          return cmd;
        }
      }
    }
  }
  
  // Check known locations for current platform
  for (const candidate of CURSOR_CLI_CANDIDATES) {
    // For bare command names (like 'cursor-agent'), just verify they work
    const isBareName = Platform.isWindows 
      ? !candidate.includes('\\') && !candidate.includes('/')
      : !candidate.includes('/');
    
    if (isBareName) {
      if (verifyCursorCli(candidate)) {
        return candidate;
      }
    } else if (fs.existsSync(candidate) && verifyCursorCli(candidate)) {
      return candidate;
    }
  }
  
  // On macOS, try to locate via Spotlight (mdfind)
  if (Platform.isMacOS) {
    try {
      const appPaths = execSync('mdfind "kMDItemCFBundleIdentifier == com.cursor.Cursor"', 
                               { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
        .trim()
        .split('\n')
        .filter(p => p.length > 0);
      
      for (const appPath of appPaths) {
        const cliPath = appPath + '/Contents/Resources/app/bin/cursor';
        if (fs.existsSync(cliPath) && verifyCursorCli(cliPath)) {
          return cliPath;
        }
      }
    } catch { /* mdfind failed */ }
  }
  
  // On Windows, try to find Cursor in registry or common install locations
  if (Platform.isWindows) {
    try {
      // Try to find via registry query (Cursor adds uninstall info)
      const regQuery = execSync(
        'reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cursor" /v InstallLocation',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
      );
      const match = regQuery.match(/InstallLocation\s+REG_SZ\s+(.+)/);
      if (match) {
        const installPath = match[1].trim();
        const cliPath = path.join(installPath, 'resources', 'app', 'bin', 'cursor.cmd');
        if (fs.existsSync(cliPath) && verifyCursorCli(cliPath)) {
          return cliPath;
        }
      }
    } catch { /* Registry query failed */ }
  }
  
  return null;
}

// Cache the result
let _cursorCli: string | null | undefined;
function getCursorCli(): string | null {
  if (_cursorCli === undefined) _cursorCli = findCursorCli();
  return _cursorCli;
}

/**
 * Manually set the Cursor CLI path
 * Useful when auto-detection fails
 */
export function setCursorCliPath(cliPath: string): { success: boolean; error?: string } {
  if (!fs.existsSync(cliPath)) {
    return { success: false, error: `Path does not exist: ${cliPath}` };
  }
  
  // Save to config
  saveCursorConfig({ cliPath });
  
  // Invalidate cache so it picks up the new path
  _cursorCli = undefined;
  
  // Verify it worked
  const detected = getCursorCli();
  if (detected === cliPath) {
    return { success: true };
  } else {
    return { success: false, error: 'Path was saved but detection still failed' };
  }
}

// Error message for when Cursor is not found
export function getCursorNotFoundError(): string {
  return `Cursor CLI not found. This is an environment issue, not a tool error.
Checked locations:
${CURSOR_CLI_CANDIDATES.map(p => `  - ${p}`).join('\n')}

To fix:
1. Make sure Cursor is installed
2. If installed, use cursor_set_cli_path to manually configure the path
3. Or add 'cursor' to your system PATH

Fallback options:
- I can try to implement the changes myself (slower, less code-aware)
- I can create detailed implementation notes for you to work from
- You can configure the path and retry

Which approach would you prefer?`;
}

// Helper to get CLI path dynamically - always re-checks in case setCursorCliPath was called
function getCursorCliOrThrow(): string {
  const cli = getCursorCli();
  if (!cli) {
    throw new Error('Cursor CLI not found. Use cursor_set_cli_path to configure it.');
  }
  return cli;
}

// Fallback for when we want to try anyway (for --version checks, etc.)
function getCursorCliOrFallback(): string {
  return getCursorCli() || CURSOR_CLI_CANDIDATES[0];
}

// Check if the CLI is 'cursor-agent' style (doesn't need 'agent' subcommand)
// vs 'cursor' style (needs 'agent' subcommand)
function needsAgentSubcommand(cliPath: string): boolean {
  // cursor-agent IS the agent command, so no 'agent' subcommand needed
  // cursor requires 'agent' subcommand
  // Handle both Unix (/) and Windows (\) path separators
  const basename = path.basename(cliPath);
  return !basename.includes('cursor-agent');
}

// Get args array with or without 'agent' prefix based on CLI type
function getAgentArgs(cliPath: string, subArgs: string[]): string[] {
  if (needsAgentSubcommand(cliPath)) {
    return ['agent', ...subArgs];
  }
  return subArgs;
}

/**
 * Invoke Cursor CLI with proper handling for Windows .cmd files
 * On Windows, .cmd files must be executed through cmd.exe
 */
function invokeCursorCli(
  cliPath: string, 
  args: string[], 
  options: SpawnOptions
): ReturnType<typeof spawnOutsideSandbox> {
  if (Platform.isWindows && cliPath.endsWith('.cmd')) {
    // On Windows, .cmd files need to be run through cmd.exe
    // Use /c to run command and terminate
    return spawnOutsideSandbox('cmd', ['/c', cliPath, ...args], options);
  }
  
  // Default behavior for macOS/Linux or Windows .exe
  return spawnOutsideSandbox(cliPath, args, options);
}

// Session tracking interface
interface CursorSession {
  chatId: string;
  workspace: string;
  startedAt: number;
  lastResponse: CursorResponse | null;
  processId?: number;  // Track the actual spawned process
  isRunning: boolean;  // Track if we believe the process is still running
  fullLog: string[];   // Full log of all output for log viewer
  prompt?: string;     // The prompt sent to Cursor
  heartbeatInterval?: NodeJS.Timeout;  // Track heartbeat so we can clear on new session
}

// Active session tracking - PER WORKSTREAM
// Map of workstreamId -> session
const activeCursorSessions = new Map<string, CursorSession>();

// Default workstream ID for backward compatibility (when no workstream context)
const DEFAULT_WORKSTREAM_ID = '__default__';

// Helper functions for session management
function getSession(workstreamId?: string): CursorSession | null {
  const id = workstreamId || DEFAULT_WORKSTREAM_ID;
  return activeCursorSessions.get(id) || null;
}

function setSession(session: CursorSession, workstreamId?: string): void {
  const id = workstreamId || DEFAULT_WORKSTREAM_ID;
  activeCursorSessions.set(id, session);
}

function deleteSession(workstreamId?: string): void {
  const id = workstreamId || DEFAULT_WORKSTREAM_ID;
  activeCursorSessions.delete(id);
}

function getAllSessions(): Map<string, CursorSession> {
  return activeCursorSessions;
}

// Progress callback for streaming updates
export type CursorProgressCallback = (update: CursorProgressUpdate) => void;

export interface CursorProgressUpdate {
  type: 'thinking' | 'tool_call' | 'output' | 'error' | 'complete';
  content: string;
  toolName?: string;
  timestamp: number;
}

// Response from Cursor agent
export interface CursorResponse {
  success: boolean;
  chatId?: string;
  output: string;
  error?: string;
  // Parsed from JSON output if available
  actions?: string[];
  filesModified?: string[];
}

export interface CursorAgentOptions {
  workspace: string;
  chatId?: string;        // For --resume
  model?: string;         // e.g., 'sonnet-4', 'gpt-5'
  timeout?: number;       // Default: 5 minutes (300000ms)
  force?: boolean;        // --force flag for auto-approving commands
  onProgress?: CursorProgressCallback;  // Streaming progress updates
}

// ANSI escape codes for terminal styling
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  clearLine: '\x1b[2K',
  cursorUp: (n: number) => `\x1b[${n}A`,
  cursorDown: (n: number) => `\x1b[${n}B`,
};

// Box drawing characters
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
};

/**
 * Render a progress box to the terminal
 */
export function renderProgressBox(
  title: string,
  lines: string[],
  width: number = 60
): string {
  const innerWidth = width - 2;
  const titleText = ` ${title} `;
  const titlePadding = Math.max(0, innerWidth - titleText.length);
  const leftPad = Math.floor(titlePadding / 2);
  const rightPad = titlePadding - leftPad;

  const output: string[] = [];
  
  // Top border with title
  output.push(
    `${ANSI.cyan}${BOX.topLeft}${BOX.horizontal.repeat(leftPad)}${ANSI.bold}${titleText}${ANSI.reset}${ANSI.cyan}${BOX.horizontal.repeat(rightPad)}${BOX.topRight}${ANSI.reset}`
  );
  
  // Content lines
  for (const line of lines) {
    const truncated = line.length > innerWidth ? line.substring(0, innerWidth - 3) + '...' : line;
    const padding = ' '.repeat(Math.max(0, innerWidth - truncated.length));
    output.push(`${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${truncated}${padding}${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);
  }
  
  // Bottom border
  output.push(
    `${ANSI.cyan}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.bottomRight}${ANSI.reset}`
  );
  
  return output.join('\n');
}

/**
 * Create a live updating progress display
 */
export class CursorProgressDisplay {
  private lines: string[] = [];
  private title: string;
  private width: number;
  private lastLineCount: number = 0;
  private startTime: number;
  
  constructor(title: string = 'Cursor Agent', width: number = 60) {
    this.title = title;
    this.width = width;
    this.startTime = Date.now();
    this.lines = ['Starting...'];
  }
  
  /**
   * Update the display with new content
   */
  update(update: CursorProgressUpdate): void {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const timeStr = `${ANSI.dim}[${elapsed}s]${ANSI.reset}`;
    
    let newLine: string;
    switch (update.type) {
      case 'thinking':
        newLine = `${ANSI.yellow}⋯${ANSI.reset} ${update.content}`;
        break;
      case 'tool_call':
        newLine = `${ANSI.green}→${ANSI.reset} ${update.toolName || 'tool'}: ${update.content}`;
        break;
      case 'output':
        newLine = `  ${update.content}`;
        break;
      case 'error':
        newLine = `${ANSI.red}✗${ANSI.reset} ${update.content}`;
        break;
      case 'complete':
        newLine = `${ANSI.green}✓${ANSI.reset} ${update.content}`;
        break;
      default:
        newLine = update.content;
    }
    
    // Keep last 5 lines for display
    this.lines.push(newLine);
    if (this.lines.length > 5) {
      this.lines.shift();
    }
    
    this.render();
  }
  
  /**
   * Render the box to stdout
   */
  private render(): void {
    // Move cursor up to overwrite previous box
    if (this.lastLineCount > 0) {
      process.stdout.write(ANSI.cursorUp(this.lastLineCount));
    }
    
    // Clear and write new content
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const titleWithTime = `${this.title} (${elapsed}s)`;
    const box = renderProgressBox(titleWithTime, this.lines, this.width);
    const boxLines = box.split('\n');
    
    for (const line of boxLines) {
      process.stdout.write(ANSI.clearLine + line + '\n');
    }
    
    this.lastLineCount = boxLines.length;
  }
  
  /**
   * Clear the display
   */
  clear(): void {
    if (this.lastLineCount > 0) {
      process.stdout.write(ANSI.cursorUp(this.lastLineCount));
      for (let i = 0; i < this.lastLineCount; i++) {
        process.stdout.write(ANSI.clearLine + '\n');
      }
      process.stdout.write(ANSI.cursorUp(this.lastLineCount));
    }
  }
}

/**
 * Run the Cursor agent with a prompt in non-interactive mode
 * Returns the agent's response with optional streaming progress
 */
export async function runCursorAgent(
  prompt: string,
  options: CursorAgentOptions,
  workstreamId?: string
): Promise<CursorResponse> {
  const {
    workspace,
    chatId,
    model,
    timeout = 3600000, // 1 hour default (increased from 5 minutes to allow long-running tasks)
    force = false,
    onProgress,
  } = options;

  // Build command args - use streaming JSON for progress updates
  // Note: -p/--print is a boolean flag, prompt goes at the end as positional arg
  const cli = getCursorCliOrThrow();
  const args = getAgentArgs(cli, ['--print', '--workspace', workspace]);
  
  if (onProgress) {
    // Use streaming format when we have a progress callback
    args.push('--output-format', 'stream-json', '--stream-partial-output');
  } else {
    args.push('--output-format', 'json');
  }
  
  if (chatId) {
    args.push('--resume', chatId);
  }
  
  if (model) {
    args.push('--model', model);
  }
  
  if (force) {
    args.push('--force');
  }
  
  // Prompt goes at the end as a positional argument
  args.push(prompt);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let collectedOutput = '';
    let extractedChatId: string | undefined;

    const proc = invokeCursorCli(cli, args, {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin - CLI doesn't need input
      detached: true,  // Create new process group to avoid receiving parent's SIGINT
    });

    // Track the process immediately
    if (proc.pid) {
      const existingSession = getSession(workstreamId);
      const tempSession = existingSession || {
        chatId: chatId || 'unknown',
        workspace,
        startedAt: Date.now(),
        lastResponse: null,
        isRunning: true,
        fullLog: [`[Prompt] ${prompt}`],
        prompt,
      };
      setSession({
        ...tempSession,
        processId: proc.pid,
        isRunning: true,
        fullLog: tempSession.fullLog || [`[Prompt] ${prompt}`],
        prompt: tempSession.prompt || prompt,
      }, workstreamId);
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      onProgress?.({
        type: 'error',
        content: `Timed out after ${timeout / 1000} seconds`,
        timestamp: Date.now(),
      });
      // Log timeout to fullLog
      const session = getSession(workstreamId);
      if (session) {
        session.fullLog.push(`[Error] Timed out after ${timeout / 1000} seconds`);
      }
    }, timeout);

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      
      // Append to fullLog
      const session = getSession(workstreamId);
      if (session) {
        session.fullLog.push(chunk.trim());
      }
      
      if (onProgress) {
        // Parse streaming JSON - each line is a JSON object
        const lines = chunk.split('\n').filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            
            // Extract chatId if present
            if (event.chatId) {
              extractedChatId = event.chatId;
            }
            
            // Map event types to progress updates
            if (event.type === 'thinking' || event.type === 'reasoning') {
              onProgress({
                type: 'thinking',
                content: event.content || event.text || 'Thinking...',
                timestamp: Date.now(),
              });
            } else if (event.type === 'tool_call' || event.type === 'tool_use') {
              onProgress({
                type: 'tool_call',
                content: event.input?.substring?.(0, 50) || event.args?.substring?.(0, 50) || '',
                toolName: event.name || event.tool,
                timestamp: Date.now(),
              });
            } else if (event.type === 'tool_result') {
              const preview = (event.output || event.result || '').substring(0, 80);
              onProgress({
                type: 'output',
                content: preview + (preview.length >= 80 ? '...' : ''),
                timestamp: Date.now(),
              });
            } else if (event.type === 'text' || event.type === 'content') {
              collectedOutput += event.text || event.content || '';
              onProgress({
                type: 'output',
                content: (event.text || event.content || '').substring(0, 60),
                timestamp: Date.now(),
              });
            } else if (event.type === 'error') {
              onProgress({
                type: 'error',
                content: event.message || event.error || 'Unknown error',
                timestamp: Date.now(),
              });
            } else if (event.output || event.response) {
              // Final output
              collectedOutput = event.output || event.response || collectedOutput;
            }
          } catch {
            // Not JSON, might be partial or plain text
            if (line.trim()) {
              collectedOutput += line;
            }
          }
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      onProgress?.({
        type: 'error',
        content: data.toString().substring(0, 100),
        timestamp: Date.now(),
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        resolve({
          success: false,
          output: collectedOutput || stdout,
          error: `Cursor agent timed out after ${timeout / 1000} seconds`,
        });
        return;
      }

      // Try to parse final JSON response (for non-streaming mode)
      let parsed: Record<string, unknown> | null = null;
      if (!onProgress) {
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // Not JSON, use raw output
        }
      }

      if (code !== 0 && !stdout && !collectedOutput) {
        onProgress?.({
          type: 'error',
          content: stderr || `Exited with code ${code}`,
          timestamp: Date.now(),
        });
        resolve({
          success: false,
          output: stderr || `Cursor agent exited with code ${code}`,
          error: stderr || `Exit code: ${code}`,
        });
        return;
      }

      // Extract chatId from response if present
      const responseChatId = extractedChatId || parsed?.chatId as string | undefined;
      
      // Update active session
      if (responseChatId) {
        const existingSession = getSession(workstreamId);
        setSession({
          chatId: responseChatId,
          workspace,
          startedAt: existingSession?.startedAt || Date.now(),
          lastResponse: null, // Will be set below
          processId: existingSession?.processId,
          isRunning: false,  // Process has completed
          fullLog: existingSession?.fullLog || [],
          prompt: existingSession?.prompt,
        }, workstreamId);
      }

      const finalOutput = collectedOutput || parsed?.output as string || parsed?.response as string || stdout;

      const response: CursorResponse = {
        success: code === 0,
        chatId: responseChatId || chatId,
        output: finalOutput,
        actions: parsed?.actions as string[] | undefined,
        filesModified: parsed?.filesModified as string[] | undefined,
      };

      // Store in session
      const session = getSession(workstreamId);
      if (session) {
        session.lastResponse = response;
      }

      onProgress?.({
        type: 'complete',
        content: code === 0 ? 'Completed successfully' : `Finished with code ${code}`,
        timestamp: Date.now(),
      });

      resolve(response);
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      
      // Mark session as not running on error
      const session = getSession(workstreamId);
      if (session) {
        session.isRunning = false;
      }
      
      onProgress?.({
        type: 'error',
        content: `Failed to spawn: ${err.message}`,
        timestamp: Date.now(),
      });
      resolve({
        success: false,
        output: '',
        error: `Failed to spawn Cursor agent: ${err.message}`,
      });
    });
  });
}

/**
 * Start a new Cursor session with an initial prompt
 * Optionally provide onProgress for live streaming display
 * @param workstreamId - Optional workstream ID for session isolation
 */
export async function startCursorSession(
  prompt: string,
  workspace: string,
  options?: Partial<Omit<CursorAgentOptions, 'workspace' | 'chatId'>>,
  workstreamId?: string
): Promise<CursorResponse> {
  // Clear any existing session for this workstream
  deleteSession(workstreamId);
  
  // Create a chat ID first so we can resume later
  const chatId = await createChatId(workspace);
  
  const response = await runCursorAgent(prompt, {
    workspace,
    chatId: chatId || undefined,
    ...options,
  }, workstreamId);
  
  return response;
}

/**
 * Start a Cursor session with live progress display in the terminal
 * Uses raw output passthrough for maximum compatibility
 * @param workstreamId - Optional workstream ID for session isolation
 */
export async function startCursorSessionWithProgress(
  prompt: string,
  workspace: string,
  options?: Partial<Omit<CursorAgentOptions, 'workspace' | 'chatId' | 'onProgress'> & { skipValidation?: boolean }>,
  workstreamId?: string
): Promise<CursorResponse> {
  // NEW: Validate unless explicitly told to skip
  if (!options?.skipValidation) {
    const validation = validateNoOrphanedSession(workstreamId);
    if (!validation.valid) {
      return {
        success: false,
        chatId: validation.chatId || '',
        output: '',
        error: validation.reason || 'Session validation failed',
      };
    }
  }
  
  // Clear any existing session for this workstream
  deleteSession(workstreamId);
  
  // Create a chat ID first so we can resume later
  const chatId = await createChatId(workspace);
  
  // Print header - pass workstreamId to route to correct workstream
  cursorLog(`Starting Cursor Agent...`, workstreamId);
  cursorLog(`Workspace: ...${workspace.slice(-38)}`, workstreamId);
  if (chatId) {
    cursorLog(`Chat ID: ${chatId.slice(0, 8)}...`, workstreamId);
  }
  
  const startTime = Date.now();
  
  // Use simpler text output mode - just pass through what Cursor outputs
  // Pass the chatId so we can resume this session later
  const response = await runCursorAgentRaw(prompt, {
    workspace,
    chatId: chatId || undefined,
    ...options,
  }, workstreamId);
  
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  cursorLog(`Cursor finished in ${totalTime}s`, workstreamId);
  
  return response;
}

/**
 * Run Cursor agent with raw output passthrough (simpler, more reliable)
 */
async function runCursorAgentRaw(
  prompt: string,
  options: Omit<CursorAgentOptions, 'onProgress'>,
  workstreamId?: string
): Promise<CursorResponse> {
  const {
    workspace,
    chatId,
    model,
    timeout = 3600000, // 1 hour default (increased from 5 minutes to allow long-running tasks)
    force = true,  // Default to true for automated/headless use - auto-approve actions
  } = options;

  // Get CLI path and build args based on CLI type
  const cli = getCursorCliOrThrow();
  
  // Use stream-json format to see thinking/tool calls as they happen
  // This allows us to show progress and reset timeout on any activity
  // Note: -p/--print is a boolean flag, prompt goes at the end as positional arg
  const subArgs = ['--print', '--workspace', workspace, '--output-format', 'stream-json', '--stream-partial-output'];
  
  if (chatId) {
    subArgs.push('--resume', chatId);
  }
  
  if (model) {
    subArgs.push('--model', model);
  }
  
  if (force) {
    subArgs.push('--force');
  }
  
  // Always approve MCP servers in headless mode
  subArgs.push('--approve-mcps');
  
  // Prompt goes at the end as a positional argument
  subArgs.push(prompt);
  
  const args = getAgentArgs(cli, subArgs);
  
  // DEBUG: Log to file AND to fullLog for Ctrl+L viewer
  const debugLog: string[] = [];
  debugLog.push(`[DEBUG] CLI path: ${cli}`);
  debugLog.push(`[DEBUG] Args: ${JSON.stringify(args)}`);
  debugLog.push(`[DEBUG] Full command: ${cli} ${args.join(' ')}`);
  
  // Write debug to file
  const debugFile = '/tmp/cursor-debug.log';
  fs.appendFileSync(debugFile, `\n--- ${new Date().toISOString()} ---\n${debugLog.join('\n')}\n`);

  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let lastActivityTime = Date.now();
    let hasReceivedOutput = false;

    const proc = invokeCursorCli(cli, args, {
      cwd: workspace,
      env: { 
        // Disable fancy terminal output from Cursor
        TERM: 'dumb',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin - CLI doesn't need input
      detached: true,  // Create new process group to avoid receiving parent's SIGINT
    });

    const startTime = Date.now();

    // CRITICAL: Clear any existing heartbeat from previous session to prevent duplicate timers
    const existingSession = getSession(workstreamId);
    if (existingSession?.heartbeatInterval) {
      clearInterval(existingSession.heartbeatInterval);
    }

    // Track the process immediately
    if (proc.pid) {
      const tempSession = existingSession || {
        chatId: chatId || 'unknown',
        workspace,
        startedAt: Date.now(),
        lastResponse: null,
        isRunning: true,
        fullLog: [`[Prompt] ${prompt}`],
        prompt,
      };
      setSession({
        ...tempSession,
        processId: proc.pid,
        isRunning: true,
        fullLog: tempSession.fullLog || [`[Prompt] ${prompt}`],
        prompt: tempSession.prompt || prompt,
        heartbeatInterval: undefined, // Will be set below
      }, workstreamId);
    }

    // Show initial startup message once (not repeated)
    // Pass workstreamId so message goes to correct workstream
    cursorLog(`⏳ Cursor starting up...`, workstreamId);
    
    // Log startup AND debug info to fullLog (visible in Ctrl+L)
    const sessionForLog = getSession(workstreamId);
    if (sessionForLog) {
      sessionForLog.fullLog.push('[Status] Cursor starting up...');
      sessionForLog.fullLog.push(`[DEBUG] CLI: ${cli}`);
      sessionForLog.fullLog.push(`[DEBUG] Command: ${cli} ${args.join(' ')}`);
    }
    
    // Capture workstreamId in closure for heartbeat
    const heartbeatWorkstreamId = workstreamId;
    
    // Inactivity timeout - if no output received within this time, abort early
    // This catches cases where cursor-agent hangs silently (e.g., stale session, network issues)
    // Note: Complex tasks on large codebases can take 2-3+ minutes to produce first output
    const INACTIVITY_TIMEOUT_MS = 900000;  // 900 seconds (15 minutes, increased from 3 minutes to allow long-running tasks)
    let inactivityTriggered = false;
    
    // Heartbeat timer - show progress every 30 seconds AND check for inactivity
    const heartbeatInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const timeSinceActivity = Math.floor((Date.now() - lastActivityTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      
      if (!hasReceivedOutput) {
        // Check for inactivity timeout - no output received yet
        if ((Date.now() - startTime) > INACTIVITY_TIMEOUT_MS && !inactivityTriggered) {
          inactivityTriggered = true;
          timedOut = true;
          clearTimeout(timeoutId);
          clearInterval(heartbeatInterval);
          proc.kill('SIGTERM');
          cursorLog(`✗ No response from Cursor after ${INACTIVITY_TIMEOUT_MS / 1000}s - session may be stale. Try again.`, heartbeatWorkstreamId);
          
          // Log the error to fullLog before clearing session
          const session = getSession(workstreamId);
          if (session) {
            session.fullLog.push(`[Error] Inactivity timeout - no output received after ${INACTIVITY_TIMEOUT_MS / 1000}s`);
          }
          
          // Clear the session completely so next attempt starts fresh without --resume
          deleteSession(workstreamId);
          return;
        }
        // Still waiting for first output - show waiting status
        cursorLog(`⏳ Waiting for Cursor response... (${timeStr})`, heartbeatWorkstreamId);
      } else if (timeSinceActivity > 15) {
        cursorLog(`⏳ Cursor working... (${timeStr}, ${timeSinceActivity}s since last output)`, heartbeatWorkstreamId);
      } else {
        cursorLog(`⏳ Cursor working... (${timeStr})`, heartbeatWorkstreamId);
      }
    }, 10000);  // Every 10 seconds (faster checking for inactivity)
    
    // Store heartbeat in session so it can be cleared if a new session starts
    const currentSession = getSession(workstreamId);
    if (currentSession) {
      currentSession.heartbeatInterval = heartbeatInterval;
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      clearInterval(heartbeatInterval);
      proc.kill('SIGTERM');
      cursorLog(`✗ Timed out after ${timeout / 1000}s`, heartbeatWorkstreamId);
    }, timeout);

    // Stream stdout - parse stream-json format to show thinking/tool calls
    let jsonBuffer = '';  // Buffer for incomplete JSON lines
    let finalTextOutput = '';  // Accumulate the final text response
    let hasShownThinkingIndicator = false;  // Only show "Thinking..." once per thinking block
    
    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      jsonBuffer += chunk;
      lastActivityTime = Date.now();
      hasReceivedOutput = true;
      
      // DEBUG: Log to file
      fs.appendFileSync('/tmp/cursor-debug.log', `[stdout ${chunk.length}b]: ${chunk.substring(0, 200)}\n`);
      
      // Parse complete JSON lines from buffer
      const lines = jsonBuffer.split('\n');
      jsonBuffer = lines.pop() || '';  // Keep incomplete last line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const event = JSON.parse(line);
          const session = getSession(workstreamId);
          
          // Handle different event types from stream-json format
          if (event.type === 'thinking') {
            // Thinking output - just show indicator, don't flood the log
            // The activity still resets timeout (lastActivityTime already updated above)
            if (event.subtype === 'delta' && event.text) {
              // Only show "thinking..." indicator once, not every delta
              if (!hasShownThinkingIndicator) {
                hasShownThinkingIndicator = true;
                
                if (session) {
                  session.fullLog.push(`💭 Thinking...`);
                }
                
                if (_cursorProgressCallback) {
                  _cursorProgressCallback(`💭 Thinking...`, workstreamId ?? null);
                } else {
                  console.log(`💭 Thinking...`);
                }
              }
              // Still count thinking content for debugging (in debug log only)
              fs.appendFileSync('/tmp/cursor-debug.log', `[thinking]: ${event.text.substring(0, 100)}\n`);
            } else if (event.subtype === 'completed') {
              // Reset indicator so next thinking round shows again
              hasShownThinkingIndicator = false;
            }
          } else if (event.type === 'tool_call') {
            // Tool call - show what cursor is doing
            if (event.subtype === 'started' && event.tool_call) {
              // Extract tool name from tool_call object (e.g., readToolCall, editToolCall, etc.)
              const toolCallObj = event.tool_call;
              const toolName = Object.keys(toolCallObj).find(k => k.endsWith('ToolCall'))?.replace('ToolCall', '') || 'unknown';
              const toolMsg = `🔧 ${toolName}`;
              
              // Try to get the file path for read/edit operations
              const args = toolCallObj[Object.keys(toolCallObj)[0]]?.args;
              const path = args?.path || args?.filePath || '';
              const displayMsg = path ? `${toolMsg}: ${path}` : toolMsg;
              
              if (session) {
                session.fullLog.push(displayMsg);
              }
              
              if (_cursorProgressCallback) {
                _cursorProgressCallback(displayMsg, workstreamId ?? null);
              } else {
                console.log(displayMsg);
              }
            } else if (event.subtype === 'completed') {
              // Tool completed - brief acknowledgment
              if (session) {
                session.fullLog.push(`✓ done`);
              }
            }
          } else if (event.type === 'assistant') {
            // Assistant response streaming - extract text from message.content
            const content = event.message?.content;
            if (Array.isArray(content)) {
              for (const item of content) {
                if (item.type === 'text' && item.text) {
                  // Streaming text chunks - show them
                  const text = item.text;
                  finalTextOutput += text;
                  
                  if (session) {
                    session.fullLog.push(text);
                  }
                  
                  if (_cursorProgressCallback) {
                    const cleaned = stripAllTerminalCodes(text).trim();
                    if (cleaned) {
                      _cursorProgressCallback(cleaned, workstreamId ?? null);
                    }
                  } else {
                    process.stdout.write(text);
                  }
                }
              }
            }
          } else if (event.type === 'result') {
            // Final result - this has the complete response
            if (event.result) {
              output = event.result;  // Use final result as the output
              
              // Log completion status
              if (session) {
                session.fullLog.push(`\n[Completed in ${event.duration_ms}ms]`);
              }
            }
          } else if (event.type === 'error') {
            // Error from cursor
            const errorMsg = event.message || event.error || 'Unknown error';
            
            if (session) {
              session.fullLog.push(`❌ ${errorMsg}`);
            }
            
            if (_cursorProgressCallback) {
              _cursorProgressCallback(`❌ ${errorMsg}`, workstreamId ?? null);
            } else {
              console.error(`❌ ${errorMsg}`);
            }
          } else if (event.type === 'system' || event.type === 'user') {
            // System init or user message echo - ignore
          } else {
            // Unknown event type - log it for debugging but don't spam TUI
            fs.appendFileSync('/tmp/cursor-debug.log', `[unknown event]: ${JSON.stringify(event)}\n`);
          }
        } catch {
          // Not valid JSON - might be raw text output, show it
          const cleaned = stripAllTerminalCodes(line).trim();
          if (cleaned) {
            output += cleaned + '\n';
            finalTextOutput += cleaned + '\n';
            
            const session = getSession(workstreamId);
            if (session) {
              session.fullLog.push(cleaned);
            }
            
            if (_cursorProgressCallback) {
              _cursorProgressCallback(cleaned, workstreamId ?? null);
            } else {
              console.log(cleaned);
            }
          }
        }
      }
    });

    // Stream stderr - log errors through callback or direct to stderr
    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      // DEBUG: Log to file
      fs.appendFileSync('/tmp/cursor-debug.log', `[stderr]: ${chunk}\n`);
      if (_cursorProgressCallback) {
        // Clean and show errors in TUI mode
        const cleaned = stripAllTerminalCodes(chunk).trim();
        if (cleaned && !cleaned.match(/^(warning|warn|info):/i)) {
          // Only show actual errors, not warnings
          _cursorProgressCallback(`Error: ${cleaned}`, workstreamId ?? null);
        }
      } else {
        process.stderr.write(`${ANSI.red}${chunk}${ANSI.reset}`);
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatInterval);

      // Try to extract chatId from output (Cursor sometimes includes it)
      const chatIdMatch = output.match(/chat[_-]?id[:\s]+([a-zA-Z0-9-]+)/i);
      const extractedChatId = chatIdMatch?.[1];
      
      if (extractedChatId || chatId) {
        const existingSession = getSession(workstreamId);
        setSession({
          chatId: extractedChatId || chatId!,
          workspace,
          startedAt: existingSession?.startedAt || Date.now(),
          lastResponse: null,
          processId: existingSession?.processId,
          isRunning: false,  // Process has completed
          fullLog: existingSession?.fullLog || [],
          prompt: existingSession?.prompt,
          heartbeatInterval: undefined, // Clear reference
        }, workstreamId);
      }

      // Provide more helpful error messages
      let errorMsg: string | undefined;
      if (timedOut) {
        if (inactivityTriggered) {
          errorMsg = `Cursor produced no output for ${INACTIVITY_TIMEOUT_MS / 1000} seconds - session may be stale. The session was cleared, try cursor_start_task again.`;
        } else {
          errorMsg = `Timed out after ${timeout / 1000} seconds`;
        }
      } else if (code !== 0) {
        errorMsg = `Exit code: ${code}`;
      }
      
      const response: CursorResponse = {
        success: !timedOut && code === 0,
        chatId: extractedChatId || chatId,
        output: output,
        error: errorMsg,
      };

      const session = getSession(workstreamId);
      if (session) {
        session.lastResponse = response;
        session.fullLog.push(`[Status] Process completed with code ${code}`);
      }

      resolve(response);
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatInterval);
      
      // Mark session as not running on error
      const session = getSession(workstreamId);
      if (session) {
        session.isRunning = false;
      }
      
      cursorLog(`✗ Failed to start: ${err.message}`, workstreamId);
      resolve({
        success: false,
        output: '',
        error: `Failed to spawn Cursor agent: ${err.message}`,
      });
    });
  });
}

/**
 * Continue an existing Cursor session with a follow-up prompt
 * @param workstreamId - Optional workstream ID to continue specific workstream session
 */
export async function continueCursorSession(
  prompt: string,
  options?: Partial<Omit<CursorAgentOptions, 'workspace' | 'chatId'>>,
  workstreamId?: string
): Promise<CursorResponse> {
  const session = getSession(workstreamId);
  if (!session) {
    return {
      success: false,
      output: '',
      error: 'No active Cursor session. Use startCursorSession first.',
    };
  }
  
  const response = await runCursorAgent(prompt, {
    workspace: session.workspace,
    chatId: session.chatId,
    ...options,
  }, workstreamId);
  
  return response;
}

/**
 * Continue a Cursor session with live progress display
 * @param workstreamId - Optional workstream ID to continue specific workstream session
 */
export async function continueCursorSessionWithProgress(
  prompt: string,
  options?: Partial<Omit<CursorAgentOptions, 'workspace' | 'chatId' | 'onProgress'>>,
  workstreamId?: string
): Promise<CursorResponse> {
  const session = getSession(workstreamId);
  if (!session) {
    return {
      success: false,
      output: '',
      error: 'No active Cursor session. Use startCursorSession first.',
    };
  }
  
  // Print header - pass workstreamId to route to correct workstream
  cursorLog(`Continuing Cursor Agent...`, workstreamId);
  
  const startTime = Date.now();
  
  const response = await runCursorAgentRaw(prompt, {
    workspace: session.workspace,
    chatId: session.chatId,
    ...options,
  }, workstreamId);
  
  const totalTime = Math.floor((Date.now() - startTime) / 1000);
  cursorLog(`Cursor finished in ${totalTime}s`, workstreamId);
  
  return response;
}

/**
 * Get the current Cursor session status
 * @param workstreamId - Optional workstream ID to check specific workstream session
 */
export function getCursorSessionStatus(workstreamId?: string): {
  active: boolean;
  chatId?: string;
  workspace?: string;
  startedAt?: number;
  durationMs?: number;
  lastResponse?: CursorResponse | null;
  processId?: number;
  isRunning?: boolean;
  processStillAlive?: boolean;
} {
  const session = getSession(workstreamId);
  if (!session) {
    return { active: false };
  }
  
  // Check if the process is actually still running
  const processStillAlive = session.processId 
    ? isProcessRunning(session.processId)
    : undefined;
  
  // If we think it's running but it's not, update our state
  if (session.isRunning && processStillAlive === false) {
    session.isRunning = false;
    setSession(session, workstreamId);
  }
  
  return {
    active: true,
    chatId: session.chatId,
    workspace: session.workspace,
    startedAt: session.startedAt,
    durationMs: Date.now() - session.startedAt,
    lastResponse: session.lastResponse,
    processId: session.processId,
    isRunning: session.isRunning,
    processStillAlive,
  };
}

/**
 * Get the full log from a Cursor session for the log viewer
 * @param workstreamId - Optional workstream ID to get specific workstream session log
 */
export function getCursorSessionLog(workstreamId?: string): {
  hasLog: boolean;
  prompt?: string;
  log: string[];
  startedAt?: number;
  isRunning?: boolean;
} {
  const session = getSession(workstreamId);
  if (!session) {
    return { hasLog: false, log: [] };
  }
  
  return {
    hasLog: true,
    prompt: session.prompt,
    log: session.fullLog || [],
    startedAt: session.startedAt,
    isRunning: session.isRunning,
  };
}

/**
 * End the current Cursor session
 * Terminates the process if still running
 * @param workstreamId - Optional workstream ID to end specific workstream session
 */
export function endCursorSession(workstreamId?: string): { ended: boolean; chatId?: string; killedProcess?: boolean } {
  const session = getSession(workstreamId);
  if (!session) {
    return { ended: false };
  }
  
  const chatId = session.chatId;
  let killedProcess = false;
  
  // Clear heartbeat interval to prevent stale timers
  if (session.heartbeatInterval) {
    clearInterval(session.heartbeatInterval);
  }
  
  // Try to kill the process if it's still running
  if (session.processId && session.isRunning) {
    try {
      if (isProcessRunning(session.processId)) {
        process.kill(session.processId, 'SIGTERM');
        killedProcess = true;
      }
    } catch (err) {
      // Best effort - process may already be gone or we lack permissions
      console.warn(`Failed to kill Cursor process ${session.processId}:`, err);
    }
  }
  
  deleteSession(workstreamId);
  
  return { ended: true, chatId, killedProcess };
}

/**
 * Create a new chat and return its ID
 * This allows us to use --resume with a known chatId for session continuity
 */
async function createChatId(workspace: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    
    const cli = getCursorCliOrFallback();
    const proc = invokeCursorCli(cli, getAgentArgs(cli, ['create-chat', '--workspace', workspace]), {
      cwd: workspace,
    });
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        // create-chat returns just the UUID on stdout
        const chatId = stdout.trim();
        if (chatId && /^[a-f0-9-]{36}$/i.test(chatId)) {
          resolve(chatId);
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
    
    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Check if a process is still running by PID
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if the process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that no orphaned Cursor session is running
 * Returns { valid: true } if OK to proceed, or { valid: false, reason: string } if not
 * @param workstreamId - Optional workstream ID to validate specific workstream session
 */
export function validateNoOrphanedSession(workstreamId?: string): { valid: boolean; reason?: string; chatId?: string } {
  const session = getSession(workstreamId);
  if (!session) {
    return { valid: true };
  }
  
  // Check if we think there's a running session
  if (session.isRunning && session.processId) {
    const stillRunning = isProcessRunning(session.processId);
    
    if (stillRunning) {
      return {
        valid: false,
        reason: `Cursor agent is still running (PID: ${session.processId}, Chat: ${session.chatId.slice(0, 8)}). Call cursor_end_session first or wait for it to complete.`,
        chatId: session.chatId,
      };
    } else {
      // Process died but we didn't know - clean up the stale session
      session.isRunning = false;
      setSession(session, workstreamId);
    }
  }
  
  return { valid: true };
}

/**
 * Force cleanup of any tracked session (use when assistant crashes/restarts)
 * @param workstreamId - Optional workstream ID to clean specific workstream session
 */
export function forceCleanupSession(workstreamId?: string): { cleaned: boolean; chatId?: string } {
  const session = getSession(workstreamId);
  if (!session) {
    return { cleaned: false };
  }
  
  const chatId = session.chatId;
  
  // Try to kill the process if it's still running
  if (session.processId && session.isRunning) {
    try {
      if (isProcessRunning(session.processId)) {
        process.kill(session.processId, 'SIGTERM');
      }
    } catch {
      // Best effort - process may already be gone
    }
  }
  
  deleteSession(workstreamId);
  return { cleaned: true, chatId };
}

/**
 * Check if Cursor CLI is available
 */
export async function isCursorAvailable(): Promise<boolean> {
  const cliPath = getCursorCli();
  if (!cliPath) return false;
  
  return new Promise((resolve) => {
    // Handle Windows .cmd files which need to be run through cmd.exe
    let proc;
    if (Platform.isWindows && cliPath.endsWith('.cmd')) {
      proc = spawn('cmd', ['/c', cliPath, '--version'], { windowsHide: true });
    } else {
      proc = spawn(cliPath, ['--version']);
    }
    
    proc.on('close', (code) => {
      resolve(code === 0);
    });
    
    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Check Cursor authentication status
 * Returns { authenticated: boolean, user?: string, error?: string }
 */
export async function checkCursorAuth(): Promise<{
  authenticated: boolean;
  user?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    
    const cli = getCursorCliOrFallback();
    const proc = invokeCursorCli(cli, getAgentArgs(cli, ['status']), {});
    
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', () => {
      const combined = stdout + stderr;
      
      // Check for "Not logged in" message (exit code is 0 either way!)
      if (combined.toLowerCase().includes('not logged in')) {
        resolve({
          authenticated: false,
          error: 'Not logged in. Run: /Applications/Cursor.app/Contents/Resources/app/bin/cursor agent login',
        });
        return;
      }
      
      // Try to parse user info from status output
      const userMatch = combined.match(/logged in as[:\s]+(\S+)/i) || 
                        combined.match(/user[:\s]+(\S+)/i) ||
                        combined.match(/email[:\s]+(\S+)/i) ||
                        combined.match(/(\S+@\S+\.\S+)/); // Match email pattern
      
      if (userMatch) {
        resolve({
          authenticated: true,
          user: userMatch[1],
        });
      } else if (combined.toLowerCase().includes('logged in') || combined.toLowerCase().includes('authenticated')) {
        resolve({
          authenticated: true,
          user: 'unknown',
        });
      } else {
        // Assume not logged in if we can't determine
        resolve({
          authenticated: false,
          error: 'Could not determine auth status. Try: cursor agent login',
        });
      }
    });
    
    proc.on('error', (err) => {
      resolve({
        authenticated: false,
        error: `Failed to check auth: ${err.message}`,
      });
    });
  });
}

/**
 * Run Cursor login interactively - streams output to console
 * Returns when the login process completes (user needs to complete OAuth in browser)
 */
export async function runCursorLogin(): Promise<{
  success: boolean;
  output: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    let output = '';
    
    console.log(`\n${ANSI.cyan}┌─ Cursor Login ─────────────────────────────────┐${ANSI.reset}`);
    console.log(`${ANSI.cyan}│${ANSI.reset} Opening browser for authentication...`);
    console.log(`${ANSI.cyan}│${ANSI.reset} Complete the login in your browser.`);
    console.log(`${ANSI.cyan}└────────────────────────────────────────────────┘${ANSI.reset}\n`);
    
    const cli = getCursorCliOrFallback();
    const proc = invokeCursorCli(cli, getAgentArgs(cli, ['login']), {
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    
    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });
    
    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stderr.write(chunk);
    });
    
    proc.on('close', (code) => {
      console.log(''); // newline after login output
      
      if (code === 0) {
        console.log(`${ANSI.green}✓ Login process completed${ANSI.reset}\n`);
        resolve({
          success: true,
          output,
        });
      } else {
        console.log(`${ANSI.red}✗ Login process failed (exit code: ${code})${ANSI.reset}\n`);
        resolve({
          success: false,
          output,
          error: `Login exited with code ${code}`,
        });
      }
    });
    
    proc.on('error', (err) => {
      console.log(`${ANSI.red}✗ Failed to start login: ${err.message}${ANSI.reset}\n`);
      resolve({
        success: false,
        output: '',
        error: `Failed to spawn login: ${err.message}`,
      });
    });
  });
}

