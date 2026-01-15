// Tasks module - task management rules (~200 tokens)
// Loaded when user mentions tasks, todos, reminders

export const tasksModule = `
TASK MANAGEMENT:
- create_task, list_tasks, complete_task, update_task, delete_task
- search_tasks (find by keywords), get_task_context (retrieve original prompt)
- create_reminder, list_reminders, acknowledge_reminder
- ONLY create tasks when user explicitly asks (e.g., "add to my tasks", "remind me")
- When updating: only change fields mentioned, don't mark complete unless work done
- Don't mark completed prematurely - only when actual work finished
- Draft PR = still in_progress, not completed

CHECKLIST: Use update_checklist for complex multi-step tasks to track progress.

MEMORY: propose_memory for preferences, remember for explicit "remember this" requests.
`;

