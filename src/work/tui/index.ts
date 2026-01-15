// k9s-style TUI for Work Mode
// Main entry point

import blessed from 'blessed';
import { EventEmitter } from 'events';
import { TUIState, TUIEvent, Task } from './types.js';
import { CharacterType, PersonalityType } from '../types.js';
import { Layout } from './components/Layout.js';
import { WorkstreamManager, serializeMessages } from './state/workstreams.js';
import { NotificationManager } from './state/notifications.js';
import { BackgroundPoller } from './background/poller.js';
import { WorkAgentSession } from '../agent.js';
import { getActiveTasks, createTask as createTaskInMemory, deleteTask as deleteTaskFromMemory } from '../tools/tasks.js';
import { handleTokenOverflow, isTokenOverflowError } from './utils/tokenOverflowDebug.js';
import { setCursorProgressCallback, getCursorSessionLog } from '../tools/cursor.js';
import { getMemories, getPendingMemories, approveMemory, rejectMemory, deleteMemory } from '../tools/memory.js';
import { getSessionPreferences, setCharacterPreference } from '../storage/preferences.js';
import { 
  getAdvicePoller, 
  getActiveTopics, 
  markTopicRead, 
  dismissTopic, 
  getTopicById,
  AdviceTopic,
} from '../advice/index.js';
import { VoiceService, ParsedVoiceCommand } from './voice/index.js';
import { VoiceState } from './types.js';
import { Platform, TerminalService } from '../../utils/platform/index.js';

export class WorkTUI extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private layout: Layout;
  private workstreamManager: WorkstreamManager;
  private notificationManager: NotificationManager;
  private backgroundPoller: BackgroundPoller;
  private voiceService: VoiceService;
  private agentSession: WorkAgentSession | null = null;
  private generalChatSession: WorkAgentSession | null = null;  // Ephemeral chat session
  
  // Track active sessions per workstream to handle background processing
  private activeSessions: Map<string, WorkAgentSession> = new Map();
  
  private state: TUIState = {
    workstreams: [],
    tasks: [],
    notifications: [],
    adviceTopics: [],
    activeWorkstreamId: null,
    activeAdviceId: null,
    focusedPane: 'list',
    selectedTaskIndex: 0,
    selectedAdviceIndex: 0,
  };

  constructor() {
    super();
    
    // Create blessed screen with platform-aware settings
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Work Mode TUI',
      fullUnicode: TerminalService.supportsUnicode(),
      autoPadding: true,
      warnings: true,
      // Platform-specific terminal configuration
      terminal: TerminalService.getTerminalType(),
      // Windows-specific adjustments
      ...(Platform.isWindows && {
        // Use alternate screen buffer for cleaner exit on Windows
        // This helps prevent screen artifacts when exiting
        forceUnicode: TerminalService.supportsUnicode(),
      }),
    });
    
    // Initialize managers
    this.workstreamManager = new WorkstreamManager();
    this.notificationManager = new NotificationManager();
    this.backgroundPoller = new BackgroundPoller(this.notificationManager, this.workstreamManager);
    
    // Initialize voice service
    this.voiceService = new VoiceService();
    this.setupVoiceService();
    
    // Create layout
    this.layout = new Layout(this.screen, this.state, this.handleEvent.bind(this));
    
    // Set up global key handlers
    this.setupKeyHandlers();
  }

  private setupKeyHandlers(): void {
    // Ctrl+C: interrupt agent if processing, don't quit
    this.screen.key(['C-c'], () => {
      this.handleInterrupt();
    });
    
    // On Windows, also handle Ctrl+Break as an interrupt signal
    // This is a common Windows-specific key combination for interrupting processes
    if (Platform.isWindows) {
      try {
        this.screen.key(['C-pause'], () => {
          this.handleInterrupt();
        });
      } catch {
        // Ignore if key binding not supported - not all terminals support Ctrl+Break
      }
    }
    
    // Help overlay
    this.screen.key(['?'], () => {
      this.layout.showHelp();
    });
    
    // Voice control: only bind if available on this platform
    // Voice features (TTS/STT) are currently macOS-only
    if (VoiceService.isAvailable()) {
      // Voice control: [ to toggle recording
      this.screen.key(['['], () => {
        this.voiceService.toggleRecording();
      });
      
      // Voice control: ] to toggle TTS mode
      this.screen.key([']'], () => {
        this.voiceService.toggleTTS();
      });
    }
    
    // Cursor log viewer: Ctrl+L to show cursor logs (works from anywhere)
    this.screen.key(['C-l'], () => {
      const workstreamId = this.state.activeWorkstreamId || undefined;
      this.layout.showCursorLog(() => getCursorSessionLog(workstreamId));
    });
    
    // Trash bin viewer: Shift+T to show deleted workstreams
    this.screen.key(['S-t'], () => {
      this.layout.showTrashBin();
    });
  }

  private setupVoiceService(): void {
    // Handle voice state changes - update layout indicator
    this.voiceService.on('state_change', (state: VoiceState) => {
      this.layout.updateVoiceState(state);
    });

    // Handle voice commands
    this.voiceService.on('command', (command: ParsedVoiceCommand) => {
      this.handleVoiceCommand(command);
    });

    // Handle voice info messages
    this.voiceService.on('info', (message: string) => {
      this.layout.showInfo(message);
    });

    // Handle voice errors
    this.voiceService.on('error', (error: Error) => {
      this.layout.showError(`Voice: ${error.message}`);
    });

    // Handle TTS toggle
    this.voiceService.on('tts_toggle', (enabled: boolean) => {
      this.layout.showInfo(enabled ? '🔊 TTS enabled' : '🔇 TTS disabled');
    });
  }

  private async handleVoiceCommand(command: ParsedVoiceCommand): Promise<void> {
    switch (command.type) {
      // Message commands
      case 'send':
        // Simulate pressing send (would need to capture current input)
        this.layout.showInfo('Voice "send" - type message first');
        break;
        
      case 'say':
        // Dictate and send a message
        if (command.args) {
          await this.sendMessage(command.args);
        } else {
          this.layout.showInfo('Say "command say [your message]"');
        }
        break;
        
      case 'cancel':
        this.layout.showInfo('Clearing input');
        // Layout handles input clearing
        break;
        
      case 'stop':
        this.handleInterrupt();
        break;
        
      case 'continue':
        if (this.agentSession && this.state.activeWorkstreamId) {
          await this.sendMessage('continue');
        }
        break;

      // Navigation commands
      case 'workstream':
        if (command.args) {
          // Try to find workstream by name or number
          const arg = command.args.toLowerCase();
          const num = parseInt(arg, 10);
          
          let workstream;
          if (!isNaN(num) && num > 0 && num <= this.state.workstreams.length) {
            workstream = this.state.workstreams[num - 1];
          } else {
            workstream = this.state.workstreams.find(w => 
              w.name.toLowerCase().includes(arg)
            );
          }
          
          if (workstream) {
            await this.selectWorkstream(workstream.id);
            // Force UI refresh after voice-triggered switch
            this.layout.updateState(this.state);
            this.layout.forceRender();
          } else {
            this.layout.showError(`Workstream not found: ${command.args}`);
          }
        }
        break;
        
      case 'general_chat':
        await this.switchToGeneralChat();
        this.layout.forceRender();
        break;
        
      case 'tasks':
        this.state.focusedPane = 'tasks';
        this.layout.updateState(this.state);
        this.layout.forceRender();
        break;
        
      case 'advice':
        this.state.focusedPane = 'advice';
        this.layout.updateState(this.state);
        break;
        
      case 'list':
        this.state.focusedPane = 'list';
        this.layout.updateState(this.state);
        break;

      // Workstream commands
      case 'new_workstream':
        if (command.args) {
          await this.createWorkstream('custom', command.args);
        } else {
          this.layout.showInfo('Say "command new workstream [name]"');
        }
        break;
        
      case 'delete_workstream':
        if (this.state.activeWorkstreamId) {
          await this.deleteWorkstream(this.state.activeWorkstreamId);
        }
        break;
        
      case 'reset':
        if (this.agentSession && this.state.activeWorkstreamId) {
          await this.agentSession.reset();
          await this.workstreamManager.update(this.state.activeWorkstreamId, {
            messages: [],
            tokenEstimate: 0,
            turnCount: 0,
          });
          this.refreshWorkstreams();
          this.layout.showSuccess('Conversation reset');
          this.layout.updateState(this.state);
        }
        break;

      // Task commands
      case 'new_task':
        if (command.args) {
          await this.createTask(command.args);
        } else {
          this.layout.showInfo('Say "command new task [description]"');
        }
        break;
        
      case 'delete_task':
        const task = this.state.tasks[this.state.selectedTaskIndex];
        if (task) {
          await this.deleteTask(task.id);
        }
        break;
        
      case 'next_task':
        if (this.state.selectedTaskIndex < this.state.tasks.length - 1) {
          this.state.selectedTaskIndex++;
          this.layout.updateState(this.state);
        }
        break;
        
      case 'previous_task':
        if (this.state.selectedTaskIndex > 0) {
          this.state.selectedTaskIndex--;
          this.layout.updateState(this.state);
        }
        break;

      // Utility commands
      case 'copy':
        await this.handleCommand('copy', '');
        break;
        
      case 'links':
        await this.handleCommand('urls', '');
        break;
        
      case 'help':
        this.layout.showHelp();
        break;
        
      case 'commands':
        this.layout.showVoiceCommands();
        break;
        
      case 'scroll_up':
        this.layout.scrollConversation(-5);
        break;
        
      case 'scroll_down':
        this.layout.scrollConversation(5);
        break;
        
      case 'quit':
        await this.quit();
        break;

      // Voice control commands
      case 'voice_off':
        this.voiceService.setTTS(false);
        break;
        
      case 'voice_on':
        this.voiceService.setTTS(true);
        break;
        
      case 'read_again':
        await this.voiceService.readAgain();
        break;
    }
  }

  private async handleEvent(event: TUIEvent): Promise<void> {
    switch (event.type) {
      case 'workstream_select':
        await this.selectWorkstream(event.workstreamId);
        break;
        
      case 'workstream_create':
        await this.createWorkstream(event.workstreamType, event.name, event.metadata);
        break;
        
      case 'workstream_delete':
        await this.deleteWorkstream(event.workstreamId);
        break;
        
      case 'trash_restore':
        await this.restoreFromTrash(event.workstreamId);
        break;
        
      case 'trash_permanent_delete':
        await this.permanentlyDeleteFromTrash(event.workstreamId);
        break;
        
      case 'trash_empty':
        await this.emptyTrash();
        break;
        
      case 'task_create':
        await this.createTask(event.content, event.priority);
        break;
        
      case 'task_delete':
        await this.deleteTask(event.taskId);
        break;
        
      case 'advice_select':
        await this.selectAdvice(event.adviceId);
        break;
        
      case 'advice_dismiss':
        await this.dismissAdvice(event.adviceId);
        break;
        
      case 'advice_refresh':
        await this.refreshAdvice();
        break;
        
      case 'general_chat':
        await this.switchToGeneralChat();
        break;
        
      case 'focus_change':
        this.state.focusedPane = event.pane;
        this.layout.updateState(this.state);
        break;
        
      case 'message_send':
        await this.sendMessage(event.message);
        break;
        
      case 'notification_read':
        this.notificationManager.markAsRead(event.notificationId);
        this.state.notifications = this.notificationManager.getNotifications();
        this.layout.updateState(this.state);
        break;
        
      case 'notification_click':
        const notification = this.notificationManager.getNotification(event.notificationId);
        if (notification?.workstreamId) {
          await this.selectWorkstream(notification.workstreamId);
        }
        this.notificationManager.markAsRead(event.notificationId);
        this.state.notifications = this.notificationManager.getNotifications();
        this.layout.updateState(this.state);
        break;
        
      case 'command':
        await this.handleCommand(event.command, event.args);
        break;
        
      case 'interrupt':
        this.handleInterrupt();
        break;
        
      case 'quit':
        await this.quit();
        break;
    }
  }

  private async handleCommand(command: string, args: string): Promise<void> {
    switch (command) {
      case 'exit':
      case 'quit':
        await this.quit();
        break;
        
      case 'reset':
        if (this.agentSession && this.state.activeWorkstreamId) {
          await this.agentSession.reset();
          // Clear conversation in current workstream
          await this.workstreamManager.update(this.state.activeWorkstreamId, {
            messages: [],
            tokenEstimate: 0,
            turnCount: 0,
          });
          this.refreshWorkstreams();
          this.layout.showSuccess('Conversation reset');
          this.layout.updateState(this.state);
        } else {
          this.layout.showError('Select a workstream first to reset');
        }
        break;
        
      case 'tokens':
        if (this.agentSession) {
          const stats = this.agentSession.getStats();
          this.layout.showInfo(`Tokens: ~${stats.estimated.toLocaleString()} | Turns: ${stats.turns} | Messages: ${stats.messageCount}`);
        } else {
          this.layout.showError('Select a workstream first to see tokens');
        }
        break;
        
      case 'datadog':
        if (this.agentSession && this.state.activeWorkstreamId) {
          const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
          if (workstream) {
            const newState = !workstream.datadogEnabled;
            this.agentSession.setDatadog(newState);
            await this.workstreamManager.update(this.state.activeWorkstreamId, { datadogEnabled: newState });
            this.refreshWorkstreams();
            this.layout.showSuccess(`Datadog ${newState ? 'enabled' : 'disabled'}`);
            this.layout.updateState(this.state);
          } else {
            this.layout.showError('Workstream not found');
          }
        } else {
          this.layout.showError('Select a workstream first to toggle Datadog');
        }
        break;
        
      case 'help':
        this.layout.showHelp();
        break;
        
      case 'character':
        if (this.agentSession && this.state.activeWorkstreamId) {
          const current = this.agentSession.getCharacter();
          
          await this.layout.showCharacterSelector(
            current.type,
            async (type: string, customDesc?: string) => {
              // Update current session
              await this.agentSession!.setCharacter(type as any, customDesc);
              
              // Save to global preferences
              if (type === 'custom' && customDesc) {
                await setCharacterPreference('custom', undefined, customDesc);
              } else if (type === 'none') {
                await setCharacterPreference('none');
              } else {
                await setCharacterPreference('builtin', undefined, type);
              }
              
              const displayName = customDesc ? customDesc.substring(0, 30) : type;
              this.layout.showSuccess(`Character set globally: ${displayName}`);
              this.layout.updateState(this.state);
            }
          );
        } else {
          this.layout.showError('Select a workstream first to change character');
        }
        break;
        
      case 'personality':
        if (this.agentSession && this.state.activeWorkstreamId) {
          if (!args) {
            this.layout.showInfo('Usage: /personality <default|proactive|minimal>');
          } else {
            const validPersonalities = ['default', 'proactive', 'minimal'];
            if (!validPersonalities.includes(args)) {
              this.layout.showError(`Invalid personality. Available: ${validPersonalities.join(', ')}`);
            } else {
              await this.agentSession.setPersonality(args as any);
              await this.workstreamManager.update(this.state.activeWorkstreamId, { personality: args });
              this.refreshWorkstreams();
              this.layout.showSuccess(`Personality set to: ${args}`);
              this.layout.updateState(this.state);
            }
          }
        } else {
          this.layout.showError('Select a workstream first to change personality');
        }
        break;

      case 'memory':
        await this.showMemoryManager();
        break;

      case 'urls':
      case 'links':
        await this.showLinkPicker();
        break;

      case 'copy':
        await this.copyLastResponse();
        break;

      case 'raw':
        await this.showRawLastResponse();
        break;

      case 'learn':
        await this.saveConversationForLearning();
        break;
        
      case 'advice':
        await this.handleAdviceCommand(args);
        break;
        
      case 'model':
        await this.handleModelCommand(args);
        break;
        
      default:
        this.layout.showError(`Unknown command: /${command}`);
        this.layout.showInfo('Available: /links, /copy, /raw, /learn, /memory, /datadog, /advice, /model, /reset, /help');
        break;
    }
  }

  private getLastAssistantMessage(): string | null {
    if (!this.state.activeWorkstreamId) return null;
    const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
    if (!workstream || !workstream.messages.length) return null;
    
    // Find last assistant message
    for (let i = workstream.messages.length - 1; i >= 0; i--) {
      if (workstream.messages[i].type === 'ai') {
        return workstream.messages[i].content;
      }
    }
    return null;
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    const { ClipboardService } = await import('../../utils/platform/index.js');
    return ClipboardService.copy(text);
  }

  private async copyLastResponse(): Promise<void> {
    const lastMessage = this.getLastAssistantMessage();
    if (!lastMessage) {
      this.layout.showError('No assistant response to copy');
      return;
    }
    
    if (await this.copyToClipboard(lastMessage)) {
      this.layout.showSuccess('Last response copied to clipboard!');
    } else {
      this.layout.showError('Failed to copy. Use /raw instead');
    }
  }

  private async showRawLastResponse(): Promise<void> {
    let messages: Array<{ type: string; content: string }> = [];
    let title = '';
    let timestamp = '';
    
    if (!this.state.activeWorkstreamId) {
      // General chat mode
      if (!this.generalChatSession) {
        this.layout.showError('No messages to show');
        return;
      }
      
      const sessionMessages = this.generalChatSession.getMessages();
      if (!sessionMessages.length) {
        this.layout.showError('No messages to show');
        return;
      }
      
      // Convert BaseMessage[] to our format (including system messages for debugging)
      messages = sessionMessages.map(msg => ({
        type: msg._getType(),
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));
      title = 'General Chat (ephemeral - not saved)';
      timestamp = new Date().toLocaleString();
    } else {
      // Workstream mode
      const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
      if (!workstream || !workstream.messages.length) {
        this.layout.showError('No messages to show');
        return;
      }
      
      messages = workstream.messages;
      title = `Workstream: ${workstream.name}`;
      timestamp = new Date(workstream.createdAt).toLocaleString();
    }
    
    // Build the full conversation as raw text
    const lines: string[] = [];
    lines.push(`=== ${title} ===`);
    lines.push(`Created: ${timestamp}`);
    lines.push('');
    lines.push('─'.repeat(60));
    lines.push('');
    
    for (const msg of messages) {
      const role = msg.type === 'human' ? '👤 YOU' : msg.type === 'ai' ? '🤖 ASSISTANT' : msg.type.toUpperCase();
      lines.push(`${role}:`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('─'.repeat(60));
      lines.push('');
    }
    
    // Write to temp file
    const { writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const tempFile = join(tmpdir(), `hn-work-raw-${Date.now()}.txt`);
    writeFileSync(tempFile, lines.join('\n'));
    
    // Open in new terminal window (platform-specific)
    const { spawn } = await import('child_process');
    // Platform and TerminalService are imported at the top level
    
    if (Platform.isWindows) {
      // Windows: Try multiple approaches in order of preference
      // 1. Windows Terminal (modern, best experience)
      // 2. PowerShell with more command (for scrolling)
      // 3. Notepad (universal fallback)
      
      if (TerminalService.isWindowsTerminal()) {
        // We're in Windows Terminal - open a new tab with the file
        try {
          const cmd = `Get-Content -Path '${tempFile.replace(/'/g, "''")}' -Wait; Write-Host 'Press any key to close...'; $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown'); Remove-Item '${tempFile.replace(/'/g, "''")}'`;
          const child = spawn('wt', ['-w', '0', 'nt', 'pwsh', '-NoProfile', '-Command', cmd], { 
            detached: true, 
            stdio: 'ignore',
            shell: false,
          });
          child.unref();
          this.layout.showSuccess('Opened raw conversation in Windows Terminal');
          return;
        } catch {
          // Fall through to next option
        }
      }
      
      // Try PowerShell with Get-Content | more for paging
      try {
        const cmd = `Get-Content -Path '${tempFile.replace(/'/g, "''")}' | more; Write-Host ''; Write-Host 'Press any key to close...'; $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown'); Remove-Item '${tempFile.replace(/'/g, "''")}'`;
        const child = spawn('powershell', ['-NoProfile', '-Command', `Start-Process powershell -ArgumentList '-NoProfile', '-NoExit', '-Command', '${cmd.replace(/'/g, "''")}'`], {
          detached: true,
          stdio: 'ignore',
          shell: false,
        });
        child.unref();
        this.layout.showSuccess('Opened raw conversation in PowerShell');
        return;
      } catch {
        // Fall through to Notepad
      }
      
      // Notepad as universal fallback
      try {
        const child = spawn('notepad', [tempFile], { detached: true, stdio: 'ignore' });
        child.unref();
        this.layout.showSuccess('Opened raw conversation in Notepad');
      } catch {
        this.layout.showInfo(`Raw conversation saved to: ${tempFile}`);
        this.layout.showInfo(`Open it with: notepad "${tempFile}"`);
      }
    } else if (Platform.isMacOS) {
      // Use osascript to open a new Terminal window with less
      const script = `
        tell application "Terminal"
          activate
          do script "less '${tempFile}' && rm '${tempFile}'"
        end tell
      `;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      this.layout.showSuccess('Opened raw conversation in new Terminal window');
    } else {
      // Linux - try xterm or just show the path
      try {
        spawn('xterm', ['-e', `less '${tempFile}'`], { detached: true, stdio: 'ignore' });
        this.layout.showSuccess('Opened raw conversation in new terminal');
      } catch {
        this.layout.showInfo(`Raw conversation saved to: ${tempFile}`);
        this.layout.showInfo('Open it with: less ' + tempFile);
      }
    }
  }

  private async saveConversationForLearning(): Promise<void> {
    // Extended message type to support tool call info for debugging
    interface ExportableMessage {
      type: string;
      content: string;
      toolCalls?: Array<{ name: string; args: Record<string, unknown>; id: string }>;
      name?: string;  // For tool messages
    }
    
    let messages: ExportableMessage[] = [];
    let title = '';
    let createdAt = '';
    let nameForFile = '';
    
    if (!this.state.activeWorkstreamId) {
      // General chat mode
      if (!this.generalChatSession) {
        this.layout.showError('No messages to save');
        return;
      }
      
      const sessionMessages = this.generalChatSession.getMessages();
      if (!sessionMessages.length) {
        this.layout.showError('No messages to save');
        return;
      }
      
      // Convert BaseMessage[] to our format (including system messages and tool calls for debugging)
      messages = sessionMessages.map(msg => {
        const result: ExportableMessage = {
          type: msg._getType(),
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };
        // Extract tool_calls from AIMessage if present
        const aiMsg = msg as { tool_calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }> };
        if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
          result.toolCalls = aiMsg.tool_calls.map(tc => ({ name: tc.name, args: tc.args, id: tc.id || '' }));
        }
        return result;
      });
      title = 'General Chat (ephemeral - not saved)';
      createdAt = new Date().toLocaleString();
      nameForFile = 'general-chat';
    } else {
      // Workstream mode
      const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
      if (!workstream || !workstream.messages.length) {
        this.layout.showError('No messages to save');
        return;
      }
      
      messages = workstream.messages;
      title = `Workstream: ${workstream.name}`;
      createdAt = new Date(workstream.createdAt).toLocaleString();
      nameForFile = workstream.name;
    }
    
    // Build the full conversation as raw text
    const lines: string[] = [];
    lines.push(`=== ${title} ===`);
    lines.push(`Created: ${createdAt}`);
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('─'.repeat(60));
    lines.push('');
    
    // Track tool call stats for summary
    let totalToolCalls = 0;
    const toolCallCounts: Record<string, number> = {};
    
    for (const msg of messages) {
      if (msg.type === 'human') {
        lines.push('👤 YOU:');
        lines.push('');
        lines.push(msg.content);
      } else if (msg.type === 'ai') {
        lines.push('🤖 ASSISTANT:');
        lines.push('');
        
        // Show tool calls if present (critical for debugging)
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          lines.push('[TOOL CALLS]:');
          for (const tc of msg.toolCalls) {
            const argsPreview = JSON.stringify(tc.args || {}).substring(0, 100);
            const truncated = argsPreview.length >= 100 ? '...' : '';
            lines.push(`  → ${tc.name}(${argsPreview}${truncated})`);
            
            // Track stats
            totalToolCalls++;
            toolCallCounts[tc.name] = (toolCallCounts[tc.name] || 0) + 1;
          }
          lines.push('');
        }
        
        // Show content if present
        if (msg.content && msg.content.trim()) {
          lines.push(msg.content);
        }
      } else if (msg.type === 'tool') {
        // Show tool results (truncated for readability)
        const toolName = (msg as { name?: string }).name || 'tool';
        const resultPreview = msg.content.substring(0, 200);
        const truncated = msg.content.length > 200 ? '...' : '';
        lines.push(`[TOOL RESULT - ${toolName}]: ${resultPreview}${truncated}`);
      } else if (msg.type === 'system') {
        lines.push('SYSTEM:');
        lines.push('');
        lines.push(msg.content);
      } else {
        lines.push(`${msg.type.toUpperCase()}:`);
        lines.push('');
        lines.push(msg.content);
      }
      
      lines.push('');
      lines.push('─'.repeat(60));
      lines.push('');
    }
    
    // Add tool call summary at the end (very useful for debugging)
    if (totalToolCalls > 0) {
      lines.push('═'.repeat(60));
      lines.push('TOOL CALL SUMMARY:');
      lines.push(`Total tool calls: ${totalToolCalls}`);
      lines.push('');
      lines.push('Breakdown by tool:');
      const sorted = Object.entries(toolCallCounts).sort((a, b) => b[1] - a[1]);
      for (const [tool, count] of sorted) {
        lines.push(`  ${tool}: ${count}`);
      }
      lines.push('═'.repeat(60));
      lines.push('');
    }
    
    // Create filename from name and timestamp
    const { writeFileSync, mkdirSync, existsSync } = await import('fs');
    const { join } = await import('path');
    
    const chatsDir = '/Users/korenbe/code/HackerNews/chats_to_learn';
    
    // Ensure directory exists
    if (!existsSync(chatsDir)) {
      mkdirSync(chatsDir, { recursive: true });
    }
    
    // Sanitize name for filename
    const safeName = nameForFile
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `${safeName}-${timestamp}.txt`;
    const filepath = join(chatsDir, filename);
    
    writeFileSync(filepath, lines.join('\n'));
    
    this.layout.showSuccess(`Saved to: chats_to_learn/${filename}`);
  }

  private getWorkstreamMessages(): Array<{ type: string; content: string }> {
    if (!this.state.activeWorkstreamId) return [];
    
    // First try to get from workstream manager
    const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
    if (workstream && workstream.messages.length > 0) {
      return workstream.messages;
    }
    
    // Fall back to agent session if available (for loaded but not yet messaged workstreams)
    if (this.agentSession) {
      const sessionMessages = this.agentSession.getMessages();
      if (sessionMessages && sessionMessages.length > 0) {
        return sessionMessages.map(msg => ({
          type: msg._getType(),
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        }));
      }
    }
    
    return [];
  }

  private async showLinkPicker(): Promise<void> {
    if (!this.state.activeWorkstreamId) {
      this.layout.showError('Select a workstream first');
      return;
    }
    
    const messages = this.getWorkstreamMessages();
    if (messages.length === 0) {
      this.layout.showInfo('No messages in this workstream');
      return;
    }
    
    // Extract URLs from all messages - exclude newlines from URLs
    const urlRegex = /https?:\/\/[^\s\n\r\)>\]"']+/g;
    const urls: string[] = [];
    const seen = new Set<string>();
    
    for (const msg of messages) {
      const matches = msg.content.match(urlRegex);
      if (matches) {
        for (const url of matches) {
          // Clean up trailing punctuation and newlines
          const cleaned = url.replace(/[.,;:!?\)>\]\n\r\\]+$/, '').replace(/\\n$/, '');
          if (!seen.has(cleaned) && cleaned.length > 10) {
            seen.add(cleaned);
            urls.push(cleaned);
          }
        }
      }
    }
    
    if (urls.length === 0) {
      this.layout.showInfo('No URLs found in conversation');
      return;
    }
    
    // Show interactive link picker
    this.layout.showLinkPicker(urls, async (url) => {
      // Open in browser using cross-platform BrowserService
      const { BrowserService } = await import('../../utils/platform/index.js');
      try {
        await BrowserService.open(url);
        this.layout.showSuccess(`Opening: ${url.substring(0, 50)}...`);
      } catch (error) {
        this.layout.showError(`Failed to open URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }, async (url) => {
      // Copy to clipboard
      if (await this.copyToClipboard(url)) {
        this.layout.showSuccess('URL copied to clipboard!');
      }
    });
  }

  private async showMemoryManager(): Promise<void> {
    const memories = await getMemories();
    const pending = await getPendingMemories();
    
    this.layout.showMemoryManager(
      memories,
      pending,
      // onApprove
      async (mem) => {
        const result = await approveMemory(mem.id);
        if (result) {
          this.layout.showSuccess('Memory approved!');
        }
      },
      // onReject
      async (mem) => {
        const result = await rejectMemory(mem.id);
        if (result) {
          this.layout.showSuccess('Memory rejected');
        }
      },
      // onDelete
      async (mem) => {
        const result = await deleteMemory(mem.id);
        if (result) {
          this.layout.showSuccess('Memory deleted');
        }
      }
    );
  }

  private handleInterrupt(): void {
    // Check if CURRENT workstream is processing
    const activeWorkstream = this.state.workstreams.find(w => w.id === this.state.activeWorkstreamId);
    const isActiveProcessing = activeWorkstream?.isProcessing || false;
    
    if (this.agentSession && isActiveProcessing) {
      const interrupted = this.agentSession.interrupt();
      if (interrupted) {
        this.layout.showInfo('Interrupting...');
      }
    }
    // If not processing, Ctrl+C does nothing - user can use 'q' to quit
  }

  private async selectWorkstream(workstreamId: string): Promise<void> {
    const workstream = this.state.workstreams.find(w => w.id === workstreamId);
    if (!workstream) return;
    
    // Save current workstream state if there is one
    if (this.state.activeWorkstreamId && this.agentSession) {
      await this.saveCurrentWorkstream();
      
      // Keep the session in activeSessions map if it's still processing
      if (this.agentSession.isProcessing()) {
        this.activeSessions.set(this.state.activeWorkstreamId, this.agentSession);
      }
    }
    
    // Clear general chat session if switching from general chat
    if (!this.state.activeWorkstreamId && this.generalChatSession) {
      this.generalChatSession = null;
    }
    
    // Clear advice context when switching to workstream
    this.state.activeAdviceId = null;
    
    // Switch to new workstream
    this.state.activeWorkstreamId = workstreamId;
    this.state.focusedPane = 'conversation';
    
    // Update voice service's active workstream for TTS filtering
    this.voiceService.setActiveWorkstream(workstreamId);
    
    // Check if we already have an active session for this workstream
    const existingSession = this.activeSessions.get(workstreamId);
    if (existingSession) {
      // Reuse the existing session (it might still be processing in background)
      this.agentSession = existingSession;
      
      // Update UI to show if it's processing
      if (existingSession.isProcessing()) {
        workstream.status = 'in_progress';
        workstream.statusMessage = 'Processing in background...';
      }
      
      // Force clear and re-render conversation to prevent stale/partial content
      this.layout.clearAndRenderConversation(workstream);
      this.layout.updateState(this.state);
      return;
    }
    
    // Load global character preference
    const prefs = await getSessionPreferences();
    let characterType: CharacterType = 'none';
    let customDesc: string | undefined;
    
    if (prefs.characterType === 'custom' && prefs.builtinCharacter) {
      // Custom character stored in builtinCharacter field (it's the description)
      characterType = 'custom';
      customDesc = prefs.builtinCharacter;
    } else if (prefs.characterType === 'builtin' && prefs.builtinCharacter) {
      characterType = prefs.builtinCharacter as CharacterType;
    }
    
    // Load or create agent session for this workstream with global character
    // Pass workstreamId for cursor session isolation
    this.agentSession = new WorkAgentSession(
      workstream.datadogEnabled,
      (workstream.personality || 'proactive') as PersonalityType,
      characterType,
      customDesc,
      workstreamId
    );
    
    // Store in active sessions map
    this.activeSessions.set(workstreamId, this.agentSession);
    
    // Set up agent callbacks BEFORE restoring checkpoint (so agent compiles with callback)
    // NOTE: We don't set the cursor callback here anymore - it's set per-message in sendMessage
    // to avoid cursor output from one workstream appearing in another when switching quickly
    const callbackWorkstreamId = workstreamId;
    const progressCallback = (message: string) => {
      // ALWAYS persist progress to liveProgress (even when not active workstream)
      // This ensures progress is visible when returning to the workstream
      this.persistProgressToWorkstream(callbackWorkstreamId, message);
      
      if (this.state.activeWorkstreamId === callbackWorkstreamId) {
        // Always show in status bar
        this.layout.showProgress(message);
        
        // Also log significant PR watch events as persistent info messages
        // These will appear in the conversation log and persist across workstream switches
        const significantPatterns = [
          { pattern: '🔴 Failure detected', type: 'pr_update' as const },
          { pattern: '🔧 Fixing', type: 'pr_update' as const },
          { pattern: '📝 Fix committed', type: 'pr_update' as const },
          { pattern: '🎉 All checks passing', type: 'pr_update' as const },
          { pattern: '⚠️ Max attempts', type: 'error' as const },
          { pattern: '🛑 PR Watch stopped', type: 'info' as const },
          { pattern: '🎯 PR Watch started', type: 'info' as const },
        ];
        
        for (const { pattern, type } of significantPatterns) {
          if (message.includes(pattern)) {
            this.layout.showInfo(message);
            
            // Add as notification so it persists even when switching workstreams
            this.notificationManager.add({
              type,
              message,
              workstreamId: callbackWorkstreamId,
            });
            this.state.notifications = this.notificationManager.getNotifications();
            this.layout.updateState(this.state);
            
            // Update workstream status based on PR Watch events
            this.updateWorkstreamFromPRWatchEvent(callbackWorkstreamId, message);
            
            // NEW: Add as persistent chat message in the workstream conversation
            this.addPRWatchMessageToWorkstream(callbackWorkstreamId, message);
            break;
          }
        }
      }
    };
    this.agentSession.setProgressCallback(progressCallback);
    
    // Restore conversation if exists
    if (workstream.messages.length > 0) {
      const { deserializeMessages } = await import('../storage/checkpoints.js');
      const messages = deserializeMessages(workstream.messages);
      
      // Safety check: estimate token size before restoring
      const estimatedTokens = messages.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return sum + Math.ceil(content.length / 4);
      }, 0);
      
      if (estimatedTokens > 500000) {
        // Conversation is dangerously large - create debug dump and start fresh
        console.warn(`Workstream ${workstream.name} has ${estimatedTokens} estimated tokens - creating debug dump`);
        try {
          await handleTokenOverflow({
            errorMessage: `Conversation restore blocked: ${estimatedTokens} estimated tokens exceeds safety limit`,
            estimatedTokens,
            trigger: 'restore',
            workstreamId: workstream.id,
            workstreamName: workstream.name,
            conversationMessages: workstream.messages.map(m => ({
              type: m.type,
              content: m.content,
              toolCalls: m.toolCalls,
            })),
          });
          await this.refreshTasks();
          this.notificationManager.add({
            type: 'error',
            message: `🚨 Conversation too large (${Math.round(estimatedTokens / 1000)}k tokens) - debug dump saved, starting fresh`,
            workstreamId: workstream.id,
          });
        } catch (dumpError) {
          console.error('Failed to create token overflow dump:', dumpError);
          this.notificationManager.add({
            type: 'error',
            message: `Conversation too large (${Math.round(estimatedTokens / 1000)}k tokens) - starting fresh`,
            workstreamId: workstream.id,
          });
        }
        
        // Clear the corrupted messages from the workstream
        await this.workstreamManager.update(workstream.id, {
          messages: [],
          tokenEstimate: 0,
          turnCount: 0,
        });
        this.refreshWorkstreams();
      } else {
        await this.agentSession.restoreFromCheckpoint(messages, {
          personality: workstream.personality as any,
          character: workstream.character,
          datadogEnabled: workstream.datadogEnabled,
        });
      }
    }
    
    // Force clear and re-render conversation to prevent stale/partial content
    // from background processing of other workstreams
    this.layout.clearAndRenderConversation(workstream);
    this.layout.updateState(this.state);
  }

  private updateWorkstreamFromPRWatchEvent(workstreamId: string, message: string): void {
    const workstream = this.state.workstreams.find(w => w.id === workstreamId);
    if (!workstream) return;

    // Map PR Watch events to workstream status
    if (message.includes('🎯 PR Watch started')) {
      workstream.status = 'in_progress';
      workstream.statusMessage = 'PR Watch: Monitoring CI';
    } else if (message.includes('🔴 Failure detected')) {
      workstream.status = 'in_progress';
      const match = message.match(/Failure detected: (.+)/);
      workstream.statusMessage = match 
        ? `PR Watch: Failure - ${match[1]}`
        : 'PR Watch: CI failure detected';
    } else if (message.includes('🔧 Fixing')) {
      workstream.status = 'in_progress';
      const attemptMatch = message.match(/attempt (\d+)/);
      workstream.statusMessage = attemptMatch
        ? `PR Watch: Fixing (attempt ${attemptMatch[1]})`
        : 'PR Watch: Applying fix';
    } else if (message.includes('📝 Fix committed')) {
      workstream.status = 'in_progress';
      workstream.statusMessage = 'PR Watch: Fix pushed, waiting for CI';
    } else if (message.includes('🎉 All checks passing')) {
      workstream.status = 'done';
      workstream.statusMessage = 'PR Watch: All checks passing ✓';
    } else if (message.includes('⚠️ Max attempts')) {
      workstream.status = 'needs_input';
      workstream.statusMessage = 'PR Watch: Max attempts - needs manual help';
    } else if (message.includes('🛑 PR Watch stopped')) {
      workstream.status = 'waiting';
      workstream.statusMessage = 'PR Watch stopped';
    } else if (message.includes('⏳ Waiting for')) {
      workstream.status = 'in_progress';
      const checkMatch = message.match(/(\d+) check/);
      workstream.statusMessage = checkMatch
        ? `PR Watch: Waiting for ${checkMatch[1]} checks`
        : 'PR Watch: Waiting for CI';
    } else if (message.includes('✅ All') && message.includes('passing')) {
      workstream.status = 'in_progress';
      workstream.statusMessage = 'PR Watch: Monitoring (passing)';
    } else if (message.includes('❌') && message.includes('failing')) {
      workstream.status = 'in_progress';
      workstream.statusMessage = 'PR Watch: Monitoring (failures detected)';
    }

    // Persist the updated status
    this.workstreamManager.update(workstreamId, {
      status: workstream.status,
      statusMessage: workstream.statusMessage,
    });

    // Update UI
    this.layout.updateState(this.state);
  }

  /**
   * Add PR Watch event as a persistent system message in the workstream conversation
   * This ensures the messages persist across sessions and workstream switches
   */
  private async addPRWatchMessageToWorkstream(workstreamId: string, message: string): Promise<void> {
    const workstream = this.workstreamManager.get(workstreamId);
    if (!workstream) return;

    // Import SystemMessage for creating system messages
    const { SystemMessage } = await import('@langchain/core/messages');
    
    // Create a system message for the PR Watch event
    const systemMessage = new SystemMessage(`[PR Watch] ${message}`);
    
    // Serialize and add to workstream messages
    const serialized = serializeMessages([systemMessage]);
    const updatedMessages = [...workstream.messages, ...serialized];
    
    // Update the workstream with the new message
    await this.workstreamManager.update(workstreamId, {
      messages: updatedMessages,
    });
    
    // Refresh state to reflect the new message
    this.refreshWorkstreams();
    
    // If we're viewing this workstream, update the conversation display
    if (this.state.activeWorkstreamId === workstreamId && this.agentSession) {
      // Get the updated workstream and re-render the conversation
      const updatedWorkstream = this.workstreamManager.get(workstreamId);
      if (updatedWorkstream) {
        this.layout.clearAndRenderConversation(updatedWorkstream);
      }
    }
  }

  /**
   * Persist progress message to workstream's liveProgress field
   * This ensures progress is visible when returning to the workstream after switching
   */
  private persistProgressToWorkstream(workstreamId: string, message: string): void {
    const workstream = this.state.workstreams.find(w => w.id === workstreamId);
    if (!workstream) return;

    // Initialize liveProgress if not present
    if (!workstream.liveProgress) {
      workstream.liveProgress = {
        toolCalls: [],
        lastUpdated: Date.now(),
      };
    }

    const now = Date.now();
    
    // Track cursor status
    if (message.includes('Cursor') || message.includes('cursor')) {
      workstream.liveProgress.cursorStatus = message;
      
      // Track when cursor started
      if (message.includes('starting up') || message.includes('Starting Cursor')) {
        workstream.liveProgress.cursorStartedAt = now;
      }
      
      // Clear cursor tracking when finished
      if (message.includes('finished') || message.includes('completed') || message.includes('Timed out')) {
        workstream.liveProgress.cursorStartedAt = undefined;
      }
    }
    
    // Track tool calls (messages starting with →)
    if (message.startsWith('→') || message.includes('→ ')) {
      const toolMatch = message.match(/→\s*(\w+)\(/);
      if (toolMatch) {
        const toolName = toolMatch[1];
        const preview = message.substring(0, 100);
        
        // Keep only the last 10 tool calls
        if (!workstream.liveProgress.toolCalls) {
          workstream.liveProgress.toolCalls = [];
        }
        workstream.liveProgress.toolCalls.push({
          name: toolName,
          timestamp: now,
          preview,
        });
        if (workstream.liveProgress.toolCalls.length > 10) {
          workstream.liveProgress.toolCalls = workstream.liveProgress.toolCalls.slice(-10);
        }
      }
    }
    
    workstream.liveProgress.lastUpdated = now;
    
    // Don't persist to disk on every progress update (too slow)
    // The liveProgress is in-memory only and will be shown when returning to workstream
  }

  private async createWorkstream(type: string, name: string, metadata?: Record<string, any>): Promise<void> {
    const isFromTask = !!metadata?.description;
    
    const workstream = await this.workstreamManager.create(type as any, name, metadata);
    this.refreshWorkstreams();
    
    // Auto-select the new workstream
    await this.selectWorkstream(workstream.id);
    
    // If created from task, return focus to tasks panel immediately
    // and send message in background (non-blocking)
    if (isFromTask && metadata?.description) {
      this.state.focusedPane = 'tasks';
      this.layout.updateState(this.state);
      
      // Fire and forget - don't await, let agent work in background
      this.sendMessage(metadata.description).catch(err => {
        console.error('Error sending task message:', err);
      });
    }
  }

  private async deleteWorkstream(workstreamId: string): Promise<void> {
    await this.workstreamManager.delete(workstreamId);
    this.refreshWorkstreams();
    
    // Clean up the session from active sessions map
    this.activeSessions.delete(workstreamId);
    
    if (this.state.activeWorkstreamId === workstreamId) {
      this.state.activeWorkstreamId = null;
      this.agentSession = null;
    }
    
    this.layout.updateState(this.state);
    this.layout.showSuccess('Workstream moved to trash');
  }

  private async restoreFromTrash(workstreamId: string): Promise<void> {
    const restored = await this.workstreamManager.restoreFromTrash(workstreamId);
    if (restored) {
      this.refreshWorkstreams();
      this.layout.updateState(this.state);
      this.layout.showSuccess(`Restored "${restored.name}"`);
    } else {
      this.layout.showError('Failed to restore workstream');
    }
  }

  private async permanentlyDeleteFromTrash(workstreamId: string): Promise<void> {
    const success = await this.workstreamManager.permanentlyDelete(workstreamId);
    if (success) {
      this.layout.showSuccess('Permanently deleted');
    } else {
      this.layout.showError('Failed to delete');
    }
  }

  private async emptyTrash(): Promise<void> {
    const { getTrashBinManager } = await import('./state/trash.js');
    const trashBin = getTrashBinManager();
    const count = await trashBin.emptyTrash();
    this.layout.showSuccess(`Emptied trash (${count} items deleted)`);
  }

  private async createTask(content: string, priority?: string): Promise<void> {
    await createTaskInMemory(content, { priority: (priority || 'medium') as 'low' | 'medium' | 'high' | 'urgent' });
    await this.refreshTasks();
    this.layout.updateState(this.state);
  }

  private async deleteTask(taskId: string): Promise<void> {
    await deleteTaskFromMemory(taskId);
    await this.refreshTasks();
    
    // Adjust selected index if needed
    if (this.state.selectedTaskIndex >= this.state.tasks.length) {
      this.state.selectedTaskIndex = Math.max(0, this.state.tasks.length - 1);
    }
    
    this.layout.updateState(this.state);
  }

  private async refreshTasks(): Promise<void> {
    const tasks = await getActiveTasks();
    this.state.tasks = tasks.map(t => ({
      id: t.id,
      content: t.content,
      status: (t.status || 'pending') as Task['status'],
      priority: (t.priority || 'medium') as Task['priority'],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      dueDate: t.dueDate,
      tags: t.tags,
      context: t.context,
    }));
  }

  // ===== Advice Methods =====

  private async switchToGeneralChat(): Promise<void> {
    // Save current workstream if we have one
    if (this.state.activeWorkstreamId && this.agentSession) {
      await this.saveCurrentWorkstream();
      
      // Keep the session in activeSessions map if it's still processing
      if (this.agentSession.isProcessing()) {
        this.activeSessions.set(this.state.activeWorkstreamId, this.agentSession);
      }
    }
    
    // Switch to general chat mode (no workstream, no advice)
    this.state.activeWorkstreamId = null;
    this.state.activeAdviceId = null;
    this.state.focusedPane = 'conversation';
    
    // Update voice service (null = general chat)
    this.voiceService.setActiveWorkstream(null);
    
    // Create general chat session if needed
    if (!this.generalChatSession) {
      const prefs = await getSessionPreferences();
      let characterType: CharacterType = 'none';
      let customDesc: string | undefined;
      
      if (prefs.characterType === 'custom' && prefs.builtinCharacter) {
        characterType = 'custom';
        customDesc = prefs.builtinCharacter;
      } else if (prefs.characterType === 'builtin' && prefs.builtinCharacter) {
        characterType = prefs.builtinCharacter as CharacterType;
      }
      
      this.generalChatSession = new WorkAgentSession(
        false, // no datadog
        'default' as PersonalityType,
        characterType,
        customDesc
      );
      
      // Set up progress callback for general chat
      const progressCallback = (msg: string) => {
        if (!this.state.activeWorkstreamId) {
          this.layout.showProgress(msg);
        }
      };
      this.generalChatSession.setProgressCallback(progressCallback);
    }
    
    // Update agent session reference
    this.agentSession = this.generalChatSession;
    
    // Update UI
    this.layout.updateState(this.state);
    this.layout.showInfo('Switched to general chat (ephemeral, not saved to workstreams)');
  }

  private async selectAdvice(adviceId: string): Promise<void> {
    // Save current workstream if we have one (to avoid polluting it)
    if (this.state.activeWorkstreamId && this.agentSession) {
      await this.saveCurrentWorkstream();
      
      // Keep the session in activeSessions map if it's still processing
      if (this.agentSession.isProcessing()) {
        this.activeSessions.set(this.state.activeWorkstreamId, this.agentSession);
      }
    }
    
    // Mark as read
    markTopicRead(adviceId);
    
    // Get the advice topic
    const topic = getTopicById(adviceId);
    if (!topic) {
      this.layout.showError('Advice topic not found');
      return;
    }
    
    // Build the context message to show in general chat
    // Gather Slack message links
    const slackLinks = topic.sourceMessages
      .filter(m => m.threadUrl)
      .map(m => m.threadUrl)
      .slice(0, 3);  // Max 3 links to keep concise
    
    // Gather relevant quotes (concise)
    const quotes = topic.sourceMessages
      .slice(0, 3)  // Max 3 quotes
      .map(m => `> "${m.content.substring(0, 150)}${m.content.length > 150 ? '...' : ''}"\n> — ${m.author}`)
      .join('\n\n');
    
    // Build references section
    let referencesSection = '';
    if (topic.references && topic.references.length > 0) {
      const refList = topic.references
        .slice(0, 5)  // Max 5 references
        .map(ref => {
          let refText = `• ${ref.url}`;
          if (ref.title) {
            refText += `\n  "${ref.title}"`;
          }
          if (ref.relevance) {
            refText += `\n  ${ref.relevance}`;
          }
          return refText;
        })
        .join('\n\n');
      
      referencesSection = `\n\n**External References:**\n${refList}`;
    }
    
    const contextMessage = `📌 **Advice: ${topic.title}** (#${topic.sourceChannel})

${topic.summary}

**Relevance:** ${topic.relevanceReason}

**Slack Message:**
${slackLinks.length > 0 ? slackLinks.map(url => `• ${url}`).join('\n') : '• (No direct links available)'}${referencesSection}

**Key Quotes:**
${quotes}

---
What would you like to know?`;
    
    // Switch to general chat mode (no workstream)
    this.state.activeWorkstreamId = null;
    this.state.activeAdviceId = adviceId;
    this.state.focusedPane = 'conversation';
    
    // Create general chat session if needed
    if (!this.generalChatSession) {
      const prefs = await getSessionPreferences();
      let characterType: CharacterType = 'none';
      let customDesc: string | undefined;
      
      if (prefs.characterType === 'custom' && prefs.builtinCharacter) {
        characterType = 'custom';
        customDesc = prefs.builtinCharacter;
      } else if (prefs.characterType === 'builtin' && prefs.builtinCharacter) {
        characterType = prefs.builtinCharacter as CharacterType;
      }
      
      this.generalChatSession = new WorkAgentSession(
        false, // no datadog
        'default' as PersonalityType,
        characterType,
        customDesc
      );
      
      // Set up progress callback for general chat
      const progressCallback = (msg: string) => {
        if (!this.state.activeWorkstreamId) {
          this.layout.showProgress(msg);
        }
      };
      this.generalChatSession.setProgressCallback(progressCallback);
    }
    
    // Update agent session reference
    this.agentSession = this.generalChatSession;
    
    // Build full context with actual messages
    const messageContext = topic.sourceMessages
      .map((m, idx) => {
        let msgText = `Message ${idx + 1} from ${m.author} (${m.timestamp}):\n${m.content}`;
        if (m.threadUrl) {
          msgText += `\nThread link: ${m.threadUrl}`;
        }
        return msgText;
      })
      .join('\n\n---\n\n');
    
    // Send the advice context as an initial message with full details
    const initialQuery = `I have an advice topic that was flagged from a workplace discussion. Here's the context:

**Topic:** ${topic.title}

**Summary:** ${topic.summary}

**Why it's relevant to me:** ${topic.relevanceReason}

**Original messages from the discussion:**

${messageContext}

---

Can you help me understand what's being discussed and suggest what actions I should consider? Please analyze based on the context provided above - you don't need to access any external sources.`;
    
    // Queue the message to be sent
    setTimeout(async () => {
      await this.sendMessage(initialQuery);
    }, 100);
    
    // Refresh advice to show it as read
    await this.refreshAdvice();
    
    this.layout.updateState(this.state);
    this.layout.showSuccess(`Opening advice: ${topic.title}`);
  }

  private async dismissAdvice(adviceId: string): Promise<void> {
    dismissTopic(adviceId);
    await this.refreshAdvice();
    
    // Adjust selected index if needed
    if (this.state.selectedAdviceIndex >= this.state.adviceTopics.length) {
      this.state.selectedAdviceIndex = Math.max(0, this.state.adviceTopics.length - 1);
    }
    
    this.layout.updateState(this.state);
    this.layout.showInfo('Advice dismissed');
  }

  private async refreshAdvice(): Promise<void> {
    const topics = getActiveTopics();
    this.state.adviceTopics = topics.map(t => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      relevanceReason: t.relevanceReason,
      sourceChannel: t.sourceChannel,
      priority: t.priority,
      createdAt: t.createdAt,
      readAt: t.readAt,
      tags: t.tags,
    }));
    
    // Only update state if layout is ready
    if (this.layout) {
      this.layout.updateState(this.state);
    }
  }

  private async triggerAdviceScan(): Promise<void> {
    const poller = getAdvicePoller();
    if (poller.isCurrentlyPolling()) {
      this.layout.showInfo('Advice scan already in progress...');
      return;
    }
    
    this.layout.showInfo('Scanning Slack channels for advice...');
    
    try {
      const newTopics = await poller.pollNow();
      if (newTopics.length > 0) {
        this.layout.showSuccess(`Found ${newTopics.length} new advice topic(s)!`);
        await this.refreshAdvice();
      } else {
        this.layout.showInfo('No new advice found');
      }
    } catch (error) {
      this.layout.showError(`Advice scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleAdviceCommand(args: string): Promise<void> {
    // Import advice storage functions
    const { 
      loadAdviceConfig, 
      addWatchedChannel, 
      removeWatchedChannel, 
      setAdviceEnabled 
    } = await import('../advice/index.js');
    
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(' ');
    
    switch (subcommand) {
      case 'watch':
        if (!arg) {
          this.layout.showError('Usage: /advice watch <channel-name>');
          return;
        }
        addWatchedChannel(arg);
        this.layout.showSuccess(`Now watching #${arg} for advice`);
        break;
        
      case 'unwatch':
        if (!arg) {
          this.layout.showError('Usage: /advice unwatch <channel-name>');
          return;
        }
        removeWatchedChannel(arg);
        this.layout.showSuccess(`Stopped watching #${arg}`);
        break;
        
      case 'list':
        const config = loadAdviceConfig();
        const channels = config.watchedChannels.filter(ch => ch.enabled);
        if (channels.length === 0) {
          this.layout.showInfo('No channels being watched. Use /advice watch <channel>');
        } else {
          const list = channels.map(ch => `#${ch.name}`).join(', ');
          this.layout.showInfo(`Watching: ${list}`);
        }
        break;
        
      case 'on':
        setAdviceEnabled(true);
        this.layout.showSuccess('Advice feature enabled');
        break;
        
      case 'off':
        setAdviceEnabled(false);
        this.layout.showInfo('Advice feature disabled');
        break;
        
      case 'scan':
        await this.triggerAdviceScan();
        break;
        
      default:
        this.layout.showInfo('Advice commands: /advice watch <channel>, /advice unwatch <channel>, /advice list, /advice on, /advice off, /advice scan');
        break;
    }
  }

  private async handleModelCommand(args: string): Promise<void> {
    if (!this.state.activeWorkstreamId) {
      this.layout.showError('Select a workstream first to change model configuration');
      return;
    }

    const workstream = this.workstreamManager.get(this.state.activeWorkstreamId);
    if (!workstream) {
      this.layout.showError('Workstream not found');
      return;
    }

    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase();

    switch (subcommand) {
      case 'show':
      case 'list':
      case '':
        // Display current model configuration
        const standardModel = workstream.modelConfig?.standardModel || 'gemini-3-flash-preview (default)';
        const externalModel = workstream.modelConfig?.externalCommsModel || 'gemini-3-pro-preview (default)';
        this.layout.showInfo(
          `Current models:\n` +
          `  Standard (chat/analysis): ${standardModel}\n` +
          `  External (Slack/JIRA): ${externalModel}\n\n` +
          `Available models: gemini-2.0-flash-exp, gemini-3-pro-preview, gemini-3-flash-preview`
        );
        break;

      case 'set':
        const modelType = parts[1]?.toLowerCase();
        const modelName = parts[2];

        if (!modelType || !modelName) {
          this.layout.showError(
            'Usage: /model set <standard|external> <model-name>\n' +
            'Example: /model set standard gemini-3-pro-preview'
          );
          return;
        }

        if (modelType !== 'standard' && modelType !== 'external') {
          this.layout.showError('Model type must be "standard" or "external"');
          return;
        }

        // Update the model config
        const currentConfig = workstream.modelConfig || {};
        const newConfig = { ...currentConfig };

        if (modelType === 'standard') {
          newConfig.standardModel = modelName;
        } else {
          newConfig.externalCommsModel = modelName;
        }

        await this.workstreamManager.update(this.state.activeWorkstreamId, {
          modelConfig: newConfig
        });

        this.refreshWorkstreams();
        this.layout.updateState(this.state);
        this.layout.showSuccess(
          `${modelType === 'standard' ? 'Standard' : 'External'} model set to: ${modelName}\n` +
          `Note: Restart the workstream (or create a new message) for changes to take effect.`
        );
        break;

      case 'reset':
        // Reset to defaults
        await this.workstreamManager.update(this.state.activeWorkstreamId, {
          modelConfig: {
            standardModel: 'gemini-2.0-flash-exp',
            externalCommsModel: 'gemini-3-pro-preview'
          }
        });

        this.refreshWorkstreams();
        this.layout.updateState(this.state);
        this.layout.showSuccess('Model configuration reset to defaults');
        break;

      default:
        this.layout.showInfo(
          'Model commands:\n' +
          '  /model show - Display current model configuration\n' +
          '  /model set <standard|external> <model-name> - Set model\n' +
          '  /model reset - Reset to default models\n\n' +
          'Examples:\n' +
          '  /model set standard gemini-3-pro-preview\n' +
          '  /model set external gemini-2.0-flash-exp'
        );
        break;
    }
  }

  private async saveCurrentWorkstream(): Promise<void> {
    if (!this.state.activeWorkstreamId || !this.agentSession) return;
    await this.saveWorkstream(this.state.activeWorkstreamId, this.agentSession);
  }

  private async sendMessage(message: string): Promise<void> {
    // Determine if we're in general chat mode or workstream mode
    const isGeneralChat = !this.state.activeWorkstreamId;
    
    // Get or create the appropriate session
    let targetSession: WorkAgentSession;
    let targetWorkstreamId: string | null;
    
    if (isGeneralChat) {
      // General chat mode - create ephemeral session if needed
      if (!this.generalChatSession) {
        const prefs = await getSessionPreferences();
        let characterType: CharacterType = 'none';
        let customDesc: string | undefined;
        
        if (prefs.characterType === 'custom' && prefs.builtinCharacter) {
          characterType = 'custom';
          customDesc = prefs.builtinCharacter;
        } else if (prefs.characterType === 'builtin' && prefs.builtinCharacter) {
          characterType = prefs.builtinCharacter as CharacterType;
        }
        
        this.generalChatSession = new WorkAgentSession(
          false, // no datadog
          'default' as PersonalityType,
          characterType,
          customDesc
        );
        
        // Set up progress callback for general chat
        const progressCallback = (msg: string) => {
          if (!this.state.activeWorkstreamId) {
            this.layout.showProgress(msg);
          }
        };
        this.generalChatSession.setProgressCallback(progressCallback);
      }
      targetSession = this.generalChatSession;
      targetWorkstreamId = null;
    } else {
      // Workstream mode - use existing session
      if (!this.agentSession) return;
      
      // Check if THIS workstream is already processing
      const workstream = this.state.workstreams.find(w => w.id === this.state.activeWorkstreamId);
      if (workstream?.isProcessing) {
        this.layout.showInfo('This workstream is still processing... Please wait.');
        return;
      }
      
      targetSession = this.agentSession;
      targetWorkstreamId = this.state.activeWorkstreamId;
    }
    
    // Check if user wants to stop/interrupt the agent
    const stopPatterns = /^(stop|cancel|abort|halt|nevermind|never mind)\.?!?$/i;
    const workstream = isGeneralChat ? null : this.state.workstreams.find(w => w.id === targetWorkstreamId);
    if (stopPatterns.test(message.trim()) && workstream?.isProcessing) {
      const interrupted = targetSession.interrupt();
      if (interrupted) {
        this.layout.showInfo('Stopping... (agent will stop after current tool completes)');
        return; // Don't send the "stop" message to the agent
      }
    }
    
    // Set up cursor progress callback
    // The callback now receives (msg, sourceWorkstreamId) to prevent cross-workstream bleeding
    // Messages only show if the source workstream matches the currently active workstream
    setCursorProgressCallback((msg: string, sourceWorkstreamId: string | null) => {
      if (isGeneralChat) {
        // For general chat, show if still in general chat AND source is general chat (null)
        if (!this.state.activeWorkstreamId && !sourceWorkstreamId) {
          this.layout.showProgress(msg);
        }
      } else {
        // For workstream mode, show if active AND source matches target
        if (this.state.activeWorkstreamId === targetWorkstreamId && 
            sourceWorkstreamId === targetWorkstreamId) {
          this.layout.showProgress(msg);
        }
      }
    });
    
    // Update status for workstream mode - mark THIS workstream as processing
    if (!isGeneralChat && workstream) {
      workstream.status = 'in_progress';
      workstream.statusMessage = 'Processing...';
      workstream.isProcessing = true;
      this.layout.updateState(this.state);
    }
    
    // Show thinking indicator
    this.layout.showProgress('Thinking...');
    
    try {
      const { response, interrupted, hitRecursionLimit } = await targetSession.chat(message);
      
      // Handle rate limit specially - show as notification instead of in conversation
      // Note: rateLimited flag removed from agent response - handle via error catching instead
      
      if (isGeneralChat) {
        // General chat mode - always show response if still in general chat
        const stillInGeneralChat = !this.state.activeWorkstreamId;
        
        if (stillInGeneralChat) {
          this.layout.appendResponse(response);
          // Speak response if TTS is enabled (voice service checks if we're on general chat)
          this.voiceService.speakResponse(response, null).catch(() => {
            // Ignore TTS errors
          });
        } else {
          // User switched to a workstream while general chat was processing
          this.layout.showInfo('General chat response received (switched to workstream)');
        }
      } else {
        // Workstream mode - existing behavior
        const stillOnSameWorkstream = this.state.activeWorkstreamId === targetWorkstreamId;
        
        // Update the target workstream status (find it again in case state changed)
        const targetWorkstream = this.state.workstreams.find(w => w.id === targetWorkstreamId);
        if (targetWorkstream) {
          targetWorkstream.isProcessing = false; // CRITICAL: Mark as not processing anymore
          
          if (interrupted) {
            targetWorkstream.status = 'needs_input';
            targetWorkstream.statusMessage = 'Interrupted - waiting for input';
          } else if (hitRecursionLimit) {
            targetWorkstream.status = 'needs_input';
            targetWorkstream.statusMessage = 'Hit step limit - say "continue" to resume';
          } else {
            targetWorkstream.status = 'waiting';
            targetWorkstream.statusMessage = 'Waiting for your input';
          }
        }
        
        // Save conversation state to the correct workstream
        await this.saveWorkstream(targetWorkstreamId!, targetSession);
        
        // Only show response in UI if we're still on the same workstream
        if (stillOnSameWorkstream) {
          this.layout.appendResponse(response);
          // Speak response if TTS is enabled (voice service checks workstream)
          this.voiceService.speakResponse(response, targetWorkstreamId).catch(() => {
            // Ignore TTS errors
          });
        } else {
          // Notify user that response arrived for different workstream
          this.notificationManager.add({
            type: 'agent_done',
            message: `Response ready for: ${targetWorkstream?.name || 'workstream'}`,
            workstreamId: targetWorkstreamId!,
          });
          this.state.notifications = this.notificationManager.getNotifications();
        }
        
        // Clean up from active sessions if done processing
        // Check if the session in the map is the same instance (could have been replaced)
        if (this.activeSessions.get(targetWorkstreamId!) === targetSession && !targetSession.isProcessing()) {
          // Keep the session in the map - we might switch back and reuse it
          // Only remove if it's been idle for a while (handled in a cleanup cycle)
        }
      }
      
      // Refresh tasks - agent might have created/updated/deleted tasks
      await this.refreshTasks();
      this.layout.updateState(this.state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if this is a rate limit error - handle specially
      const isRateLimit = errorMessage.includes('429') || 
                         errorMessage.includes('rate limit') || 
                         errorMessage.includes('Too Many Requests') ||
                         errorMessage.includes('quota');
      
      if (isRateLimit) {
        // Add rate limit error as notification instead of showing in conversation
        this.notificationManager.add({
          type: 'error',
          message: '⚠️ API Rate Limit - wait 2-5 min and try again',
          workstreamId: isGeneralChat ? undefined : (targetWorkstreamId || undefined),
        });
        this.state.notifications = this.notificationManager.getNotifications();
        
        if (!isGeneralChat) {
          const targetWorkstream = this.state.workstreams.find(w => w.id === targetWorkstreamId);
          if (targetWorkstream) {
            targetWorkstream.isProcessing = false;
            targetWorkstream.status = 'needs_input';
            targetWorkstream.statusMessage = 'Rate limited - retry in a few minutes';
          }
        }
        
        this.layout.updateState(this.state);
        return;
      }
      
      if (isGeneralChat) {
        // General chat mode error handling
        this.layout.showError(`Error in general chat: ${errorMessage}`);
      } else {
        // Workstream mode error handling
        const targetWorkstream = this.state.workstreams.find(w => w.id === targetWorkstreamId);
        
        if (targetWorkstream) {
          targetWorkstream.isProcessing = false; // CRITICAL: Clear processing flag on error
          targetWorkstream.status = 'error';
          targetWorkstream.statusMessage = errorMessage;
        }
        
        // Check if this is a token overflow error
        if (isTokenOverflowError(error)) {
          // Get all the debug info we can
          const messages = targetSession.getMessages();
          const stats = targetSession.getStats();
          
          // Create debug dump and investigation task
          try {
            await handleTokenOverflow({
              errorMessage,
              estimatedTokens: stats.estimated,
              trigger: 'chat',
              workstreamId: targetWorkstreamId!,
              workstreamName: targetWorkstream?.name,
              userMessage: message,
              conversationMessages: messages.map(m => ({
                type: m.constructor.name,
                content: m.content,
                toolCalls: (m as any).tool_calls,
              })),
              metadata: {
                turnCount: stats.turns,
                messageCount: stats.messageCount,
              },
            });
            
            // Refresh tasks so the new investigation task appears
            await this.refreshTasks();
            
            this.notificationManager.add({
              type: 'error',
              message: `🚨 TOKEN OVERFLOW - Debug dump saved & investigation task created`,
              workstreamId: targetWorkstreamId!,
            });
          } catch (dumpError) {
            console.error('Failed to create token overflow dump:', dumpError);
            this.notificationManager.add({
              type: 'error',
              message: `Error: ${errorMessage}`,
              workstreamId: targetWorkstreamId!,
            });
          }
        } else {
          this.notificationManager.add({
            type: 'error',
            message: `Error: ${errorMessage}`,
            workstreamId: targetWorkstreamId!,
          });
        }
        
        this.state.notifications = this.notificationManager.getNotifications();
      }
    }
    // NO LONGER setting global state.isProcessing = false
    // Each workstream manages its own processing state
  }

  private async saveWorkstream(workstreamId: string, session: WorkAgentSession): Promise<void> {
    const stats = session.getStats();
    const messages = session.getMessages();
    
    await this.workstreamManager.update(workstreamId, {
      messages: serializeMessages(messages),
      tokenEstimate: stats.estimated,
      turnCount: stats.turns,
      updatedAt: Date.now(),
    });
    
    this.refreshWorkstreams();
  }

  /**
   * Refresh workstreams from disk while preserving in-memory liveProgress
   * This is critical because liveProgress tracks transient state that shouldn't be lost
   */
  private refreshWorkstreams(): void {
    const freshWorkstreams = this.workstreamManager.getAll();
    
    // Preserve liveProgress from existing state
    for (const freshWs of freshWorkstreams) {
      const existingWs = this.state.workstreams.find(w => w.id === freshWs.id);
      if (existingWs?.liveProgress) {
        freshWs.liveProgress = existingWs.liveProgress;
      }
    }
    
    this.state.workstreams = freshWorkstreams;
  }

  async start(): Promise<void> {
    // Import platform utilities for startup message (additional functions not imported at top)
    const { getPlatformStartupMessage } = await import('../../utils/platform/index.js');
    
    // Show platform info and any feature limitations
    const platformMessage = getPlatformStartupMessage();
    if (platformMessage) {
      this.layout.showInfo(platformMessage);
    }
    
    // Show terminal capability warning if running in a limited terminal
    const terminalWarning = TerminalService.getCapabilityWarning();
    if (terminalWarning) {
      this.layout.showInfo(terminalWarning);
    }
    
    // Load existing workstreams
    await this.workstreamManager.load();
    this.refreshWorkstreams();
    
    // Load active tasks
    const tasks = await getActiveTasks();
    this.state.tasks = tasks.map(t => ({
      id: t.id,
      content: t.content,
      status: (t.status || 'pending') as Task['status'],
      priority: (t.priority || 'medium') as Task['priority'],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      dueDate: t.dueDate,
      tags: t.tags,
      context: t.context,
    }));
    
    // Load existing notifications
    this.state.notifications = this.notificationManager.getNotifications();
    
    // Load advice topics
    await this.refreshAdvice();
    
    // Start background polling
    this.backgroundPoller.start();
    
    // Start advice polling (scans Slack for updates)
    const advicePoller = getAdvicePoller();
    advicePoller.on('new_topics', async () => {
      await this.refreshAdvice();
      this.notificationManager.add({
        type: 'info',
        message: '💡 New advice available!',
      });
      this.state.notifications = this.notificationManager.getNotifications();
      this.layout.updateState(this.state);
    });
    advicePoller.start();
    
    // Subscribe to notification updates
    this.backgroundPoller.on('notification', async () => {
      this.state.notifications = this.notificationManager.getNotifications();
      this.refreshWorkstreams();
      
      // Refresh tasks too
      const freshTasks = await getActiveTasks();
      this.state.tasks = freshTasks.map(t => ({
        id: t.id,
        content: t.content,
        status: (t.status || 'pending') as Task['status'],
        priority: (t.priority || 'medium') as Task['priority'],
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        dueDate: t.dueDate,
        tags: t.tags,
        context: t.context,
      }));
      
      this.layout.updateState(this.state);
    });
    
    // Initial render
    this.layout.updateState(this.state);
    this.screen.render();
  }

  async quit(): Promise<void> {
    // Save current workstream
    await this.saveCurrentWorkstream();
    
    // Clear cursor progress callback to avoid TUI writes after destroy
    setCursorProgressCallback(null);
    
    // Stop advice polling
    const advicePoller = getAdvicePoller();
    advicePoller.stop();
    
    // Stop background polling
    this.backgroundPoller.stop();
    
    // Clean up voice service
    this.voiceService.destroy();
    
    // Destroy screen
    this.screen.destroy();
    process.exit(0);
  }
}

// Main entry point
export async function runWorkTUI(): Promise<void> {
  const tui = new WorkTUI();
  await tui.start();
}
