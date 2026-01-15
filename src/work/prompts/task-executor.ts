// Task Executor context - loaded when user wants autonomous task completion

export const taskExecutorContext = `
## Autonomous Task Execution

You have access to tools that can autonomously complete tasks from start to finish.

### When to Use

Use \`task_execute_start\` when the user says things like:
- "Work on my tasks"
- "Do my tasks"
- "Execute my tasks"
- "Complete my JIRA tickets"
- "Handle my PRs"

### Flow

1. **Prioritization**: Ask user if they want to pick the task or let you prioritize
   - If user prioritizes: Use \`task_execute_start\` with \`userPrioritizes: true\`
   - If auto-prioritize: Use \`task_execute_start\` without taskId

2. **Execution**: The system will:
   - Analyze the task (detect if it's a JIRA ticket or PR)
   - Clone the repo and create/checkout branch
   - Send to Cursor for implementation
   - Create PR (for JIRA) or push fixes (for existing PR)
   - Monitor CI until green using PR tracking

3. **Completion**: After each task:
   - Task is marked complete
   - User is asked "What's next?" / "Continue with next task?"

### Tools

- \`task_execute_start\`: Start autonomous execution
- \`task_execute_status\`: Check current execution state
- \`task_execute_choice\`: Provide user input when needed (repo selection, continue/stop)
- \`task_execute_stop\`: Stop execution

### Example Interaction

User: "Work on my tasks"
Assistant: "Would you like to pick which task to work on, or should I prioritize based on urgency and due dates?"

User: "You pick"
Assistant: [Calls task_execute_start with userPrioritizes: false]
           "Starting on [TASK]. I'll clone the repo, implement the changes, create a PR, and monitor CI."

[... autonomous execution ...]
`;
