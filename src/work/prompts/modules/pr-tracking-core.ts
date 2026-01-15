// PR tracking core - tools and workflow (~250 tokens)

export const prTrackingCoreModule = `
## PR TRACKING & CI MONITORING

IMPORTANT: To monitor/track/watch PR, check CI, verify results:
- DO NOT use create_reminder - passive, requires user interaction
- DO use pr_watch_start - actively polls every 45 seconds
- CI/CD takes time (5-15+ min). Always assume need to wait and verify.

TOOLS:
- pr_watch_start: Start watching PR
  → Clones repo, checks out PR branch
  → Polls CI status every 45 seconds
  → On failure: auto-invoke Cursor to fix and commit
  → On success: offer to squash commits
- pr_watch_stop: Stop watching
- pr_watch_status: Check current session
- pr_provide_logs: Provide manual CI logs (CircleCI when not accessible)
- pr_squash_commits: Squash commits since watch started (after CI passes)
- github_get_pr_checks: Get CI status without starting watch

HYBRID FIX STRATEGY:
1. First: Direct Cursor with templated prompt (no LLM)
2. Second: LLM analyzes failure more carefully if still failing
3. Third: Ask user for manual logs or guidance

CIRCLECI SUPPORT:
- CircleCI doesn't expose logs via GitHub API
- System tries to fix based on step/job name
- If doesn't work, asks you to paste CircleCI logs

IMPORTANT:
- Only one PR watched at a time
- Watch sessions auto-expire after 2 hours
- System operates on PR branch - pushes fixes directly
- Always confirm before squashing (force push)
`;



