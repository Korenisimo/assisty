// Main Layout Component - orchestrates the TUI layout
// k9s-style split pane layout with workstream list, conversation, notifications, status bar

import blessed from 'blessed';
import { TUIState, TUIEvent, Workstream, STATUS_INDICATORS, AdviceTopicSummary, VoiceState } from '../types.js';
import { markdownToBlessed, stripAnsi, wrapLine } from '../utils/markdown.js';
import { getCustomCharacters, type CustomCharacter } from '../../storage/characters.js';
import { getTrashBinManager, TrashedWorkstream, TrashSearchResult } from '../state/trash.js';
import { isFeatureAvailable } from '../../../utils/platform/index.js';

export class Layout {
  private screen: blessed.Widgets.Screen;
  private state: TUIState;
  private onEvent: (event: TUIEvent) => void;
  
  // UI Components - initialized in createLayout() called from constructor
  private leftPane!: blessed.Widgets.BoxElement;
  private workstreamList!: blessed.Widgets.ListElement;
  private tasksList!: blessed.Widgets.ListElement;
  private adviceList!: blessed.Widgets.ListElement;
  private notificationBox!: blessed.Widgets.BoxElement;
  private rightPane!: blessed.Widgets.BoxElement;
  private conversationHeader!: blessed.Widgets.BoxElement;
  private conversationLog!: blessed.Widgets.Log;
  private inputBox!: blessed.Widgets.TextareaElement;
  private statusBar!: blessed.Widgets.BoxElement;
  
  private helpOverlay: blessed.Widgets.BoxElement | null = null;
  private cursorLogOverlay: blessed.Widgets.BoxElement | null = null;
  private cursorLogRefreshInterval: NodeJS.Timeout | null = null;
  private trashOverlay: blessed.Widgets.BoxElement | null = null;
  private selectedIndex = 0;
  private selectedTaskIndex = 0;
  private selectedAdviceIndex = 0;
  private lastActiveWorkstreamId: string | null = null;
  private lastActiveAdviceId: string | null = null;
  private lastProgressRender = 0;  // Throttle progress renders to prevent artifacts
  private progressRenderTimeout: NodeJS.Timeout | null = null;
  private pendingProgressMessages: string[] = [];  // Queue for batching progress messages
  private progressFlushTimeout: NodeJS.Timeout | null = null;
  
  // Voice state
  private voiceState: VoiceState = {
    ttsEnabled: false,
    isRecording: false,
    isSpeaking: false,
    isTranscribing: false,
    isPreprocessing: false,
  };
  
  // Dialog state - prevents opening multiple dialogs
  private dialogOpen = false;

  constructor(screen: blessed.Widgets.Screen, state: TUIState, onEvent: (event: TUIEvent) => void) {
    this.screen = screen;
    this.state = state;
    this.onEvent = onEvent;
    
    this.createLayout();
    this.setupKeyBindings();
  }

  /**
   * Log a line to conversation, with proper wrapping to prevent overflow artifacts
   */
  private logWrapped(text: string): void {
    // Calculate available width: right pane is 70%, minus borders and padding
    // Use a conservative width to prevent any overflow
    const screenCols = this.screen.cols || 80;
    const rightPaneWidth = Math.floor(screenCols * 0.7) - 4; // 70% minus borders
    const maxWidth = Math.max(40, rightPaneWidth - 4); // Extra safety margin
    
    const wrappedLines = wrapLine(text, maxWidth);
    for (const line of wrappedLines) {
      this.conversationLog.log(line);
    }
  }

  private createLayout(): void {
    // Left pane container (30% width)
    this.leftPane = blessed.box({
      parent: this.screen,
      left: 0,
      top: 0,
      width: '30%',
      height: '100%-1',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'blue',
        },
      },
    });

    // Workstream list header
    blessed.box({
      parent: this.leftPane,
      top: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      content: ' WORKSTREAMS',
      style: {
        fg: 'cyan',
        bold: true,
      },
    });

    // Workstream list (top 20%)
    this.workstreamList = blessed.list({
      parent: this.leftPane,
      top: 1,
      left: 0,
      width: '100%-2',
      height: '20%-2',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollbar: {
        ch: '│',
        style: {
          fg: 'blue',
        },
      },
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
      },
      items: [],
    });

    // Tasks section header
    blessed.box({
      parent: this.leftPane,
      top: '20%',
      left: 0,
      width: '100%-2',
      height: 1,
      content: '─ TASKS [t] ─',
      style: {
        fg: 'yellow',
      },
    });

    // Tasks list (25%)
    this.tasksList = blessed.list({
      parent: this.leftPane,
      top: '20%+1',
      left: 0,
      width: '100%-2',
      height: '25%-2',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollbar: {
        ch: '│',
        style: {
          fg: 'yellow',
        },
      },
      style: {
        selected: {
          bg: 'yellow',
          fg: 'black',
        },
        item: {
          fg: 'white',
        },
      },
      items: [],
    });

    // Advice section header
    blessed.box({
      parent: this.leftPane,
      top: '45%',
      left: 0,
      width: '100%-2',
      height: 1,
      content: '─ ADVICE [a] ─',
      style: {
        fg: 'green',
      },
    });

    // Advice list (25%)
    this.adviceList = blessed.list({
      parent: this.leftPane,
      top: '45%+1',
      left: 0,
      width: '100%-2',
      height: '25%-2',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollbar: {
        ch: '│',
        style: {
          fg: 'green',
        },
      },
      style: {
        selected: {
          bg: 'green',
          fg: 'black',
        },
        item: {
          fg: 'white',
        },
      },
      items: [],
    });

    // Notification section separator
    blessed.box({
      parent: this.leftPane,
      top: '70%',
      left: 0,
      width: '100%-2',
      height: 1,
      content: '─ NOTIFICATIONS ─',
      style: {
        fg: 'magenta',
      },
    });

    // Notification box (bottom 30%)
    this.notificationBox = blessed.box({
      parent: this.leftPane,
      top: '70%+1',
      left: 0,
      width: '100%-2',
      height: '30%-2',
      scrollable: true,
      mouse: true,
      tags: true,
      style: {
        fg: 'white',
      },
      content: '',
    });

    // Right pane container (70% width)
    this.rightPane = blessed.box({
      parent: this.screen,
      left: '30%',
      top: 0,
      width: '70%',
      height: '100%-1',
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'green',
        },
      },
    });

    // Conversation header
    this.conversationHeader = blessed.box({
      parent: this.rightPane,
      top: 0,
      left: 0,
      width: '100%-2',
      height: 2,
      tags: true,
      content: ' Select a workstream or press [n] to create new',
      style: {
        fg: 'cyan',
        bold: true,
      },
    });

    // Conversation log - use box instead of log for better rendering control
    this.conversationLog = blessed.log({
      parent: this.rightPane,
      top: 2,
      left: 0,
      width: '100%-2',
      height: '100%-9',  // Extra line to prevent cutting off last lines
      scrollable: true,
      mouse: true,  // Enable mouse wheel scrolling
      keys: true,
      vi: true,
      tags: true,
      alwaysScroll: true,
      wrap: false,       // Disable blessed's wrap - we handle it manually
      scrollbar: {
        ch: '│',
        style: {
          fg: 'green',
        },
      },
      style: {
        fg: 'white',
      },
    });

    // Input separator with hint
    blessed.box({
      parent: this.rightPane,
      bottom: 4,
      left: 0,
      width: '100%-2',
      height: 1,
      content: '{gray-fg}────────────────────────────────────────────────────────────────{/gray-fg}',
      tags: true,
      style: {
        fg: 'gray',
      },
    });

    // Input area (textarea for multi-line support)
    this.inputBox = blessed.textarea({
      parent: this.rightPane,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 4,
      inputOnFocus: true,
      mouse: true,
      keys: true,
      vi: false,
      scrollable: true,  // Enable scrolling for long messages
      alwaysScroll: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    }) as blessed.Widgets.TextareaElement;

    // Status bar at the bottom
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,  // Enable blessed markup tags
      style: {
        fg: 'white',
        bg: 'blue',
      },
      content: ' [n]ew  [d]elete  [Enter]focus  [Esc]back  [q]uit  [?]help',
    });
  }

  private setupKeyBindings(): void {
    // Global key bindings on screen (work when list pane is focused)
    this.screen.key(['n'], () => {
      if (this.state.focusedPane === 'list' && !this.dialogOpen) {
        this.showNewWorkstreamDialog();
      }
    });

    this.screen.key(['d'], () => {
      if (this.state.focusedPane === 'list' && !this.dialogOpen) {
        const workstream = this.state.workstreams[this.selectedIndex];
        if (workstream) {
          this.showDeleteConfirmation(workstream.id, workstream.name);
        }
      }
    });

    this.screen.key(['q'], () => {
      if (this.state.focusedPane === 'list' || this.state.focusedPane === 'tasks') {
        this.onEvent({ type: 'quit' });
      }
    });

    // Tab to switch between workstreams, tasks, and advice
    this.screen.key(['tab'], () => {
      if (this.state.focusedPane === 'list') {
        this.focusTasks();
      } else if (this.state.focusedPane === 'tasks') {
        this.focusAdvice();
      } else if (this.state.focusedPane === 'advice') {
        this.focusList();
      }
    });

    // 't' to switch to tasks panel
    this.screen.key(['t'], () => {
      if (this.state.focusedPane === 'conversation') return;
      this.focusTasks();
    });

    // 'a' to switch to advice panel
    this.screen.key(['a'], () => {
      if (this.state.focusedPane === 'conversation') return;
      this.focusAdvice();
    });

    // Track workstream selection when navigating (arrows/j/k)
    this.workstreamList.on('select item', (_item: any, index: number) => {
      this.selectedIndex = index;
    });

    // Navigation in workstream list (Enter to open)
    this.workstreamList.on('select', (_item: any, index: number) => {
      this.selectedIndex = index;
      const workstream = this.state.workstreams[index];
      if (workstream) {
        this.onEvent({ type: 'workstream_select', workstreamId: workstream.id });
      }
    });
    
    // 'c' to switch to general chat
    this.screen.key(['c'], () => {
      this.onEvent({ type: 'general_chat' });
    });

    // Track task selection when navigating
    this.tasksList.on('select item', (_item: any, index: number) => {
      this.selectedTaskIndex = index;
    });

    // Navigation in tasks list
    this.tasksList.on('select', (_item: any, index: number) => {
      this.selectedTaskIndex = index;
      this.screen.render();
    });

    // Track advice selection when navigating
    this.adviceList.on('select item', (_item: any, index: number) => {
      this.selectedAdviceIndex = index;
    });

    // Navigation in advice list - Enter opens advice stream
    this.adviceList.on('select', (_item: any, index: number) => {
      this.selectedAdviceIndex = index;
      const advice = this.state.adviceTopics?.[index];
      if (advice) {
        this.onEvent({ type: 'advice_select', adviceId: advice.id });
      }
    });

    // 'd' to dismiss advice when in advice panel
    this.adviceList.key(['d'], () => {
      const advice = this.state.adviceTopics?.[this.selectedAdviceIndex];
      if (advice) {
        this.onEvent({ type: 'advice_dismiss', adviceId: advice.id });
      }
    });

    // 'r' to refresh advice
    this.adviceList.key(['r'], () => {
      this.onEvent({ type: 'advice_refresh' });
    });

    // Enter on task list creates workstream (but stays in tasks panel)
    this.tasksList.key(['enter'], () => {
      const task = this.state.tasks?.[this.selectedTaskIndex];
      if (!task) return;
      
      const content = task.content || 'Untitled task';
      const name = content.substring(0, 40) + (content.length > 40 ? '...' : '');
      
      // Smart context handling based on size
      const contextSize = task.context?.length || 0;
      let contextPart = '';
      
      if (!task.context || contextSize === 0) {
        contextPart = 'No additional context available.';
      } else if (contextSize < 5000) {
        // Small context - use directly
        contextPart = `Context:\n${task.context}`;
      } else if (contextSize < 50000) {
        // Medium context - include but note it's abbreviated
        contextPart = `Context (first 5000 chars of ${contextSize}):\n${task.context.substring(0, 5000)}\n\n[Note: Full context is ${contextSize} chars - ask user if you need more details]`;
      } else {
        // Huge context - something is wrong, don't include it
        contextPart = `[Warning: Task has unusually large context (${contextSize} chars) - not included to avoid issues. Ask user for relevant details.]`;
      }
      
      // Different prompts for complete vs incomplete tasks
      let description: string;
      if (!task.content || task.content === 'Untitled task') {
        description = `This task appears to be incomplete or missing a title.\n\n${contextPart}\n\nPlease help me understand what this task might be about, or let me know what information you need.`;
      } else {
        description = `Task: ${content}\n\n${contextPart}\n\nPlease briefly explain this task and what needs to be done.`;
      }
      
      this.onEvent({
        type: 'workstream_create',
        workstreamType: 'custom',
        name,
        metadata: { description },
      });
    });

    // 'd' to delete task when in tasks panel
    this.tasksList.key(['d'], () => {
      if (this.dialogOpen) return;
      const task = this.state.tasks?.[this.selectedTaskIndex];
      if (task) {
        this.showTaskDeleteConfirmation(task.id, task.content || 'Untitled');
      }
    });

    // 'a' to add new task when in tasks panel
    this.tasksList.key(['a'], () => {
      if (this.dialogOpen) return;
      this.showNewTaskDialog();
    });

    // Focus management
    this.workstreamList.key(['enter'], () => {
      const workstream = this.state.workstreams[this.selectedIndex];
      if (workstream) {
        this.onEvent({ type: 'workstream_select', workstreamId: workstream.id });
        this.focusConversation();
      }
    });

    // Input handling - Ctrl+S to submit (allows multi-line input)
    // Also support Ctrl+D and Tab+Enter as alternatives
    const submitInput = () => {
      const value = this.inputBox.getValue();
      const trimmed = value.trim();
      
      if (trimmed) {
        // Check for slash commands
        if (trimmed.startsWith('/')) {
          const spaceIndex = trimmed.indexOf(' ');
          const command = spaceIndex > 0 ? trimmed.substring(1, spaceIndex) : trimmed.substring(1);
          const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1) : '';
          this.onEvent({ type: 'command', command: command.toLowerCase(), args });
        } else {
          // Show the message first, handling multi-line with proper wrapping
          const lines = trimmed.split('\n');
          if (lines.length === 1) {
            this.logWrapped(`{bold}{cyan-fg}You:{/cyan-fg}{/bold} ${trimmed}`);
          } else {
            this.conversationLog.log(`{bold}{cyan-fg}You:{/cyan-fg}{/bold}`);
            for (const line of lines) {
              this.logWrapped(`  ${line}`);
            }
          }
          
          // Force render to display the message immediately
          this.screen.render();
          
          // Scroll to bottom AFTER render to ensure the message is visible
          // Use setImmediate to ensure scroll happens after content is laid out
          setImmediate(() => {
            this.conversationLog.setScrollPerc(100);
            this.screen.render();
          });
          
          // Then send the message event (which will trigger async processing)
          this.onEvent({ type: 'message_send', message: trimmed });
        }
        this.inputBox.clearValue();
      }
      this.inputBox.focus();
      this.screen.render();
    };

    this.inputBox.key(['C-s'], submitInput);  // Ctrl+S to send
    this.inputBox.key(['C-d'], submitInput);  // Ctrl+D as alternative

    this.inputBox.key(['escape'], () => {
      this.focusList();
    });

    // Ctrl+C to interrupt when in conversation mode
    this.inputBox.key(['C-c'], () => {
      this.onEvent({ type: 'interrupt' });
    });

    // Scroll conversation while in input mode
    // Force full redraw after scroll to prevent rendering artifacts
    // Granular scrolling: arrows = 1 line, Ctrl+arrows = 3 lines, PgUp/PgDn = 5 lines
    this.inputBox.key(['up'], () => {
      this.conversationLog.scroll(-1);
      this.screen.render();
    });
    this.inputBox.key(['down'], () => {
      this.conversationLog.scroll(1);
      this.screen.render();
    });
    this.inputBox.key(['C-up'], () => {
      this.conversationLog.scroll(-3);
      this.screen.render();
    });
    this.inputBox.key(['C-down'], () => {
      this.conversationLog.scroll(3);
      this.screen.render();
    });
    this.inputBox.key(['pageup'], () => {
      this.conversationLog.scroll(-5);
      this.screen.clearRegion(0, this.screen.cols, 0, this.screen.rows);
      this.screen.render();
    });
    this.inputBox.key(['pagedown'], () => {
      this.conversationLog.scroll(5);
      this.screen.clearRegion(0, this.screen.cols, 0, this.screen.rows);
      this.screen.render();
    });
    this.inputBox.key(['home', 'C-home'], () => {
      this.conversationLog.setScrollPerc(0);
      this.screen.clearRegion(0, this.screen.cols, 0, this.screen.rows);
      this.screen.render();
    });
    this.inputBox.key(['end', 'C-end'], () => {
      this.conversationLog.setScrollPerc(100);
      this.screen.clearRegion(0, this.screen.cols, 0, this.screen.rows);
      this.screen.render();
    });

    // Mouse wheel scroll - custom handler for granular scrolling (1 line per tick)
    this.conversationLog.on('wheeldown', () => {
      this.conversationLog.scroll(1);
      this.screen.render();
    });
    this.conversationLog.on('wheelup', () => {
      this.conversationLog.scroll(-1);
      this.screen.render();
    });

    // Global shortcuts when conversation focused
    this.conversationLog.key(['escape', 'q'], () => {
      this.focusList();
    });

    // Initial focus
    this.focusList();
  }

  private focusList(): void {
    this.state.focusedPane = 'list';
    this.workstreamList.focus();
    this.leftPane.style.border = { fg: 'cyan' };
    this.rightPane.style.border = { fg: 'green' };
    this.updateStatusBar();
    this.screen.render();
  }

  private focusTasks(): void {
    this.state.focusedPane = 'tasks';
    this.tasksList.focus();
    this.leftPane.style.border = { fg: 'yellow' };
    this.rightPane.style.border = { fg: 'green' };
    this.updateStatusBar();
    this.screen.render();
  }

  private focusAdvice(): void {
    this.state.focusedPane = 'advice';
    this.adviceList.focus();
    this.leftPane.style.border = { fg: 'green' };
    this.rightPane.style.border = { fg: 'green' };
    this.updateStatusBar();
    this.screen.render();
  }

  private focusConversation(): void {
    this.state.focusedPane = 'conversation';
    this.inputBox.focus();
    this.leftPane.style.border = { fg: 'blue' };
    this.rightPane.style.border = { fg: 'cyan' };
    this.updateStatusBar();
    this.screen.render();
  }

  private updateStatusBar(): void {
    const tokenInfo = this.state.activeWorkstreamId 
      ? ` ~${this.getActiveWorkstream()?.tokenEstimate?.toLocaleString() || 0} tokens`
      : '';
    
    // Voice state indicators - only show if voice is available on this platform
    let voiceIndicator = '';
    const voiceAvailable = isFeatureAvailable('voice');
    if (voiceAvailable) {
      if (this.voiceState.isRecording) {
        voiceIndicator = ' {red-fg}🎤 REC{/red-fg}';
      } else if (this.voiceState.isTranscribing) {
        voiceIndicator = ' {yellow-fg}📝 ...{/yellow-fg}';
      } else if (this.voiceState.isSpeaking) {
        voiceIndicator = ' {green-fg}🔊 TTS{/green-fg}';
      } else if (this.voiceState.ttsEnabled) {
        voiceIndicator = ' {cyan-fg}🔊{/cyan-fg}';
      }
    }
      
    if (this.state.focusedPane === 'list') {
      this.statusBar.setContent(` [n]ew  [c]hat  [d]elete  [Enter]focus  [t]asks  [a]dvice  [q]uit  [?]help${voiceIndicator}${tokenInfo}`);
    } else if (this.state.focusedPane === 'tasks') {
      this.statusBar.setContent(` [Enter]start  [a]dd  [d]elete  [Tab]next  [q]uit${voiceIndicator}${tokenInfo}`);
    } else if (this.state.focusedPane === 'advice') {
      this.statusBar.setContent(` [Enter]open  [d]ismiss  [r]efresh  [Tab]next  [q]uit${voiceIndicator}${tokenInfo}`);
    } else {
      const mode = this.state.activeWorkstreamId ? '  [c]hat' : ' {cyan-fg}(General Chat){/cyan-fg}';
      // Only show voice shortcuts if voice features are available on this platform
      const voiceShortcuts = voiceAvailable ? '  [[]voice  []]TTS' : '';
      this.statusBar.setContent(` [Ctrl+S]send${voiceShortcuts}  [↑↓]scroll  [Esc]back${mode}${voiceIndicator}${tokenInfo}`);
    }
  }

  private getActiveWorkstream(): Workstream | undefined {
    return this.state.workstreams.find(w => w.id === this.state.activeWorkstreamId);
  }

  private showNewWorkstreamDialog(): void {
    this.dialogOpen = true;
    const form = blessed.form({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 15,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      keys: true,
    });

    blessed.box({
      parent: form,
      top: 0,
      left: 1,
      width: '100%-4',
      height: 1,
      content: ' New Workstream',
      style: {
        fg: 'cyan',
        bold: true,
      },
    });

    blessed.text({
      parent: form,
      top: 2,
      left: 1,
      content: 'Type:',
      style: { fg: 'white' },
    });

    const typeList = blessed.list({
      parent: form,
      name: 'type',
      top: 3,
      left: 1,
      width: '100%-4',
      height: 5,
      keys: true,
      vi: true,
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
      },
      items: ['PR Review', 'Jira Ticket', 'Ask/Question', 'Investigation', 'Custom'],
    });

    blessed.text({
      parent: form,
      top: 9,
      left: 1,
      content: 'Name (or URL/ID):',
      style: { fg: 'white' },
    });

    const nameInput = blessed.textbox({
      parent: form,
      name: 'name',
      top: 10,
      left: 1,
      width: '100%-4',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'gray',
      },
    });

    blessed.text({
      parent: form,
      bottom: 0,
      left: 1,
      content: '[Enter] Create  [Esc] Cancel',
      style: { fg: 'cyan' },
    });

    const typeMap: Record<number, string> = {
      0: 'pr',
      1: 'ticket',
      2: 'ask',
      3: 'investigation',
      4: 'custom',
    };

    let selectedType = 0;

    typeList.on('select', (_item: any, index: number) => {
      selectedType = index;
      nameInput.focus();
    });

    nameInput.on('submit', (value: string) => {
      if (value.trim()) {
        const type = typeMap[selectedType];
        let name = value.trim();
        let metadata: Record<string, any> = {};
        
        // Parse PR URL
        if (type === 'pr' && value.includes('github.com')) {
          const match = value.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
          if (match) {
            metadata = {
              prOwner: match[1],
              prRepo: match[2],
              prNumber: parseInt(match[3]),
              prUrl: value.trim(),
            };
            name = `PR #${match[3]}`;
          }
        }
        
        // Parse Jira ticket
        if (type === 'ticket' && /^[A-Z]+-\d+$/.test(value.trim())) {
          metadata = { ticketKey: value.trim() };
          name = value.trim();
        }
        
        this.onEvent({
          type: 'workstream_create',
          workstreamType: type as any,
          name,
          metadata,
        });
      }
      form.destroy();
      this.dialogOpen = false;
      this.focusList();
      this.screen.render();
    });

    nameInput.key(['escape'], () => {
      form.destroy();
      this.dialogOpen = false;
      this.focusList();
      this.screen.render();
    });

    typeList.key(['escape'], () => {
      form.destroy();
      this.dialogOpen = false;
      this.focusList();
      this.screen.render();
    });

    typeList.focus();
    this.screen.render();
  }

  private showDeleteConfirmation(workstreamId: string, name: string): void {
    this.dialogOpen = true;
    const dialog = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 7,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'red',
        },
        bg: 'black',
      },
    });

    dialog.ask(`Delete "${name}"?`, (err: any, value: any) => {
      // blessed.question returns true/false or the string value
      if (value === true || value === 'yes' || value === 'y' || value === '') {
        this.onEvent({ type: 'workstream_delete', workstreamId });
      }
      dialog.destroy();
      this.dialogOpen = false;
      this.focusList();
      this.screen.render();
    });
  }

  private showTaskDeleteConfirmation(taskId: string, content: string): void {
    this.dialogOpen = true;
    const displayContent = content.length > 30 ? content.substring(0, 30) + '...' : content;
    
    const dialog = blessed.question({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 50,
      height: 7,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'red',
        },
        bg: 'black',
      },
    });

    dialog.ask(`Delete task "${displayContent}"?`, (err: any, value: any) => {
      // blessed.question returns true/false or the string value
      if (value === true || value === 'yes' || value === 'y' || value === '') {
        this.onEvent({ type: 'task_delete', taskId });
      }
      dialog.destroy();
      this.dialogOpen = false;
      this.focusTasks();
      this.screen.render();
    });
  }

  private showNewTaskDialog(): void {
    this.dialogOpen = true;
    const form = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 12,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
        bg: 'black',
      },
      label: ' New Task ',
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: 'Task description:',
      style: { fg: 'white' },
    });

    const taskInput = blessed.textbox({
      parent: form,
      top: 3,
      left: 2,
      width: '90%',
      height: 3,
      inputOnFocus: true,
      mouse: true,
      keys: true,
      style: {
        fg: 'white',
        bg: 'black',
        focus: {
          bg: 'blue',
        },
      },
    });

    blessed.text({
      parent: form,
      bottom: 1,
      left: 2,
      content: '[Enter] Create  [Esc] Cancel',
      style: { fg: 'cyan' },
    });

    taskInput.on('submit', (value: string) => {
      if (value.trim()) {
        this.onEvent({ type: 'task_create', content: value.trim() });
      }
      form.destroy();
      this.dialogOpen = false;
      this.focusTasks();
      this.screen.render();
    });

    taskInput.key(['escape'], () => {
      form.destroy();
      this.dialogOpen = false;
      this.focusTasks();
      this.screen.render();
    });

    taskInput.focus();
    this.screen.render();
  }

  private rawOverlay: blessed.Widgets.BoxElement | null = null;

  showRawText(text: string): void {
    if (this.rawOverlay) {
      this.closeOverlay();
      return;
    }

    // Cancel any textarea input mode first
    (this.inputBox as any).cancel?.();

    this.rawOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '85%',
      border: {
        type: 'line',
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      focusable: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'cyan' },
      },
      style: {
        border: { fg: 'green' },
        bg: 'black',
      },
      label: ' Raw Response (Esc to close, scroll with j/k) ',
      content: text,
      tags: false,  // No blessed tags - raw text
    });

    // Use screen-level key handler
    const closeHandler = () => {
      if (this.rawOverlay) {
        this.screen.unkey('escape', closeHandler);
        this.screen.unkey('q', closeHandler);
        this.closeOverlay();
      }
    };
    this.screen.key('escape', closeHandler);
    this.screen.key('q', closeHandler);

    this.rawOverlay.focus();
    this.screen.render();
  }

  private linkPickerOverlay: blessed.Widgets.ListElement | null = null;
  private linkPickerUrls: string[] = [];
  private linkPickerOnOpen: ((url: string) => void) | null = null;
  private linkPickerOnCopy: ((url: string) => void) | null = null;

  private closeOverlay(): void {
    if (this.helpOverlay) {
      this.helpOverlay.destroy();
      this.helpOverlay = null;
    }
    if (this.rawOverlay) {
      this.rawOverlay.destroy();
      this.rawOverlay = null;
    }
    if (this.linkPickerOverlay) {
      this.linkPickerOverlay.destroy();
      this.linkPickerOverlay = null;
    }
    // Show and re-focus input
    this.inputBox.show();
    this.inputBox.focus();
    this.screen.render();
  }

  showLinkPicker(urls: string[], onOpen: (url: string) => void, onCopy: (url: string) => void): void {
    if (this.linkPickerOverlay) {
      this.closeOverlay();
      return;
    }

    // Aggressively stop textarea input - hide it temporarily
    (this.inputBox as any).cancel?.();
    this.inputBox.hide();

    this.linkPickerUrls = urls;
    this.linkPickerOnOpen = onOpen;
    this.linkPickerOnCopy = onCopy;

    this.linkPickerOverlay = blessed.list({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '85%',
      height: Math.min(urls.length + 4, 20),
      border: {
        type: 'line',
      },
      label: ' Links (↑↓/jk navigate, Enter=open, c=copy, Esc=close) ',
      items: urls.map((url, i) => `  ${i + 1}. ${url}`),
      keys: false,  // Disable built-in keys to prevent double movement
      vi: false,
      mouse: true,
      focusable: true,
      interactive: true,
      style: {
        border: { fg: 'cyan' },
        bg: 'black',
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        item: {
          fg: 'white',
        },
      },
      scrollbar: {
        ch: '│',
        style: { fg: 'cyan' },
      },
    });

    this.linkPickerOverlay.select(0);
    
    // Cleanup function
    const cleanup = () => {
      this.screen.removeListener('keypress', keyHandler);
      if (this.linkPickerOverlay) {
        this.linkPickerOverlay.destroy();
        this.linkPickerOverlay = null;
      }
      // Show and re-focus input
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
    };

    // Single keypress handler for all keys
    const keyHandler = (ch: string, key: any) => {
      if (!this.linkPickerOverlay) return;
      
      const list = this.linkPickerOverlay as any;
      const index = list.selected || 0;
      
      if (key.name === 'escape' || key.name === 'q') {
        cleanup();
      } else if (key.name === 'enter') {
        const url = this.linkPickerUrls[index];
        if (url && this.linkPickerOnOpen) {
          this.linkPickerOnOpen(url);
        }
        // Don't close - allow opening multiple links
      } else if (ch === 'c') {
        const url = this.linkPickerUrls[index];
        if (url && this.linkPickerOnCopy) {
          this.linkPickerOnCopy(url);
        }
      } else if (key.name === 'up' || ch === 'k') {
        list.up();
        this.screen.render();
      } else if (key.name === 'down' || ch === 'j') {
        list.down();
        this.screen.render();
      }
    };

    // Use screen.on for keypress to intercept all keys
    this.screen.on('keypress', keyHandler);

    // Focus and render
    this.linkPickerOverlay.focus();
    this.screen.render();
  }

  private memoryOverlay: blessed.Widgets.BoxElement | null = null;

  showMemoryManager(
    memories: Array<{ id: string; content: string }>,
    pending: Array<{ id: string; content: string }>,
    onApprove: (mem: { id: string; content: string }) => Promise<void>,
    onReject: (mem: { id: string; content: string }) => Promise<void>,
    onDelete: (mem: { id: string; content: string }) => Promise<void>
  ): void {
    if (this.memoryOverlay) {
      this.memoryOverlay.destroy();
      this.memoryOverlay = null;
      this.inputBox.focus();
      this.screen.render();
      return;
    }

    // Cancel textarea input
    (this.inputBox as any).cancel?.();

    // Create main container
    this.memoryOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '85%',
      height: '80%',
      border: { type: 'line' },
      style: { border: { fg: 'magenta' }, bg: 'black' },
      label: ' Memory Manager (Esc to close) ',
    });

    // State management
    type View = 'menu' | 'pending-list' | 'memory-list' | 'detail';
    let currentView: View = 'menu';
    let currentMemories: Array<{ id: string; content: string }> = [];
    let currentIndex = 0;
    let isPending = false;

    // Content area
    const contentBox = blessed.box({
      parent: this.memoryOverlay,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      tags: true,
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
    });

    const renderMenu = () => {
      currentView = 'menu';
      contentBox.setContent(`
  {bold}{cyan-fg}Memory Manager{/cyan-fg}{/bold}

  Select an option:

  {yellow-fg}[1]{/yellow-fg} View Pending Memories (${pending.length})
  {yellow-fg}[2]{/yellow-fg} View All Memories (${memories.length})

  {gray-fg}Press 1 or 2 to select, Esc to close{/gray-fg}
      `);
      this.screen.render();
    };

    const renderList = (items: Array<{ id: string; content: string }>, title: string, pendingMode: boolean) => {
      currentView = pendingMode ? 'pending-list' : 'memory-list';
      currentMemories = items;
      isPending = pendingMode;
      
      if (items.length === 0) {
        contentBox.setContent(`
  {bold}{cyan-fg}${title}{/cyan-fg}{/bold}

  {gray-fg}No ${pendingMode ? 'pending' : ''} memories found.{/gray-fg}

  {gray-fg}Press Backspace to go back{/gray-fg}
        `);
        this.screen.render();
        return;
      }

      const lines = [`  {bold}{cyan-fg}${title}{/cyan-fg}{/bold}\n`];
      items.forEach((mem, i) => {
        const preview = mem.content.substring(0, 70).replace(/\n/g, ' ');
        lines.push(`  {yellow-fg}[${i + 1}]{/yellow-fg} ${preview}${mem.content.length > 70 ? '...' : ''}\n`);
      });
      lines.push(`\n  {gray-fg}Press number to view, Backspace to go back{/gray-fg}`);
      
      contentBox.setContent(lines.join(''));
      this.screen.render();
    };

    const renderDetail = (mem: { id: string; content: string }, index: number, pendingMode: boolean) => {
      currentView = 'detail';
      currentIndex = index;
      isPending = pendingMode;

      const actions = pendingMode 
        ? `{green-fg}[a]{/green-fg} Approve  {red-fg}[r]{/red-fg} Reject`
        : `{red-fg}[d]{/red-fg} Delete`;

      contentBox.setContent(`
  {bold}{cyan-fg}${pendingMode ? 'Pending ' : ''}Memory #${index + 1}{/cyan-fg}{/bold}

  ${mem.content}

  ─────────────────────────────────────────────────────

  ${actions}  {gray-fg}[Backspace]{/gray-fg} Back  {gray-fg}[Esc]{/gray-fg} Close
      `);
      this.screen.render();
    };

    // Key handlers
    const handleKey = async (ch: string, key: any) => {
      if (key.name === 'escape') {
        cleanup();
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        if (currentView === 'detail') {
          renderList(currentMemories, isPending ? 'Pending Memories' : 'All Memories', isPending);
        } else if (currentView === 'pending-list' || currentView === 'memory-list') {
          renderMenu();
        }
        return;
      }

      if (currentView === 'menu') {
        if (ch === '1') {
          renderList(pending, 'Pending Memories', true);
        } else if (ch === '2') {
          renderList(memories, 'All Memories', false);
        }
      } else if (currentView === 'pending-list' || currentView === 'memory-list') {
        const num = parseInt(ch, 10);
        if (num >= 1 && num <= currentMemories.length) {
          renderDetail(currentMemories[num - 1], num - 1, isPending);
        }
      } else if (currentView === 'detail') {
        const mem = currentMemories[currentIndex];
        if (isPending && ch === 'a') {
          await onApprove(mem);
          // Remove from list and go back
          pending.splice(pending.findIndex(p => p.id === mem.id), 1);
          currentMemories = pending;
          renderList(pending, 'Pending Memories', true);
        } else if (isPending && ch === 'r') {
          await onReject(mem);
          pending.splice(pending.findIndex(p => p.id === mem.id), 1);
          currentMemories = pending;
          renderList(pending, 'Pending Memories', true);
        } else if (!isPending && ch === 'd') {
          await onDelete(mem);
          memories.splice(memories.findIndex(m => m.id === mem.id), 1);
          currentMemories = memories;
          renderList(memories, 'All Memories', false);
        }
      }
    };

    const cleanup = () => {
      this.screen.removeListener('keypress', handleKey);
      if (this.memoryOverlay) {
        this.memoryOverlay.destroy();
        this.memoryOverlay = null;
      }
      this.inputBox.focus();
      this.screen.render();
    };

    this.screen.on('keypress', handleKey);
    contentBox.focus();
    renderMenu();
  }

  /**
   * Show the trash bin overlay for viewing/restoring/deleting trashed workstreams
   */
  async showTrashBin(): Promise<void> {
    if (this.trashOverlay) {
      this.trashOverlay.destroy();
      this.trashOverlay = null;
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
      return;
    }

    // Cancel textarea input
    (this.inputBox as any).cancel?.();
    this.inputBox.hide();

    const trashBin = getTrashBinManager();
    let trashedItems = await trashBin.list();
    let searchResults: TrashSearchResult[] | null = null;
    let searchQuery = '';

    // Create main container
    this.trashOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '85%',
      border: { type: 'line' },
      style: { border: { fg: 'red' }, bg: 'black' },
      label: ' Trash Bin (Shift+T to close) ',
    });

    // State
    type View = 'list' | 'detail' | 'search';
    let currentView: View = 'list';
    let selectedIndex = 0;
    let currentItem: TrashedWorkstream | null = null;

    // Content area
    const contentBox = blessed.box({
      parent: this.trashOverlay,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-4',
      tags: true,
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'red' },
      },
    });

    // Footer with keybindings
    const footerBox = blessed.box({
      parent: this.trashOverlay,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 3,
      tags: true,
      style: { bg: 'black' },
    });

    const formatDate = (timestamp: number): string => {
      const date = new Date(timestamp);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) {
        return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString();
      }
    };

    const getTypeIcon = (type: string): string => {
      switch (type) {
        case 'pr': return '{magenta-fg}PR{/magenta-fg}';
        case 'ticket': return '{yellow-fg}TKT{/yellow-fg}';
        case 'ask': return '{cyan-fg}ASK{/cyan-fg}';
        case 'investigation': return '{green-fg}INV{/green-fg}';
        default: return '{white-fg}CUS{/white-fg}';
      }
    };

    const renderList = () => {
      currentView = 'list';
      const items = searchResults 
        ? searchResults.map(r => r.workstream)
        : trashedItems;

      if (items.length === 0) {
        const msg = searchQuery 
          ? `No results for "${searchQuery}"`
          : 'Trash bin is empty';
        contentBox.setContent(`\n  {gray-fg}${msg}{/gray-fg}`);
        footerBox.setContent(`  {gray-fg}[/] Search  [E] Empty Trash  [Esc] Close{/gray-fg}`);
        this.screen.render();
        return;
      }

      const lines: string[] = [];
      if (searchQuery) {
        lines.push(`  {cyan-fg}Search results for "{bold}${searchQuery}{/bold}"{/cyan-fg}\n`);
      }
      
      items.forEach((item, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? '{inverse}' : '';
        const suffix = isSelected ? '{/inverse}' : '';
        
        const typeIcon = getTypeIcon(item.type);
        const deletedDate = formatDate(item.deletedAt);
        const name = item.name.length > 40 ? item.name.substring(0, 40) + '...' : item.name;
        
        // Get last message preview
        let lastMsg = '';
        const humanMsgs = item.messages.filter(m => m.type === 'human');
        if (humanMsgs.length > 0) {
          const last = humanMsgs[humanMsgs.length - 1];
          const content = typeof last.content === 'string' ? last.content : '';
          lastMsg = content.substring(0, 50).replace(/\n/g, ' ');
          if (content.length > 50) lastMsg += '...';
        }

        lines.push(`${prefix}  ${typeIcon} ${name}{/}`);
        lines.push(`${prefix}     {gray-fg}Deleted: ${deletedDate}  |  ${item.messages.length} messages{/gray-fg}${suffix}`);
        if (lastMsg) {
          lines.push(`${prefix}     {gray-fg}"${lastMsg}"{/gray-fg}${suffix}`);
        }
        
        // Show match context for search results
        if (searchResults && searchResults[i]) {
          lines.push(`${prefix}     {yellow-fg}Match: ${searchResults[i].matchContext}{/yellow-fg}${suffix}`);
        }
        lines.push('');
      });

      contentBox.setContent(lines.join('\n'));
      footerBox.setContent(`  {green-fg}[r]{/green-fg} Restore  {red-fg}[d]{/red-fg} Delete Forever  {cyan-fg}[/]{/cyan-fg} Search  {gray-fg}[Enter] Details  [E] Empty All  [Esc] Close{/gray-fg}`);
      this.screen.render();
    };

    const renderDetail = (item: TrashedWorkstream) => {
      currentView = 'detail';
      currentItem = item;

      const lines: string[] = [
        `  {bold}{cyan-fg}${item.name}{/cyan-fg}{/bold}`,
        '',
        `  {yellow-fg}Type:{/yellow-fg} ${item.type}`,
        `  {yellow-fg}Status:{/yellow-fg} ${item.status}`,
        `  {yellow-fg}Created:{/yellow-fg} ${new Date(item.createdAt).toLocaleString()}`,
        `  {yellow-fg}Deleted:{/yellow-fg} ${new Date(item.deletedAt).toLocaleString()}`,
        `  {yellow-fg}Messages:{/yellow-fg} ${item.messages.length}`,
        `  {yellow-fg}Turns:{/yellow-fg} ${item.turnCount}`,
      ];

      if (item.deletionReason) {
        lines.push(`  {yellow-fg}Reason:{/yellow-fg} ${item.deletionReason}`);
      }

      if (item.metadata) {
        lines.push('', '  {bold}Metadata:{/bold}');
        if (item.metadata.ticketKey) lines.push(`    Ticket: ${item.metadata.ticketKey}`);
        if (item.metadata.prUrl) lines.push(`    PR: ${item.metadata.prUrl}`);
        if (item.metadata.description) lines.push(`    ${item.metadata.description}`);
      }

      // Show last few messages
      lines.push('', '  {bold}Recent Messages:{/bold}');
      const recentMsgs = item.messages.slice(-6);
      for (const msg of recentMsgs) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const preview = content.substring(0, 100).replace(/\n/g, ' ');
        const typeColor = msg.type === 'human' ? 'green' : msg.type === 'ai' ? 'cyan' : 'gray';
        lines.push(`    {${typeColor}-fg}[${msg.type}]{/${typeColor}-fg} ${preview}${content.length > 100 ? '...' : ''}`);
      }

      contentBox.setContent(lines.join('\n'));
      footerBox.setContent(`  {green-fg}[r]{/green-fg} Restore  {red-fg}[d]{/red-fg} Delete Forever  {gray-fg}[Backspace] Back  [Esc] Close{/gray-fg}`);
      this.screen.render();
    };

    const showSearchInput = () => {
      currentView = 'search';
      
      // Create search input
      const searchInput = blessed.textbox({
        parent: this.trashOverlay!,
        top: 'center',
        left: 'center',
        width: '60%',
        height: 3,
        border: { type: 'line' },
        style: {
          border: { fg: 'cyan' },
          bg: 'black',
          fg: 'white',
        },
        label: ' Search Trash (Enter to search, Esc to cancel) ',
        inputOnFocus: true,
      });

      searchInput.on('submit', async (value: string) => {
        searchInput.destroy();
        searchQuery = value.trim();
        
        if (searchQuery) {
          // Use smart search
          searchResults = await trashBin.smartSearch(searchQuery);
        } else {
          searchResults = null;
        }
        
        selectedIndex = 0;
        renderList();
      });

      searchInput.key(['escape'], () => {
        searchInput.destroy();
        renderList();
      });

      searchInput.focus();
      this.screen.render();
    };

    const handleRestore = async () => {
      const items = searchResults 
        ? searchResults.map(r => r.workstream)
        : trashedItems;
      
      if (items.length === 0) return;
      
      const item = items[selectedIndex];
      this.onEvent({ type: 'trash_restore', workstreamId: item.id });
      
      // Remove from local list
      trashedItems = trashedItems.filter(t => t.id !== item.id);
      if (searchResults) {
        searchResults = searchResults.filter(r => r.workstream.id !== item.id);
      }
      
      if (selectedIndex >= (searchResults || trashedItems).length) {
        selectedIndex = Math.max(0, (searchResults || trashedItems).length - 1);
      }
      
      renderList();
    };

    const handlePermanentDelete = async () => {
      const items = searchResults 
        ? searchResults.map(r => r.workstream)
        : trashedItems;
      
      if (items.length === 0) return;
      
      const item = items[selectedIndex];
      
      // Show confirmation
      const confirm = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 50,
        height: 8,
        border: { type: 'line' },
        style: { border: { fg: 'red' }, bg: 'black' },
      });

      confirm.ask(`Permanently delete "${item.name.substring(0, 25)}"?\nThis cannot be undone.`, async (err: any, value: any) => {
        confirm.destroy();
        
        if (value === true || value === 'yes' || value === 'y' || value === '') {
          this.onEvent({ type: 'trash_permanent_delete', workstreamId: item.id });
          
          // Remove from local list
          trashedItems = trashedItems.filter(t => t.id !== item.id);
          if (searchResults) {
            searchResults = searchResults.filter(r => r.workstream.id !== item.id);
          }
          
          if (selectedIndex >= (searchResults || trashedItems).length) {
            selectedIndex = Math.max(0, (searchResults || trashedItems).length - 1);
          }
        }
        
        renderList();
      });
    };

    const handleEmptyTrash = async () => {
      if (trashedItems.length === 0) return;
      
      const confirm = blessed.question({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: 50,
        height: 8,
        border: { type: 'line' },
        style: { border: { fg: 'red' }, bg: 'black' },
      });

      confirm.ask(`Empty entire trash bin?\n${trashedItems.length} items will be permanently deleted.`, async (err: any, value: any) => {
        confirm.destroy();
        
        if (value === true || value === 'yes' || value === 'y' || value === '') {
          this.onEvent({ type: 'trash_empty' });
          trashedItems = [];
          searchResults = null;
          searchQuery = '';
          selectedIndex = 0;
        }
        
        renderList();
      });
    };

    // Key handler
    const handleKey = async (ch: string, key: any) => {
      if (currentView === 'search') return; // Let search input handle its own keys

      if (key.name === 'escape' || (key.shift && ch === 'T')) {
        cleanup();
        return;
      }

      if (currentView === 'list') {
        const items = searchResults 
          ? searchResults.map(r => r.workstream)
          : trashedItems;

        if (key.name === 'up' || ch === 'k') {
          selectedIndex = Math.max(0, selectedIndex - 1);
          renderList();
        } else if (key.name === 'down' || ch === 'j') {
          selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
          renderList();
        } else if (key.name === 'enter' && items.length > 0) {
          renderDetail(items[selectedIndex]);
        } else if (ch === 'r') {
          await handleRestore();
        } else if (ch === 'd') {
          await handlePermanentDelete();
        } else if (ch === '/') {
          showSearchInput();
        } else if (ch === 'E') {
          await handleEmptyTrash();
        } else if (key.name === 'backspace' && searchQuery) {
          // Clear search
          searchQuery = '';
          searchResults = null;
          selectedIndex = 0;
          renderList();
        }
      } else if (currentView === 'detail') {
        if (key.name === 'backspace') {
          currentItem = null;
          renderList();
        } else if (ch === 'r' && currentItem) {
          this.onEvent({ type: 'trash_restore', workstreamId: currentItem.id });
          trashedItems = trashedItems.filter(t => t.id !== currentItem!.id);
          if (searchResults) {
            searchResults = searchResults.filter(r => r.workstream.id !== currentItem!.id);
          }
          currentItem = null;
          if (selectedIndex >= (searchResults || trashedItems).length) {
            selectedIndex = Math.max(0, (searchResults || trashedItems).length - 1);
          }
          renderList();
        } else if (ch === 'd' && currentItem) {
          await handlePermanentDelete();
          currentItem = null;
        }
      }
    };

    const cleanup = () => {
      this.screen.removeListener('keypress', handleKey);
      if (this.trashOverlay) {
        this.trashOverlay.destroy();
        this.trashOverlay = null;
      }
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
    };

    this.screen.on('keypress', handleKey);
    contentBox.focus();
    renderList();
  }

  private characterOverlay: blessed.Widgets.BoxElement | null = null;

  async showCharacterSelector(
    currentCharacter: string,
    onSelect: (type: string, customDesc?: string) => Promise<void>
  ): Promise<void> {
    if (this.characterOverlay) {
      this.characterOverlay.destroy();
      this.characterOverlay = null;
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
      return;
    }

    // Aggressively stop textarea input - hide it temporarily
    (this.inputBox as any).cancel?.();
    this.inputBox.hide();

    // Built-in characters from types.ts CharacterType
    const builtInCharacters = [
      { type: 'none', name: 'None', desc: 'Standard assistant' },
      // It's Always Sunny in Philadelphia
      { type: 'dee', name: 'Dee Reynolds', desc: "It's Always Sunny" },
      { type: 'dennis', name: 'Dennis Reynolds', desc: "It's Always Sunny" },
      { type: 'mac', name: 'Mac McDonald', desc: "It's Always Sunny" },
      { type: 'charlie', name: 'Charlie Kelly', desc: "It's Always Sunny" },
      { type: 'frank', name: 'Frank Reynolds', desc: "It's Always Sunny" },
      // Seinfeld
      { type: 'jerry', name: 'Jerry Seinfeld', desc: 'Seinfeld' },
      { type: 'george', name: 'George Costanza', desc: 'Seinfeld' },
      { type: 'elaine', name: 'Elaine Benes', desc: 'Seinfeld' },
      { type: 'kramer', name: 'Cosmo Kramer', desc: 'Seinfeld' },
      // Friends
      { type: 'chandler', name: 'Chandler Bing', desc: 'Friends' },
      { type: 'joey', name: 'Joey Tribbiani', desc: 'Friends' },
      { type: 'ross', name: 'Ross Geller', desc: 'Friends' },
      { type: 'monica', name: 'Monica Geller', desc: 'Friends' },
      { type: 'rachel', name: 'Rachel Green', desc: 'Friends' },
      { type: 'phoebe', name: 'Phoebe Buffay', desc: 'Friends' },
      // Other
      { type: 'dwight', name: 'Dwight Schrute', desc: 'The Office' },
      { type: 'ron', name: 'Ron Swanson', desc: 'Parks and Rec' },
      { type: 'archer', name: 'Sterling Archer', desc: 'Archer' },
    ];

    // Load custom characters from storage
    let customCharacters: CustomCharacter[] = [];
    try {
      customCharacters = await getCustomCharacters();
    } catch {
      // Ignore errors loading custom characters
    }

    // Build the full character list
    const characters: Array<{ type: string; name: string; desc: string; customDesc?: string }> = [
      ...builtInCharacters,
    ];

    // Add custom characters after built-ins
    for (const cc of customCharacters) {
      characters.push({
        type: 'custom',
        name: cc.name,
        desc: cc.source,
        customDesc: cc.description,
      });
    }

    // Add option to create new custom character at the end
    characters.push({ type: 'new_custom', name: '+ Create Custom...', desc: 'Define your own character' });

    // Calculate height based on character count (max 20 to fit screen)
    const listHeight = Math.min(characters.length, 15);
    const overlayHeight = listHeight + 8;

    this.characterOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: overlayHeight,
      border: { type: 'line' },
      style: { border: { fg: 'magenta' }, bg: 'black' },
      label: ' Select Character ',
    });

    // Current character indicator
    blessed.text({
      parent: this.characterOverlay,
      top: 1,
      left: 2,
      content: `Current: {yellow-fg}${currentCharacter || 'none'}{/yellow-fg}`,
      tags: true,
      style: { fg: 'white' },
    });

    // Character list with scrolling - use keys: false and handle manually for reliability
    const list = blessed.list({
      parent: this.characterOverlay,
      top: 3,
      left: 2,
      width: '90%',
      height: listHeight,
      keys: false,  // Handle keys manually for reliable focus
      vi: false,
      mouse: true,
      scrollable: true,
      focusable: true,
      interactive: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'magenta' },
      },
      style: {
        selected: { bg: 'magenta', fg: 'white' },
        item: { fg: 'white' },
      },
      items: characters.map(c => {
        const nameStr = c.name.substring(0, 20).padEnd(22);
        return `  ${nameStr} {gray-fg}${c.desc}{/gray-fg}`;
      }),
      tags: true,
    });

    // Find current character in list
    const currentIdx = characters.findIndex(c => {
      if (c.type === 'custom' && c.name.toLowerCase() === currentCharacter.toLowerCase()) return true;
      return c.type === currentCharacter;
    });
    list.select(currentIdx >= 0 ? currentIdx : 0);

    // Instructions
    blessed.text({
      parent: this.characterOverlay,
      bottom: 1,
      left: 2,
      content: '{cyan-fg}↑↓/jk{/cyan-fg} select  {cyan-fg}Enter{/cyan-fg} apply  {cyan-fg}Esc{/cyan-fg} cancel',
      tags: true,
      style: { fg: 'gray' },
    });

    // Cleanup function - restore input box visibility
    const cleanup = () => {
      this.screen.removeListener('keypress', keyHandler);
      if (this.characterOverlay) {
        this.characterOverlay.destroy();
        this.characterOverlay = null;
      }
      // Show and re-focus input
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
    };

    // Single keypress handler for all keys (more reliable than blessed's built-in)
    const keyHandler = async (ch: string, key: any) => {
      if (!this.characterOverlay) return;

      if (key.name === 'escape' || ch === 'q') {
        cleanup();
      } else if (key.name === 'up' || ch === 'k') {
        (list as any).up();
        this.screen.render();
      } else if (key.name === 'down' || ch === 'j') {
        (list as any).down();
        this.screen.render();
      } else if (key.name === 'enter') {
        const selectedIdx = (list as any).selected || 0;
        const selected = characters[selectedIdx];
        
        if (selected.type === 'new_custom') {
          // Show custom input prompt
          cleanup();
          this.showCustomCharacterPrompt(onSelect);
        } else if (selected.type === 'custom' && selected.customDesc) {
          // Use existing custom character
          cleanup();
          await onSelect('custom', selected.customDesc);
        } else {
          cleanup();
          await onSelect(selected.type);
        }
      }
    };

    // Use screen.on for keypress to intercept all keys
    this.screen.on('keypress', keyHandler);

    // Focus and render
    list.focus();
    this.screen.render();
  }

  private showCustomCharacterPrompt(onSelect: (type: string, customDesc?: string) => Promise<void>): void {
    this.dialogOpen = true;
    // Hide main input to prevent focus issues
    (this.inputBox as any).cancel?.();
    this.inputBox.hide();

    const form = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 60,
      height: 10,
      border: { type: 'line' },
      style: { border: { fg: 'magenta' }, bg: 'black' },
      label: ' Custom Character ',
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: 'Describe your character (e.g. "a sarcastic cat"):',
      style: { fg: 'white' },
    });

    const input = blessed.textbox({
      parent: form,
      top: 3,
      left: 2,
      width: '90%',
      height: 3,
      inputOnFocus: true,
      mouse: true,
      style: { fg: 'white', bg: 'black', focus: { bg: 'blue' } },
    });

    blessed.text({
      parent: form,
      bottom: 1,
      left: 2,
      content: '{cyan-fg}Enter{/cyan-fg} apply  {cyan-fg}Esc{/cyan-fg} cancel',
      tags: true,
      style: { fg: 'gray' },
    });

    input.on('submit', async (value: string) => {
      form.destroy();
      this.dialogOpen = false;
      if (value.trim()) {
        await onSelect('custom', value.trim());
      }
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
    });

    input.key(['escape'], () => {
      form.destroy();
      this.dialogOpen = false;
      this.inputBox.show();
      this.inputBox.focus();
      this.screen.render();
    });

    input.focus();
    this.screen.render();
  }

  showHelp(): void {
    if (this.helpOverlay) {
      this.closeOverlay();
      return;
    }

    // Cancel any textarea input mode first
    (this.inputBox as any).cancel?.();

    // Build help content with platform-specific sections
    const voiceAvailable = isFeatureAvailable('voice');
    
    // Voice control section - only shown on platforms that support it (macOS)
    const voiceSection = voiceAvailable ? `
  {bold}Voice Control (macOS):{/bold}
    [               Start/stop voice recording
    ]               Toggle text-to-speech mode
    
    Voice commands start with "COMMAND":
      "command send"         Send message
      "command stop"         Interrupt agent
      "command workstream X" Switch to workstream
      "command tasks"        Focus tasks
      "command help"         Show help
      "command voice off"    Disable TTS
      "command read again"   Re-read last response
` : '';

    this.helpOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 65,
      height: '80%',
      border: {
        type: 'line',
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      focusable: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'cyan' },
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      content: `
  {bold}{cyan-fg}Work Mode TUI - Help{/cyan-fg}{/bold}
  {gray-fg}(scroll with j/k, close with Esc/q/Enter){/gray-fg}

  {bold}Navigation:{/bold}
    ↑/↓ or j/k    Navigate lists
    t or Tab      Switch to tasks panel
    c             Switch to general chat (ephemeral)
    Esc           Back to list

  {bold}Workstreams:{/bold}
    n             New workstream
    d             Delete workstream (moves to trash)
    Shift+T       Open trash bin (restore/delete)
    Enter         Open workstream

  {bold}General Chat:{/bold}
    c             Switch to general chat (works from anywhere)
                  Ephemeral chat, not saved to any workstream

  {bold}Tasks:{/bold}
    a             Add task
    d             Delete task

  {bold}Conversation:{/bold}
    Ctrl+S        Send message
    ↑/↓           Scroll 1 line
    Ctrl+↑/↓      Scroll 3 lines
    PgUp/PgDn     Scroll 5 lines
    Home/End      Scroll to top/bottom
    Mouse wheel   Scroll 1 line
    Ctrl+C        Interrupt agent

  {bold}Slash Commands:{/bold}
    /copy               Copy last response to clipboard
    /raw                Show last response as raw text
    /urls               List all URLs from conversation
    /reset              Reset conversation
    /tokens             Show token count
    /datadog            Toggle Datadog integration
    /character          Opens character selection dialog
    /personality <mode> Set style (default|proactive|minimal)
    /help               Show this help

  {bold}Memory:{/bold}
    /memory   Opens interactive memory manager
              - View pending memories (approve/reject)
              - View all memories (delete)

  {bold}Copy/Links:{/bold}
    /copy             Copy last response to clipboard
    /raw              Open full conversation in new terminal
    /learn            Save chat to chats_to_learn/ for Cursor training
    /links or /urls   Interactive link picker:
                        ↑↓ navigate, Enter=open, c=copy, Esc=close

  {bold}Cursor Agent:{/bold}
    Ctrl+L          Show Cursor log viewer (full output)
${voiceSection}
  {cyan-fg}Press Esc, q, or Enter to close...{/cyan-fg}
      `,
      tags: true,
    });

    // Use screen-level key handler to ensure we catch the keys
    const closeHandler = () => {
      if (this.helpOverlay) {
        this.screen.unkey('escape', closeHandler);
        this.screen.unkey('q', closeHandler);
        this.screen.unkey('enter', closeHandler);
        this.screen.unkey('space', closeHandler);
        this.closeOverlay();
      }
    };
    this.screen.key('escape', closeHandler);
    this.screen.key('q', closeHandler);
    this.screen.key('enter', closeHandler);
    this.screen.key('space', closeHandler);

    this.helpOverlay.focus();
    this.screen.render();
  }

  /**
   * Show Cursor log viewer overlay
   * @param getLogData - Function to get the current log data from cursor module
   */
  showCursorLog(getLogData: () => { hasLog: boolean; prompt?: string; log: string[]; startedAt?: number; isRunning?: boolean }): void {
    if (this.cursorLogOverlay) {
      this.closeCursorLogOverlay();
      return;
    }

    // Cancel any textarea input mode first
    (this.inputBox as any).cancel?.();

    const buildContent = () => {
      const data = getLogData();
      
      if (!data.hasLog || data.log.length === 0) {
        return `
  {bold}{cyan-fg}Cursor Log Viewer{/cyan-fg}{/bold}
  {gray-fg}(auto-refreshes while running, press Esc to close){/gray-fg}

  {yellow-fg}No cursor session active for this workstream.{/yellow-fg}
  
  Start a cursor task to see logs here.
        `;
      }

      const elapsed = data.startedAt 
        ? Math.floor((Date.now() - data.startedAt) / 1000) 
        : 0;
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const status = data.isRunning 
        ? `{green-fg}Running{/green-fg} (${timeStr})` 
        : `{gray-fg}Finished{/gray-fg}`;

      let content = `
  {bold}{cyan-fg}Cursor Log Viewer{/cyan-fg}{/bold}
  {gray-fg}(auto-refreshes while running, press Esc to close){/gray-fg}
  
  Status: ${status}
  
  {yellow-fg}━━━ Output ━━━{/yellow-fg}
`;

      // Add log entries (last 100 lines)
      const recentLog = data.log.slice(-100);
      for (const line of recentLog) {
        // Format different line types
        if (line.startsWith('[Prompt]')) {
          content += `  {cyan-fg}${line}{/cyan-fg}\n`;
        } else if (line.startsWith('[Status]')) {
          content += `  {yellow-fg}${line}{/yellow-fg}\n`;
        } else if (line.startsWith('[Error]')) {
          content += `  {red-fg}${line}{/red-fg}\n`;
        } else {
          content += `  ${line}\n`;
        }
      }

      return content;
    };

    this.cursorLogOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '90%',
      border: {
        type: 'line',
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      focusable: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'cyan' },
      },
      style: {
        border: {
          fg: 'cyan',
        },
        bg: 'black',
      },
      content: buildContent(),
      tags: true,
    });

    // Auto-refresh content while session is running
    this.cursorLogRefreshInterval = setInterval(() => {
      if (this.cursorLogOverlay) {
        const scrollPos = (this.cursorLogOverlay as any).getScrollPerc?.() || 0;
        this.cursorLogOverlay.setContent(buildContent());
        // If user was at bottom, stay at bottom
        if (scrollPos >= 95) {
          this.cursorLogOverlay.setScrollPerc(100);
        }
        this.screen.render();
      }
    }, 1000); // Refresh every second

    // Close handler
    const closeHandler = () => {
      this.closeCursorLogOverlay();
    };
    this.screen.key('escape', closeHandler);
    this.screen.key('q', closeHandler);

    this.cursorLogOverlay.focus();
    this.cursorLogOverlay.setScrollPerc(100); // Start at bottom
    this.screen.render();
  }

  private closeCursorLogOverlay(): void {
    if (this.cursorLogRefreshInterval) {
      clearInterval(this.cursorLogRefreshInterval);
      this.cursorLogRefreshInterval = null;
    }
    if (this.cursorLogOverlay) {
      this.cursorLogOverlay.destroy();
      this.cursorLogOverlay = null;
      this.screen.unkey('escape', this.closeCursorLogOverlay);
      this.screen.unkey('q', this.closeCursorLogOverlay);
      this.inputBox.focus();
      this.screen.render();
    }
  }

  updateState(state: TUIState): void {
    const previousActiveId = this.state.activeWorkstreamId;
    this.state = state;
    
    // Update workstream list - show processing indicator
    const items = state.workstreams.map((w, i) => {
      const indicator = STATUS_INDICATORS[w.status];
      const isActive = w.id === state.activeWorkstreamId;
      const prefix = isActive ? '> ' : '  ';
      // Add processing spinner if this workstream is currently processing
      const processingIndicator = w.isProcessing ? ' {yellow-fg}⟳{/yellow-fg}' : '';
      return `${prefix}${i + 1}. ${w.name} ${indicator}${processingIndicator}`;
    });
    
    this.workstreamList.setItems(items);
    
    // Update tasks list
    const taskItems = (state.tasks || []).map((task, i) => {
      const statusIcon = task.status === 'in_progress' ? '{yellow-fg}●{/yellow-fg}' 
                       : task.status === 'completed' ? '{green-fg}✓{/green-fg}'
                       : task.status === 'cancelled' ? '{gray-fg}✗{/gray-fg}'
                       : '{white-fg}○{/white-fg}';
      const priorityIcon = task.priority === 'urgent' ? '{red-fg}!!{/red-fg}'
                         : task.priority === 'high' ? '{red-fg}!{/red-fg}'
                         : '';
      const overdue = task.dueDate && task.dueDate < Date.now() ? '{red-fg}⚠{/red-fg}' : '';
      const content = task.content || 'Untitled task';
      const name = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      const isSelected = i === this.selectedTaskIndex;
      const prefix = isSelected && this.state.focusedPane === 'tasks' ? '> ' : '  ';
      return `${prefix}${statusIcon} ${priorityIcon}${overdue}${name}`;
    });
    
    this.tasksList.setItems(taskItems);
    
    // Update advice list
    const adviceItems = (state.adviceTopics || []).map((advice, i) => {
      const priorityIcon = advice.priority === 'high' ? '{red-fg}!{/red-fg}'
                         : advice.priority === 'medium' ? '{yellow-fg}●{/yellow-fg}'
                         : '{gray-fg}○{/gray-fg}';
      const unreadIcon = advice.readAt ? '' : '{green-fg}•{/green-fg}';
      const title = advice.title.substring(0, 25) + (advice.title.length > 25 ? '...' : '');
      const isSelected = i === this.selectedAdviceIndex;
      const prefix = isSelected && this.state.focusedPane === 'advice' ? '> ' : '  ';
      return `${prefix}${unreadIcon}${priorityIcon} ${title}`;
    });
    
    this.adviceList.setItems(adviceItems.length > 0 ? adviceItems : ['  {gray-fg}No advice yet{/gray-fg}']);
    
    // Update notifications
    const unreadNotifications = state.notifications.filter(n => !n.read);
    if (unreadNotifications.length > 0) {
      const notificationText = unreadNotifications
        .slice(0, 5)
        .map(n => {
          const age = this.formatAge(n.timestamp);
          return `• ${n.message} (${age})`;
        })
        .join('\n');
      this.notificationBox.setContent(notificationText);
      this.notificationBox.style.fg = 'yellow';
    } else {
      this.notificationBox.setContent('No notifications');
      this.notificationBox.style.fg = 'gray';
    }
    
    // Update conversation header and log when workstream changes
    const activeWorkstream = this.getActiveWorkstream();
    if (activeWorkstream) {
      const statusIcon = activeWorkstream.status === 'in_progress' ? '{yellow-fg}●{/yellow-fg}'
                       : activeWorkstream.status === 'needs_input' ? '{cyan-fg}○{/cyan-fg}'
                       : activeWorkstream.status === 'done' ? '{green-fg}✓{/green-fg}'
                       : activeWorkstream.status === 'error' ? '{red-fg}!{/red-fg}'
                       : '{gray-fg}○{/gray-fg}';
      
      this.conversationHeader.setContent(` ${statusIcon} {bold}${activeWorkstream.name}{/bold}`);
      
      // If workstream changed, update conversation log
      if (state.activeWorkstreamId !== this.lastActiveWorkstreamId) {
        this.lastActiveWorkstreamId = state.activeWorkstreamId;
        // Force screen clear before loading new conversation
        this.screen.realloc();
        this.loadConversationHistory(activeWorkstream);
      }
    } else {
      // General chat mode - no workstream selected
      this.conversationHeader.setContent(' {cyan-fg}💬 General Chat{/cyan-fg} {gray-fg}(ephemeral - not saved){/gray-fg}');
      
      // Show welcome message for general chat if switching from a workstream
      if (this.lastActiveWorkstreamId !== null) {
        this.lastActiveWorkstreamId = null;
        this.conversationLog.setContent('');
        this.conversationLog.log('');
        this.conversationLog.log('');
        this.conversationLog.log('  {cyan-fg}General Chat Mode{/cyan-fg}');
        this.conversationLog.log('');
        this.conversationLog.log('  {gray-fg}Chat with the assistant without creating a workstream.{/gray-fg}');
        this.conversationLog.log('  {gray-fg}This conversation will not be saved.{/gray-fg}');
        this.conversationLog.log('');
        this.conversationLog.log('  {gray-fg}Press [c] to start chatting, or select a workstream.{/gray-fg}');
        this.conversationLog.log('');
        this.conversationLog.log('');
      }
    }
    
    // Update status bar
    this.updateStatusBar();
    this.screen.render();
  }

  private loadConversationHistory(workstream: Workstream): void {
    // Force full clear of conversation log to prevent ghost characters
    this.conversationLog.setContent('');
    this.conversationLog.setScrollPerc(0);
    
    // Force screen realloc to clear any stuck characters
    this.screen.realloc();
    
    // If no messages, show welcome
    if (!workstream.messages || workstream.messages.length === 0) {
      this.conversationLog.log('');
      this.conversationLog.log('');
      this.conversationLog.log(`  {cyan-fg}Ready to help with: ${workstream.name}{/cyan-fg}`);
      this.conversationLog.log('');
      this.conversationLog.log('  {gray-fg}Type your message below...{/gray-fg}');
      this.conversationLog.log('');
      this.conversationLog.log('');
      return;
    }
    
    // Display previous messages (skip system messages)
    for (const msg of workstream.messages) {
      if (msg.type === 'system') continue;
      
      if (msg.type === 'human') {
        // User messages: show full content with wrapping
        // Strip out injected context blocks that are meant for the AI
        let displayContent = stripAnsi(msg.content);
        
        if (displayContent.startsWith('[CONTEXT FOR THIS REQUEST]')) {
          // Context format: [CONTEXT...]\n{contexts}\n\n{actual message}
          // Find the last \n\n separator - actual message is after it
          const lastDoubleNewline = displayContent.lastIndexOf('\n\n');
          if (lastDoubleNewline > 0) {
            const candidate = displayContent.substring(lastDoubleNewline + 2).trim();
            // Verify this looks like a user message, not context
            // Context lines start with ===, **, →, •, - or are empty
            if (candidate && !candidate.startsWith('===') && !candidate.startsWith('**') &&
                !candidate.startsWith('→') && !candidate.startsWith('•')) {
              displayContent = candidate;
            }
          }
        }
        
        // Add visual separator and breathing room
        this.conversationLog.log('');
        this.conversationLog.log('  {gray-fg}───────────────────────────────────────────────{/gray-fg}');
        this.conversationLog.log('');
        
        // Display full message with proper wrapping
        const lines = displayContent.split('\n');
        if (lines.length === 1) {
          this.logWrapped(`  {bold}{cyan-fg}You:{/cyan-fg}{/bold} ${displayContent}`);
        } else {
          this.conversationLog.log(`  {bold}{cyan-fg}You:{/cyan-fg}{/bold}`);
          for (const line of lines) {
            this.logWrapped(`    ${line}`);
          }
        }
        this.conversationLog.log('');
      } else if (msg.type === 'tool') {
        // Tool result messages - show them to match the tool calls
        const toolName = msg.name || 'tool';
        const content = msg.content || '';
        
        // Show tool result with preview
        if (content.length > 200) {
          const preview = content.substring(0, 200).replace(/\n/g, ' ') + '...';
          this.logWrapped(`  {gray-fg}  ⚙ ${toolName} result: ${preview}{/gray-fg}`);
        } else if (content.length > 0) {
          // Short result - show it all
          const preview = content.replace(/\n/g, ' ');
          this.logWrapped(`  {gray-fg}  ⚙ ${toolName} result: ${preview}{/gray-fg}`);
        } else {
          // Empty result
          this.logWrapped(`  {gray-fg}  ⚙ ${toolName} completed{/gray-fg}`);
        }
      } else if (msg.type === 'ai') {
        // Check for tool calls in AI message first
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Show what tools were called - add visual grouping
          this.conversationLog.log('');
          this.conversationLog.log('  {cyan-fg}Tool calls:{/cyan-fg}');
          for (const tc of msg.toolCalls) {
            const argsPreview = JSON.stringify(tc.args || {}).substring(0, 80);
            const truncated = argsPreview.length >= 80 ? '...' : '';
            this.logWrapped(`    {gray-fg}→ ${tc.name}(${argsPreview}${truncated}){/gray-fg}`);
          }
        }
        
        // Then show the AI text content if present
        if (!msg.content) continue;
        // Skip raw JSON function call responses
        const content = msg.content.trim();
        if (content.startsWith('[{"type":"functionCall"') || 
            content.startsWith('[{"type":"text","text":""}]') ||
            content.startsWith('{"type":"functionCall"')) {
          continue;  // Don't display raw function calls
        }
        
        // AI messages: format nicely with separator
        const rendered = markdownToBlessed(msg.content);
        if (rendered.trim()) {
          this.conversationLog.log('');
          this.conversationLog.log('  {green-fg}───────────────────────────────────────────────{/green-fg}');
          this.conversationLog.log('');
          const lines = rendered.split('\n');
          let consecutiveBlank = 0;
          for (const line of lines) {
            if (line.trim()) {
              this.logWrapped(`  ${line}`);
              consecutiveBlank = 0;
            } else {
              // Allow up to 2 consecutive blank lines for better paragraph spacing
              consecutiveBlank++;
              if (consecutiveBlank <= 2) {
                this.conversationLog.log('');
              }
            }
          }
          this.conversationLog.log('');
        }
      }
    }
    this.conversationLog.log('');
    this.conversationLog.log('');
    
    // Render live progress if present (tool calls, cursor status)
    this.renderLiveProgress(workstream);
    
    // Scroll to bottom to show the most recent messages
    this.conversationLog.setScrollPerc(100);
  }

  /**
   * Render live progress (tool calls, cursor status) that survived workstream switching
   */
  private renderLiveProgress(workstream: Workstream): void {
    if (!workstream.liveProgress) return;
    
    const { cursorStatus, cursorStartedAt, toolCalls, lastUpdated } = workstream.liveProgress;
    
    // Only show if updated recently (within last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    if (lastUpdated < fiveMinutesAgo) return;
    
    let hasContent = false;
    
    // Show cursor status if active
    if (cursorStartedAt) {
      hasContent = true;
      const elapsed = Math.floor((Date.now() - cursorStartedAt) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      
      this.conversationLog.log('  {yellow-fg}━━━ Live Progress ━━━{/yellow-fg}');
      this.conversationLog.log(`  {cyan-fg}🤖 Cursor working... (${timeStr}){/cyan-fg}`);
      
      // Only show status detail if it's meaningful (not just "starting up" after time has passed)
      if (cursorStatus) {
        const isStartupMsg = cursorStatus.includes('starting up') || cursorStatus.includes('Starting');
        // Don't show "starting up" messages after 30 seconds - cursor has started by then
        if (!isStartupMsg || elapsed < 30) {
          this.logWrapped(`    {gray-fg}${cursorStatus}{/gray-fg}`);
        }
      }
    }
    
    // Show recent tool calls
    if (toolCalls && toolCalls.length > 0) {
      if (!hasContent) {
        this.conversationLog.log('  {yellow-fg}━━━ Live Progress ━━━{/yellow-fg}');
      }
      hasContent = true;
      
      this.conversationLog.log('');
      this.conversationLog.log('  {gray-fg}Recent tool calls:{/gray-fg}');
      // Show last 5 tool calls
      const recentCalls = toolCalls.slice(-5);
      for (const call of recentCalls) {
        const age = this.formatAge(call.timestamp);
        this.logWrapped(`    {gray-fg}→ ${call.name} (${age} ago){/gray-fg}`);
      }
    }
    
    if (hasContent) {
      this.conversationLog.log('  {yellow-fg}━━━━━━━━━━━━━━━━━━━━━{/yellow-fg}');
      this.conversationLog.log('');
    }
  }

  private formatAge(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }

  showProgress(message: string): void {
    // Strip ANSI codes that can leak from subprocess output
    const cleanMsg = stripAnsi(message);
    
    // Format the message based on type
    let formattedMsg: string | null = null;
    let isPersistentCursorMessage = false;
    
    if (cleanMsg.startsWith('→')) {
      // Tool execution: → tool_name(args)
      formattedMsg = `  {gray-fg}⚙ ${cleanMsg.substring(2)}{/gray-fg}`;
    } else if (cleanMsg.includes('Calling') || cleanMsg.includes('Running')) {
      formattedMsg = `  {gray-fg}⚙ ${cleanMsg.replace('Calling ', '').replace('Running ', '')}{/gray-fg}`;
    } else if (cleanMsg.startsWith('Thinking')) {
      // Show thinking indicator in status bar only (not in conversation log)
      // This prevents it from disappearing on workstream switch and breaking the UI
      this.statusBar.setContent(` {yellow-fg}${cleanMsg}{/yellow-fg}`);
      this.screen.render();
      return;  // Don't log to conversation
    } else if (cleanMsg.includes('Starting Cursor') || cleanMsg.includes('🤖')) {
      // Show cursor start message prominently AND make it persistent
      this.pendingProgressMessages.push('');
      formattedMsg = `  {cyan-fg}🤖 ${cleanMsg}{/cyan-fg}`;
      isPersistentCursorMessage = true;
    } else if (cleanMsg.startsWith('⏳')) {
      // Heartbeat/progress indicator from Cursor - always show these
      formattedMsg = `  {yellow-fg}${cleanMsg}{/yellow-fg}`;
    } else if (cleanMsg.includes('Cursor') || cleanMsg.includes('cursor')) {
      formattedMsg = `  {cyan-fg}${cleanMsg}{/cyan-fg}`;
      // Make cursor progress messages persistent so they stay visible
      isPersistentCursorMessage = cleanMsg.includes('Workspace') || cleanMsg.includes('Chat ID') || cleanMsg.includes('finished');
    } else if (cleanMsg.includes('workspace') || cleanMsg.includes('Workspace') || cleanMsg.includes('Task file')) {
      formattedMsg = `  {gray-fg}${cleanMsg}{/gray-fg}`;
    } else if (cleanMsg.includes('finished') || cleanMsg.includes('completed')) {
      formattedMsg = `  {green-fg}${cleanMsg}{/green-fg}`;
      isPersistentCursorMessage = cleanMsg.toLowerCase().includes('cursor');
    } else if (cleanMsg.startsWith('✗') || cleanMsg.startsWith('Error')) {
      // Error messages - always show
      formattedMsg = `  {red-fg}${cleanMsg}{/red-fg}`;
    } else if (cleanMsg.startsWith('✓') || cleanMsg.includes('success')) {
      // Success messages - always show
      formattedMsg = `  {green-fg}${cleanMsg}{/green-fg}`;
    } else if (cleanMsg.match(/^(read_file|grep|search_replace|write|codebase_search|list_dir|run_terminal_cmd)/i)) {
      // Cursor tool calls - show these so user knows what Cursor is doing
      const truncated = cleanMsg.length > 80 ? cleanMsg.substring(0, 77) + '...' : cleanMsg;
      formattedMsg = `  {gray-fg}→ ${truncated}{/gray-fg}`;
    } else if (cleanMsg.match(/^(Reading|Writing|Searching|Editing|Creating|Modifying|Updating)/i)) {
      // Action descriptions from Cursor
      formattedMsg = `  {gray-fg}  ${cleanMsg}{/gray-fg}`;
    }
    
    // Skip unformatted messages (verbose progress)
    if (!formattedMsg) return;
    
    // If this is a persistent cursor message, also add a loading status indicator
    if (isPersistentCursorMessage && cleanMsg.includes('Starting Cursor')) {
      // Add a loading indicator that will persist in the conversation
      this.pendingProgressMessages.push(formattedMsg);
      this.pendingProgressMessages.push('  {yellow-fg}⏳ Cursor is working... (this may take a while){/yellow-fg}');
      this.pendingProgressMessages.push('');
    } else {
      // Queue the message for batched writing
      this.pendingProgressMessages.push(formattedMsg);
    }
    
    // Schedule a batched flush
    if (this.progressFlushTimeout) {
      clearTimeout(this.progressFlushTimeout);
    }
    this.progressFlushTimeout = setTimeout(() => {
      this.flushProgressMessages();
    }, 50);  // Batch messages within 50ms window
  }
  
  private flushProgressMessages(): void {
    if (this.pendingProgressMessages.length === 0) return;
    
    // Write all pending messages at once with proper wrapping
    for (const msg of this.pendingProgressMessages) {
      // Empty lines don't need wrapping
      if (msg.trim().length === 0) {
        this.conversationLog.log(msg);
      } else {
        this.logWrapped(msg);
      }
    }
    this.pendingProgressMessages = [];
    this.progressFlushTimeout = null;
    
    // Scroll to bottom to ensure messages are visible
    this.conversationLog.setScrollPerc(100);
    
    // Single render after all writes
    this.screen.render();
  }

  showInfo(message: string): void {
    this.conversationLog.log('');
    this.logWrapped(`  {cyan-fg}ℹ ${stripAnsi(message)}{/cyan-fg}`);
    this.conversationLog.setScrollPerc(100);
    this.screen.render();
  }

  showError(message: string): void {
    this.conversationLog.log('');
    this.logWrapped(`  {red-fg}✗ ${stripAnsi(message)}{/red-fg}`);
    this.conversationLog.setScrollPerc(100);
    this.screen.render();
  }

  showSuccess(message: string): void {
    this.conversationLog.log('');
    this.logWrapped(`  {green-fg}✓ ${stripAnsi(message)}{/green-fg}`);
    this.conversationLog.setScrollPerc(100);
    this.screen.render();
  }

  appendResponse(response: string): void {
    // Skip raw JSON function call responses
    if (response.trim().startsWith('[{"type":"functionCall"') || 
        response.trim().startsWith('[{"type":"text","text":""}]') ||
        response.trim().startsWith('{"type":"functionCall"')) {
      return;  // Don't display raw function calls
    }
    
    // Convert markdown to blessed tags
    const rendered = markdownToBlessed(response);
    if (!rendered.trim()) return;  // Skip empty responses (like pure function calls)
    
    // Add visual separator for AI response
    this.conversationLog.log('');
    this.conversationLog.log('');
    this.conversationLog.log('  {green-fg}───────────────────────────────────────────────{/green-fg}');
    this.conversationLog.log('');
    
    const lines = rendered.split('\n');
    let consecutiveBlank = 0;
    for (const line of lines) {
      if (line.trim()) {
        this.logWrapped(`  ${line}`);
        consecutiveBlank = 0;
      } else {
        // Allow up to 2 consecutive blank lines for better paragraph spacing
        consecutiveBlank++;
        if (consecutiveBlank <= 2) {
          this.conversationLog.log('');
        }
      }
    }
    this.conversationLog.log('');
    this.conversationLog.log('');
    
    // Explicitly scroll to bottom to ensure last message is visible
    this.conversationLog.setScrollPerc(100);
    this.screen.render();
  }

  /**
   * Force a complete clear and re-render of conversation.
   * Used when switching workstreams to prevent partial/stale content
   * from background processing affecting the display.
   */
  clearAndRenderConversation(workstream: Workstream): void {
    // Force full clear of conversation log
    this.conversationLog.setContent('');
    this.conversationLog.setScrollPerc(0);
    
    // Force screen realloc to clear any stuck characters
    this.screen.realloc();
    
    // Update tracking
    this.lastActiveWorkstreamId = workstream.id;
    
    // Re-render conversation history
    this.loadConversationHistory(workstream);
    
    // Ensure render
    this.screen.render();
  }

  /**
   * Update voice state and refresh status bar
   */
  updateVoiceState(state: VoiceState): void {
    this.voiceState = state;
    this.updateStatusBar();
    this.screen.render();
  }

  /**
   * Scroll the conversation by a number of lines
   */
  scrollConversation(lines: number): void {
    this.conversationLog.scroll(lines);
    this.screen.clearRegion(0, this.screen.cols, 0, this.screen.rows);
    this.screen.render();
  }

  /**
   * Force a full screen re-render (useful after voice commands)
   */
  forceRender(): void {
    this.screen.realloc();
    this.screen.render();
  }

  /**
   * Show voice commands help overlay
   */
  showVoiceCommands(): void {
    if (this.helpOverlay) {
      this.closeOverlay();
      return;
    }

    // Cancel any textarea input mode first
    (this.inputBox as any).cancel?.();

    // Check if voice features are available on this platform
    const voiceAvailable = isFeatureAvailable('voice');
    
    // Show different content based on voice availability
    const content = voiceAvailable ? `
  {bold}{magenta-fg}Voice Commands{/magenta-fg}{/bold}
  {gray-fg}All commands start with "COMMAND" (say it clearly){/gray-fg}
  {gray-fg}Press [ to record, [ again to stop{/gray-fg}

  {bold}MESSAGE:{/bold}
    "command send"              Send current message
    "command cancel"            Clear input
    "command stop"              Interrupt the agent
    "command continue"          Resume after limit

  {bold}NAVIGATION:{/bold}
    "command workstream [name]" Switch to workstream by name
    "command workstream [1-9]"  Switch to workstream by number
    "command general chat"      Open general chat
    "command tasks"             Focus tasks panel
    "command advice"            Focus advice panel
    "command list"              Focus workstream list

  {bold}WORKSTREAMS:{/bold}
    "command new workstream X"  Create workstream named X
    "command delete workstream" Delete current workstream
    "command reset"             Reset conversation

  {bold}TASKS:{/bold}
    "command new task X"        Create task with description X
    "command delete task"       Delete selected task
    "command next task"         Select next task
    "command previous task"     Select previous task

  {bold}UTILITIES:{/bold}
    "command copy"              Copy last response
    "command links"             Show link picker
    "command help"              Show general help
    "command commands"          Show this list
    "command scroll up/down"    Scroll conversation
    "command quit"              Quit application

  {bold}VOICE CONTROL:{/bold}
    "command voice on"          Enable text-to-speech
    "command voice off"         Disable text-to-speech
    "command read again"        Re-read last response

  {magenta-fg}Press Esc, q, or Enter to close...{/magenta-fg}
      ` : `
  {bold}{magenta-fg}Voice Commands{/magenta-fg}{/bold}
  
  {yellow-fg}Voice features are not available on this platform.{/yellow-fg}
  
  Voice commands (speech-to-text and text-to-speech) are 
  currently only supported on macOS.
  
  All other features of the TUI work normally on Windows.
  
  {gray-fg}Future updates may add Windows voice support using
  Windows Speech API or cloud-based alternatives.{/gray-fg}

  {magenta-fg}Press Esc, q, or Enter to close...{/magenta-fg}
      `;

    this.helpOverlay = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: 70,
      height: voiceAvailable ? '85%' : '40%',
      border: {
        type: 'line',
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      alwaysScroll: true,
      focusable: true,
      scrollbar: {
        ch: '│',
        style: { fg: 'magenta' },
      },
      style: {
        border: {
          fg: 'magenta',
        },
        bg: 'black',
      },
      content,
      tags: true,
    });

    // Use screen-level key handler to ensure we catch the keys
    const closeHandler = () => {
      if (this.helpOverlay) {
        this.screen.unkey('escape', closeHandler);
        this.screen.unkey('q', closeHandler);
        this.screen.unkey('enter', closeHandler);
        this.screen.unkey('space', closeHandler);
        this.closeOverlay();
      }
    };
    this.screen.key('escape', closeHandler);
    this.screen.key('q', closeHandler);
    this.screen.key('enter', closeHandler);
    this.screen.key('space', closeHandler);

    this.helpOverlay.focus();
    this.screen.render();
  }
}
