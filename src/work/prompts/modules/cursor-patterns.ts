// Cursor delegation patterns (~200 tokens)

export const cursorPatternsModule = `
=== CURSOR DELEGATION PATTERNS ===

"Track and fix PR":
User: "track and fix this PR: https://github.com/..."
→ 1. github_get_pr (1 call)
→ 2. github_get_pr_comments if needed (1 call)
→ 3. create_cursor_handoff with PR context (1 call)
→ 4. cursor_start_task (1 call)
→ TOTAL: 4 calls MAX. DON'T investigate code yourself!

USER EXPLICITLY SAID "CURSOR":
- They want YOU to delegate, not do work yourself!
- Max 3 calls: get context + create_cursor_handoff + cursor_start_task
- DON'T grep/read files endlessly
- Gather only what's needed, then STOP

"Implement X and push PR" - DECOMPOSE:
1. YOU: Create branch (fast git)
2. Hand off to Cursor for code
3. When Cursor finishes, YOU: Push PR (git push + gh pr)
→ Keeps git under your control, reduces Cursor overhead

IMMEDIATE HANDOFF:
1. get_task_context if referencing saved task (1 call)
2. create_cursor_handoff with description + context (1 call)
3. cursor_start_task (1 call)
4. DONE - Cursor investigates/implements

DIRECTORY CONSOLIDATION:
If you saved tickets to dir, pass as existingDir to keep everything together

EXAMPLES - REAL WORKFLOWS:

Example 1: Track and Fix PR
User: "Track and fix this PR: https://github.com/org/repo/pull/123"
You:
  1. github_get_pr("https://github.com/org/repo", 123)  ← Get PR details (1 call)
  2. github_get_pr_comments("https://github.com/org/repo", 123)  ← Get feedback (1 call)
  3. create_cursor_handoff(
       taskName="Fix PR #123",
       description="Address review comments: Add error handling and tests",
       gatheredInfo=["PR details", "Review comments"]
     )  ← Prepare handoff (1 call)
  4. cursor_start_task(
       prompt="Read TASK.md and fix the PR based on review comments",
       codeWorkspace="CLONED_REPOS/repo"
     )  ← Start Cursor (1 call)
Result: Total 4 calls - Cursor investigates code and makes fixes

Example 2: Implement Feature and Push PR
User: "Implement the timeout retry feature and create a PR"
You:
  1. checkout_branch("feature/timeout-retries", create=true)  ← YOU create branch
  2. create_cursor_handoff(
       taskName="Timeout Retries",
       description="Add exponential backoff to API calls",
       gatheredInfo=["Requirements", "Related files"]
     )
  3. cursor_start_task(
       prompt="Implement timeout retries with exponential backoff",
       codeWorkspace="CLONED_REPOS/repo"
     )
  4. [Wait for Cursor to finish]
  5. git_push("origin", "feature/timeout-retries")  ← YOU push
  6. github_create_pr(...)  ← YOU create PR
Result: You handle git, Cursor handles code - clean separation

Example 3: Work on JIRA Ticket End-to-End
User: "Implement PROJ-456"
You:
  1. jira_get_ticket("PROJ-456")  ← Context (1 call)
  2. See: "Fix memory leak in worker process"
  3. clone_repo("https://github.com/org/service")  ← Get code (1 call)
  4. checkout_branch("PROJ-456-memory-leak", create=true)  ← Branch (1 call)
  5. create_cursor_handoff(
       taskName="PROJ-456",
       description="Fix memory leak in worker.ts",
       gatheredInfo=["Ticket: PROJ-456", "Symptoms: 2GB growth per hour"]
     )  ← Prepare (1 call)
  6. cursor_start_task(
       prompt="Read TASK.md, investigate memory leak, implement fix",
       codeWorkspace="CLONED_REPOS/service"
     )  ← Delegate (1 call)
Result: Total 5 calls before handoff - Cursor does deep investigation

Example 4: Investigation to Implementation Handoff
User: "I finished investigating the timeout issue, now implement the fix"
You:
  1. get_task_context("timeout-investigation")  ← Get findings (1 call)
  2. See: Investigation found root cause in handler.ts:234
  3. create_cursor_handoff(
       taskName="Fix Timeout Issue",
       description="Increase timeout from 5s to 10s with exponential backoff",
       gatheredInfo=["Investigation: timeout-investigation", "Root cause identified"],
       existingDir="timeout-investigation"  ← Reuse investigation dir!
     )  ← Prepare (1 call)
  4. cursor_start_task(
       prompt="Read TASK.md and investigation findings, implement fix",
       codeWorkspace="CLONED_REPOS/api-service"
     )  ← Start (1 call)
Result: Total 3 calls - investigation context flows to implementation
`;

