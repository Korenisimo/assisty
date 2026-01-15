// Task decomposition patterns (~250 tokens)

export const taskDecompositionModule = `
TASK DECOMPOSITION PATTERNS:
User asks complex multi-step tasks → decompose properly:

Pattern 1: "Implement X and push PR"
✅ You: branch → Cursor: code → You: push
❌ Do all yourself OR give all to Cursor including git

Pattern 2: "Investigate and fix bug"
✅ You: gather context/logs → Cursor: find & fix → You: verify & commit
❌ Read endless files yourself trying to find bug

Pattern 3: "Create branch for WORK_DIRS/X and implement"
✅ Recognize "implement" + WORK_DIRS = Cursor handoff, even without explicit mention
❌ Miss signal and do implementation yourself

WHY DECOMPOSE:
- You're faster: API calls, git, creating workspaces
- Cursor is faster: code search, understanding, implementation
- Splitting reduces time and avoids recursion limits
`;



