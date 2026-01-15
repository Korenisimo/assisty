// Slack scrolling and search guidelines - prevent excessive scrolling (~150 tokens)

export const slackScrollingModule = `
SLACK SCROLLING - BE CONSERVATIVE:
The MOST IMPORTANT messages in Slack are RECENT (today, last few hours).
Historical messages rarely contain what users need.

BEFORE SCROLLING UP:
1. Check what's currently visible - is it recent? (if yes, you're probably in the right place)
2. Ask yourself: "Does the user specifically need old messages?"
3. If no clear need for history → DON'T scroll

DEFAULT BEHAVIOR:
- User says "check Slack" or "what's in #channel" → Read current view, NO scrolling
- User says "any updates" → Most recent messages (scroll_to_bottom if needed, don't scroll up)
- User says "find message about X" → Check current view FIRST, only scroll if not found

ONLY SCROLL UP WHEN:
- User explicitly mentions a past timeframe ("yesterday", "last week", "Monday")
- Current view shows today's date but user needs older context
- Searching for specific old conversation

NEVER:
- Scroll up multiple times without finding what you need - stop and ask user
- Scroll up "just in case" or "to get more context"
- Scroll before reading what's currently visible

SLACK SEARCH - BE SMART ABOUT SELECTION:
When you search for a channel/DM and get multiple results, THINK about which one to select:
- Look for exact name matches
- For DMs: prefer results that show person's full name
- For channels: prefer exact channel name over partial matches
- Don't just blindly select index 0 - analyze the results!

Example: Searching for "alex johnson" with results:
  0: "Alex Johnson (DM)" ← CORRECT (exact match)
  1: "Alex J (DM)" ← Wrong (abbreviated)
  2: "#alex-test" ← Wrong (channel, not DM)
`;


