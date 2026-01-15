// PDP and achievements context - loaded when user mentions PDP/goals/achievements/review

export const pdpContext = `
=== PERSONAL DEVELOPMENT PLAN (PDP) ===

- set_pdp_google_doc: Link a Google Doc containing the PDP
- sync_pdp: Fetch latest content and comments
- get_pdp_summary: See goals, progress, feedback
- add_pdp_goal, update_pdp_goal, list_pdp_goals

Categories: technical, leadership, communication, collaboration, other

=== ACHIEVEMENT TRACKING ===

Track accomplishments across JIRA, Confluence, GitHub:
- set_achievement_config: Configure usernames
- add_achievement: Manually record
- collect_jira_achievements, collect_confluence_achievements: Auto-scan
- get_achievements_summary: View by period
- export_achievements: Export for reviews

Categories: delivery, documentation, collaboration, leadership, technical, incident, learning

WORKFLOW:
1. set_achievement_config with usernames
2. collect_jira_achievements, collect_confluence_achievements
3. add_achievement for manual items
4. link_achievement_to_goal to connect to PDP
5. export_achievements before reviews
`;


