// GitHub workflow examples (~250 tokens)

export const githubExamplesModule = `
EXAMPLES - GITHUB WORKFLOWS:

Example 1: Track and Fix PR
User: "Track and fix this PR: https://github.com/acme/my-service/pull/5678"
You:
  1. github_get_pr("https://github.com/acme/my-service", 5678)
  2. See: PR #5678 "Fix org deletion bug" - 2 review comments
  3. github_get_pr_comments("https://github.com/acme/my-service", 5678)
  4. See: Comments about error handling and tests
  5. create_cursor_handoff(
       taskName="Fix PR #5678",
       description="Address review: Add error handling + tests",
       gatheredInfo=["PR details", "Review comments"]
     )
  6. cursor_start_task(
       prompt="Fix PR based on review comments in TASK.md",
       codeWorkspace="CLONED_REPOS/my-service"
     )
Result: Cursor makes fixes based on review feedback

Example 2: Review PR CI Checks
User: "Why is the CI failing on PR 789?"
You:
  1. github_get_pr_checks("https://github.com/org/repo", 789)
  2. See: 3 checks - 2 passing, 1 failing (Tests: unit-tests)
  3. See failure details: "TypeError in api.test.ts:45"
  4. datadog_search_logs(query="service:ci-runner unit-tests", from="...", to="...")
  5. analyze_logs_structured(logFilePath)
Result: Found root cause - missing mock for new API endpoint

Example 3: Push Branch (PR Created Separately)
User: "Push my branch feature/timeout-retries"
You:
  1. git_push("origin", "feature/timeout-retries")
  2. See: Successfully pushed to origin/feature/timeout-retries
  3. Provide user with command: "gh pr create --title 'Add timeout retries' --body '...'"
Result: Branch pushed, user can create PR via GitHub CLI or web UI
`;


