// Personal task/todo management for the AI assistant
// Persists tasks to disk so they survive between sessions

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ensureConfigDir } from '../../utils/platform.js';

export interface Task {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: number;
  updatedAt: number;
  dueDate?: number;
  tags?: string[];
  notes?: string;
  context?: string; // What conversation/project this relates to
  originalPrompt?: string; // Full original Slack thread, paste, or long prompt that led to this task
  workDir?: string; // Path to WORK_DIRS subdirectory if Cursor or other tool created one
  lastAskedAboutDeadline?: number; // Timestamp of last time we asked about deadline
}

export interface Reminder {
  id: string;
  content: string;
  triggerAt: number; // Unix timestamp
  recurring?: 'daily' | 'weekly' | 'monthly';
  createdAt: number;
  acknowledged: boolean;
}

export interface AssistantMemory {
  tasks: Task[];
  reminders: Reminder[];
  context: {
    currentProject?: string;
    recentTopics?: string[];
    userPreferences?: Record<string, string>;
  };
  lastUpdated: number;
  // Track when deadline reminders were last shown to avoid repetition
  deadlineReminderState?: {
    lastShown: number;           // Timestamp of last reminder
    tasksReminded: string[];     // Task IDs mentioned in last reminder
    reminderCount: number;       // How many times reminded this session
  };
}

// Store data in platform-appropriate config directory
function getDataPath(): string {
  return ensureConfigDir();
}

function getMemoryFilePath(): string {
  return join(getDataPath(), 'memory.json');
}

function getTaskContextPath(taskId: string): string {
  return join(getDataPath(), 'task-contexts', `${taskId}.txt`);
}

// Load assistant memory from disk
export async function loadMemory(): Promise<AssistantMemory> {
  const filePath = getMemoryFilePath();
  
  if (!existsSync(filePath)) {
    return {
      tasks: [],
      reminders: [],
      context: {},
      lastUpdated: Date.now(),
    };
  }
  
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      tasks: [],
      reminders: [],
      context: {},
      lastUpdated: Date.now(),
    };
  }
}

// Save assistant memory to disk
export async function saveMemory(memory: AssistantMemory): Promise<void> {
  const dataPath = getDataPath();
  const filePath = getMemoryFilePath();
  
  if (!existsSync(dataPath)) {
    await mkdir(dataPath, { recursive: true });
  }
  
  memory.lastUpdated = Date.now();
  await writeFile(filePath, JSON.stringify(memory, null, 2));
}

// Generate a unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// === Task Management Functions ===

/**
 * Check if a similar task already exists (fuzzy matching by content)
 * Returns the similar task if found, null otherwise
 */
export async function findSimilarTask(content: string): Promise<Task | null> {
  const results = await searchTasks(content);
  
  if (results.length === 0) return null;
  
  // Check if top result is very similar (>70% word overlap)
  const topResult = results[0];
  const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const taskWords = new Set(topResult.content.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  let matchCount = 0;
  for (const word of contentWords) {
    if (taskWords.has(word)) matchCount++;
  }
  
  const similarity = matchCount / Math.max(contentWords.size, 1);
  
  // If >70% similar, consider it a duplicate
  if (similarity > 0.7) {
    return topResult;
  }
  
  return null;
}

export async function createTask(
  content: string,
  options: {
    priority?: Task['priority'];
    dueDate?: Date | string;
    tags?: string[];
    context?: string;
    originalPrompt?: string;
    skipDuplicateCheck?: boolean; // Allow bypassing duplicate check if needed
  } = {}
): Promise<Task> {
  const memory = await loadMemory();
  
  // Check for similar existing tasks unless explicitly skipped
  if (!options.skipDuplicateCheck) {
    const similar = await findSimilarTask(content);
    if (similar) {
      // Return existing task info instead of creating duplicate
      throw new Error(`Similar task already exists (ID: ${similar.id}): "${similar.content}". Use update_task to modify it, or search_tasks to find it.`);
    }
  }
  
  const task: Task = {
    id: generateId(),
    content,
    status: 'pending',
    priority: options.priority || 'medium',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dueDate: options.dueDate 
      ? (typeof options.dueDate === 'string' ? new Date(options.dueDate).getTime() : options.dueDate.getTime())
      : undefined,
    tags: options.tags,
    context: options.context,
    originalPrompt: options.originalPrompt,
  };
  
  // Save original prompt to a separate file if it's long (>500 chars)
  if (options.originalPrompt && options.originalPrompt.length > 500) {
    const contextPath = getTaskContextPath(task.id);
    const contextDir = join(getDataPath(), 'task-contexts');
    
    if (!existsSync(contextDir)) {
      await mkdir(contextDir, { recursive: true });
    }
    
    const contextContent = `Task: ${content}
Created: ${new Date(task.createdAt).toISOString()}
Priority: ${task.priority}
${task.dueDate ? `Due: ${new Date(task.dueDate).toISOString()}` : ''}

===== ORIGINAL CONTEXT =====

${options.originalPrompt}
`;
    
    await writeFile(contextPath, contextContent);
    
    // Store reference to file instead of full content
    task.originalPrompt = `[Saved to file: task-contexts/${task.id}.txt]`;
  }
  
  memory.tasks.push(task);
  await saveMemory(memory);
  
  return task;
}

export async function updateTask(
  taskId: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>
): Promise<Task | null> {
  const memory = await loadMemory();
  const taskIndex = memory.tasks.findIndex(t => t.id === taskId);
  
  if (taskIndex === -1) {
    return null;
  }
  
  // Defensively filter out undefined values to prevent wiping existing fields
  const filteredUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );
  
  memory.tasks[taskIndex] = {
    ...memory.tasks[taskIndex],
    ...filteredUpdates,
    updatedAt: Date.now(),
  };
  
  await saveMemory(memory);
  return memory.tasks[taskIndex];
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const memory = await loadMemory();
  const initialLength = memory.tasks.length;
  memory.tasks = memory.tasks.filter(t => t.id !== taskId);
  
  if (memory.tasks.length !== initialLength) {
    await saveMemory(memory);
    return true;
  }
  return false;
}

export async function getTasks(filter?: {
  status?: Task['status'] | Task['status'][];
  priority?: Task['priority'] | Task['priority'][];
  tags?: string[];
  dueBefore?: Date;
  dueAfter?: Date;
}): Promise<Task[]> {
  const memory = await loadMemory();
  let tasks = memory.tasks;
  
  if (filter) {
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter(t => statuses.includes(t.status));
    }
    if (filter.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      tasks = tasks.filter(t => priorities.includes(t.priority));
    }
    if (filter.tags?.length) {
      tasks = tasks.filter(t => 
        t.tags?.some(tag => filter.tags!.includes(tag))
      );
    }
    if (filter.dueBefore) {
      const before = filter.dueBefore.getTime();
      tasks = tasks.filter(t => t.dueDate && t.dueDate <= before);
    }
    if (filter.dueAfter) {
      const after = filter.dueAfter.getTime();
      tasks = tasks.filter(t => t.dueDate && t.dueDate >= after);
    }
  }
  
  // Sort by priority (urgent first) then by due date
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  return tasks.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    
    // Then by due date (earlier first, no due date last)
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}

export async function getActiveTasks(): Promise<Task[]> {
  return getTasks({ status: ['pending', 'in_progress'] });
}

export async function completeTask(taskId: string): Promise<Task | null> {
  return updateTask(taskId, { status: 'completed' });
}

export async function startTask(taskId: string): Promise<Task | null> {
  return updateTask(taskId, { status: 'in_progress' });
}

// === Reminder Management Functions ===

export async function createReminder(
  content: string,
  triggerAt: Date | string,
  recurring?: Reminder['recurring']
): Promise<Reminder> {
  const memory = await loadMemory();
  
  const reminder: Reminder = {
    id: generateId(),
    content,
    triggerAt: typeof triggerAt === 'string' ? new Date(triggerAt).getTime() : triggerAt.getTime(),
    recurring,
    createdAt: Date.now(),
    acknowledged: false,
  };
  
  memory.reminders.push(reminder);
  await saveMemory(memory);
  
  return reminder;
}

export async function getActiveReminders(): Promise<Reminder[]> {
  const memory = await loadMemory();
  const now = Date.now();
  
  return memory.reminders
    .filter(r => !r.acknowledged && r.triggerAt <= now)
    .sort((a, b) => a.triggerAt - b.triggerAt);
}

export async function getPendingReminders(): Promise<Reminder[]> {
  const memory = await loadMemory();
  const now = Date.now();
  
  return memory.reminders
    .filter(r => !r.acknowledged && r.triggerAt > now)
    .sort((a, b) => a.triggerAt - b.triggerAt);
}

export async function acknowledgeReminder(reminderId: string): Promise<boolean> {
  const memory = await loadMemory();
  const reminder = memory.reminders.find(r => r.id === reminderId);
  
  if (!reminder) return false;
  
  if (reminder.recurring) {
    // Reschedule for next occurrence
    const now = new Date();
    let nextTrigger = new Date(reminder.triggerAt);
    
    switch (reminder.recurring) {
      case 'daily':
        nextTrigger.setDate(nextTrigger.getDate() + 1);
        break;
      case 'weekly':
        nextTrigger.setDate(nextTrigger.getDate() + 7);
        break;
      case 'monthly':
        nextTrigger.setMonth(nextTrigger.getMonth() + 1);
        break;
    }
    
    // If still in the past, fast-forward to future
    while (nextTrigger.getTime() <= now.getTime()) {
      switch (reminder.recurring) {
        case 'daily':
          nextTrigger.setDate(nextTrigger.getDate() + 1);
          break;
        case 'weekly':
          nextTrigger.setDate(nextTrigger.getDate() + 7);
          break;
        case 'monthly':
          nextTrigger.setMonth(nextTrigger.getMonth() + 1);
          break;
      }
    }
    
    reminder.triggerAt = nextTrigger.getTime();
    reminder.acknowledged = false;
  } else {
    reminder.acknowledged = true;
  }
  
  await saveMemory(memory);
  return true;
}

export async function deleteReminder(reminderId: string): Promise<boolean> {
  const memory = await loadMemory();
  const initialLength = memory.reminders.length;
  memory.reminders = memory.reminders.filter(r => r.id !== reminderId);
  
  if (memory.reminders.length !== initialLength) {
    await saveMemory(memory);
    return true;
  }
  return false;
}

// === Context Management ===

export async function setContext(key: string, value: string): Promise<void> {
  const memory = await loadMemory();
  if (!memory.context.userPreferences) {
    memory.context.userPreferences = {};
  }
  memory.context.userPreferences[key] = value;
  await saveMemory(memory);
}

export async function getContext(key: string): Promise<string | undefined> {
  const memory = await loadMemory();
  return memory.context.userPreferences?.[key];
}

export async function setCurrentProject(project: string): Promise<void> {
  const memory = await loadMemory();
  memory.context.currentProject = project;
  await saveMemory(memory);
}

export async function addRecentTopic(topic: string): Promise<void> {
  const memory = await loadMemory();
  if (!memory.context.recentTopics) {
    memory.context.recentTopics = [];
  }
  
  // Add to front, keep last 10
  memory.context.recentTopics = [
    topic,
    ...memory.context.recentTopics.filter(t => t !== topic),
  ].slice(0, 10);
  
  await saveMemory(memory);
}

// === Summary Functions for AI ===

export async function getTaskSummary(): Promise<string> {
  const tasks = await getActiveTasks();
  const reminders = await getActiveReminders();
  
  if (tasks.length === 0 && reminders.length === 0) {
    return 'No active tasks or reminders.';
  }
  
  const lines: string[] = [];
  
  if (tasks.length > 0) {
    lines.push(`**Active Tasks (${tasks.length}):**`);
    for (const task of tasks) {
      const due = task.dueDate 
        ? ` [due: ${new Date(task.dueDate).toLocaleDateString()}]`
        : '';
      const status = task.status === 'in_progress' ? ' 🔄' : '';
      const hasContext = task.originalPrompt ? ' 📎' : '';
      lines.push(`- [${task.priority}] ${task.content}${due}${status}${hasContext} (id: ${task.id})`);
    }
  }
  
  if (reminders.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`**Active Reminders (${reminders.length}):**`);
    for (const reminder of reminders) {
      lines.push(`- ⏰ ${reminder.content} (id: ${reminder.id})`);
    }
  }
  
  return lines.join('\n');
}

// Get task with full original context
export async function getTaskWithContext(taskId: string): Promise<{ task: Task; fullContext?: string } | null> {
  const memory = await loadMemory();
  const task = memory.tasks.find(t => t.id === taskId);
  
  if (!task) return null;
  
  // Check if original prompt was saved to file
  if (task.originalPrompt?.includes('[Saved to file:')) {
    const contextPath = getTaskContextPath(taskId);
    if (existsSync(contextPath)) {
      const fullContext = await readFile(contextPath, 'utf-8');
      return { task, fullContext };
    }
  }
  
  return { task, fullContext: task.originalPrompt };
}

// Check if we recently asked about deadline for this task (within last 24 hours)
export async function shouldAskAboutDeadline(taskId: string): Promise<boolean> {
  const memory = await loadMemory();
  const task = memory.tasks.find(t => t.id === taskId);
  
  if (!task || task.dueDate) return false; // Already has deadline
  
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  return !task.lastAskedAboutDeadline || task.lastAskedAboutDeadline < oneDayAgo;
}

// Mark that we asked about deadline
export async function markAskedAboutDeadline(taskId: string): Promise<void> {
  await updateTask(taskId, { lastAskedAboutDeadline: Date.now() });
}

export async function searchTasks(query: string): Promise<Task[]> {
  const memory = await loadMemory();
  
  // Defensive check: ensure query is a string
  if (typeof query !== 'string' || !query) {
    return [];
  }
  
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
  
  // Score each task based on how well it matches
  const scored = memory.tasks
    .filter(t => t.status !== 'completed' && t.status !== 'cancelled') // Only active tasks
    .filter(t => t.content && typeof t.content === 'string') // Skip tasks without content or invalid content
    .map(task => {
      const contentLower = task.content.toLowerCase();
      const contextLower = (task.context || '').toLowerCase();
      const tagsLower = ((task.tags || []).join(' ')).toLowerCase();
      
      let score = 0;
      
      // Exact phrase match gets highest score
      if (contentLower.includes(queryLower)) {
        score += 100;
      }
      
      // Word matches
      for (const word of queryWords) {
        if (contentLower.includes(word)) score += 10;
        if (contextLower.includes(word)) score += 5;
        if (tagsLower.includes(word)) score += 5;
      }
      
      return { task, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  
  return scored.map(item => item.task);
}

export async function getFullMemorySummary(): Promise<string> {
  const memory = await loadMemory();
  const activeTasks = memory.tasks.filter(t => ['pending', 'in_progress'].includes(t.status));
  const completedTasks = memory.tasks.filter(t => t.status === 'completed');
  const activeReminders = await getActiveReminders();
  const pendingReminders = await getPendingReminders();
  
  const lines = [
    '## Your Tasks & Reminders',
    '',
    `- Active tasks: ${activeTasks.length}`,
    `- Completed tasks: ${completedTasks.length}`,
    `- Active reminders: ${activeReminders.length}`,
    `- Pending reminders: ${pendingReminders.length}`,
  ];
  
  if (memory.context.currentProject) {
    lines.push(`- Current project: ${memory.context.currentProject}`);
  }
  
  return lines.join('\n');
}

// ===== DEADLINE REMINDER THROTTLING =====

const REMINDER_COOLDOWN_MS = 30 * 60 * 1000;  // 30 minutes between deadline reminders
const MAX_REMINDERS_PER_SESSION = 3;  // Max times to remind about same deadlines

export interface DeadlineReminderCheck {
  shouldRemind: boolean;
  tasksToRemind: Task[];
  reason?: string;  // Why we're reminding or not
}

/**
 * Check if we should remind the user about deadline tasks
 * Returns tasks to remind about, or empty if we shouldn't remind
 */
export async function checkDeadlineReminders(): Promise<DeadlineReminderCheck> {
  const memory = await loadMemory();
  const now = Date.now();
  const state = memory.deadlineReminderState;
  
  // Get tasks with deadlines in next 24 hours or overdue
  const urgentTasks = memory.tasks.filter(t => {
    if (t.status === 'completed' || t.status === 'cancelled') return false;
    if (!t.dueDate) return false;
    
    const deadline = new Date(t.dueDate);
    const hoursUntilDue = (deadline.getTime() - now) / (1000 * 60 * 60);
    
    // Include if overdue or due within 24 hours
    return hoursUntilDue <= 24;
  });
  
  if (urgentTasks.length === 0) {
    return { shouldRemind: false, tasksToRemind: [], reason: 'No urgent deadlines' };
  }
  
  // Check if we've reminded recently
  if (state?.lastShown) {
    const timeSinceLastReminder = now - state.lastShown;
    
    // Within cooldown period
    if (timeSinceLastReminder < REMINDER_COOLDOWN_MS) {
      return { 
        shouldRemind: false, 
        tasksToRemind: [], 
        reason: `Reminded ${Math.round(timeSinceLastReminder / 60000)} minutes ago, cooldown is ${REMINDER_COOLDOWN_MS / 60000} minutes` 
      };
    }
    
    // Check if these are the same tasks we already reminded about
    const sameTasksReminded = urgentTasks.every(t => state.tasksReminded?.includes(t.id));
    if (sameTasksReminded && (state.reminderCount || 0) >= MAX_REMINDERS_PER_SESSION) {
      return { 
        shouldRemind: false, 
        tasksToRemind: [], 
        reason: `Already reminded ${state.reminderCount} times about these tasks` 
      };
    }
  }
  
  return { shouldRemind: true, tasksToRemind: urgentTasks };
}

/**
 * Record that we showed deadline reminders
 */
export async function recordDeadlineReminder(taskIds: string[]): Promise<void> {
  const memory = await loadMemory();
  const now = Date.now();
  
  const prevState = memory.deadlineReminderState || { lastShown: 0, tasksReminded: [], reminderCount: 0 };
  
  // Check if same tasks - if so increment counter, otherwise reset
  const sameTasks = taskIds.every(id => prevState.tasksReminded.includes(id)) &&
                    prevState.tasksReminded.every(id => taskIds.includes(id));
  
  memory.deadlineReminderState = {
    lastShown: now,
    tasksReminded: taskIds,
    reminderCount: sameTasks ? (prevState.reminderCount || 0) + 1 : 1,
  };
  
  await saveMemory(memory);
}

/**
 * Reset deadline reminder state (call when tasks change significantly)
 */
export async function resetDeadlineReminderState(): Promise<void> {
  const memory = await loadMemory();
  memory.deadlineReminderState = undefined;
  await saveMemory(memory);
}

/**
 * Get task list with reminder throttling info
 * This replaces direct calls to getTasks when displaying to user
 */
export async function getTasksWithReminderInfo(): Promise<{
  tasks: Task[];
  deadlineReminder?: {
    shouldShow: boolean;
    tasks: Task[];
    reason?: string;
  };
}> {
  const tasks = await getTasks();
  const reminderCheck = await checkDeadlineReminders();
  
  return {
    tasks,
    deadlineReminder: {
      shouldShow: reminderCheck.shouldRemind,
      tasks: reminderCheck.tasksToRemind,
      reason: reminderCheck.reason,
    },
  };
}

