// Files module - file operations and workspace (~100 tokens)
// Loaded when user mentions files, directories, or local operations

export const filesModule = `
FILES: shell_command, create_directory, write_file, read_file, list_directory

GIT: git_push, git_commit_all, git_status (use these, not shell git)

WORKSPACE: WORK_DIRS/ for all file operations

COMPOUND TOOLS (prefer):
- clone_repo: Clone to CLONED_REPOS/
- list_cloned_repos: Check before searching externally!
- checkout_branch: Multi-process safe
- save_jira_ticket: Fetch and save to directory
- start_investigation: Create workspace

DIRECT PATHING: Given specific path → go DIRECTLY there, no parent listing
`;

