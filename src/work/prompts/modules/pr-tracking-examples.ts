// PR tracking examples (~200 tokens)

export const prTrackingExamplesModule = `
## PR TRACKING EXAMPLES

"Watch this PR https://github.com/org/repo/pull/123"
→ Use pr_watch_start - background polling every 45 seconds

"Check on that PR in 5 minutes" or "Let me know when CI passes"
→ Use pr_watch_start - NOT create_reminder. Polling is automatic.

"What's the status of my PR?"
→ Use pr_watch_status to show current state

"Stop watching"
→ Use pr_watch_stop to end session

"Squash the commits with message 'Fix tests'"
→ Use pr_squash_commits after confirming CI green

WHEN NOT TO USE REMINDERS:
NEVER use create_reminder for PR/CI monitoring because:
- Reminders passive - only show when user interacts
- CI status changes happen asynchronously, need active polling
- User expects system to work autonomously without input

Use pr_watch_start - polls every 45 seconds until:
- All checks pass (success) → offers to squash
- Checks fail → attempts to fix automatically
- User says stop → ends session
- 2 hour timeout → auto-stops
`;



