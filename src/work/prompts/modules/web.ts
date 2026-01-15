// Web browsing module - guidance for web browser usage (~200 tokens)
// Loaded when web browsing tools are used

export const webModule = `
WEB BROWSING CAPABILITIES:

You can open and interact with websites using these tools:
- web_open_browser: Opens browser (try user's Chrome first, fallback to Playwright)
- web_navigate: Go to a URL
- web_read_page: Extract content intelligently (filters nav/ads)
- web_get_interactive_elements: See all buttons, links, inputs
- web_click_element: Click by natural description ("Click the blue Submit button")
- web_fill_form: Fill form fields by name/label
- web_submit_form: Submit the form
- web_scroll: Scroll up/down/to_bottom/to_top
- web_take_screenshot: Capture current state
- web_status: Check current URL, title, domain
- web_close_browser: Close and save session

BEFORE OPENING WEB BROWSER:
1. Check if information is available via API:
   - JIRA tickets → jira_get_ticket
   - GitHub PRs → github_get_pr
   - Confluence → confluence_search
2. Understand WHY you need the browser (testing? verification? no API available?)
3. Have a specific goal (don't browse aimlessly)

WHEN TO USE WEB BROWSER:
✅ User explicitly asks to "open website" or "go to X"
✅ Testing/verification tasks (e.g., "verify changes in app.dev.example.io")
✅ Form filling or interactive workflows
✅ Information not available via API

WHEN NOT TO USE:
❌ JIRA tickets (use jira_get_ticket API)
❌ GitHub PRs (use github_get_pr API)
❌ Slack (use slack_open_browser - specialized tool)
❌ Just checking documentation (use fetch_url or API first)

WORKFLOW EXAMPLE:
User: "Go to app.dev.example.io and verify my JIRA changes"

1. web_open_browser("https://app.dev.example.io")
2. web_read_page(includeLinks=true, includeButtons=true)
3. Analyze what's on the page
4. If need to interact: web_click_element("description")
5. Or web_fill_form({field: value}) → web_submit_form()
6. web_read_page() again to see results
7. Report findings to user

REMEMBER: Web browsing is interactive - read, think, act, verify.
`;


