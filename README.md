# Hacker News CLI with AI Recommendations

A beautiful terminal client for Hacker News with AI-powered recommendations and an intelligent assistant using Gemini.

**Supported Platforms:** Windows 10/11, macOS, Linux

## Features

- 🔥 **Top Commented Posts** - See the most discussed posts from the front page
- 🚀 **New Top Commented** - Discover trending discussions in new posts  
- ⭐ **Best Top Commented** - Browse the best posts sorted by comments
- 🔖 **Save Posts** - Bookmark posts for later
- 🧠 **AI Recommendations** - Get personalized suggestions based on your saved posts
- 🤖 **AI Assistant** - Ask questions about how to use the CLI
- 🔮 **Discovery Mode** - Let AI suggest interesting posts periodically

## Installation

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)

### Windows

1. Open **Windows Terminal** or **PowerShell** (recommended for best experience)
2. Clone and build:

```powershell
# Clone repository
git clone <repo-url>
cd assist

# Install dependencies
npm install

# Build
npm run build

# Install globally (optional)
npm link
```

3. Run with `npm run dev` or `hn` (if globally installed)

### macOS / Linux

```bash
# Clone repository
git clone <repo-url>
cd assist

# Install dependencies
npm install

# Build
npm run build

# Install globally (run from anywhere!)
npm link
```

Now you can use `hn` from anywhere on your computer.

## Setup

Create a `.env` file in the project directory with your Gemini API key:

```
GEMINI_API_KEY=your_api_key_here
```

Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

## Usage

### Basic Commands

```bash
# Show welcome screen
hn

# View top commented posts from front page
hn top

# View top commented from new posts
hn new

# View top commented from best posts  
hn best

# Save a post by ID
hn save 12345678

# View saved posts
hn saved

# Remove a saved post
hn remove 12345678

# Open a post in browser
hn open 12345678
```

### AI Features

```bash
# Ask the AI assistant for help
hn ask "how do I get recommendations?"
hn ask "can I see posts from last month?"
hn ask "what commands are available?"

# Generate embeddings for recommendations
hn embed

# Get AI recommendations
hn recommend
hn rec --source new --number 10

# Enter discovery mode - AI suggests posts periodically
hn discover
hn discover --interval 3  # Suggest every 3 minutes
```

### Discovery Mode

Discovery mode is an interactive experience where the AI:
1. Picks posts based on your interests (if you have saved posts)
2. Summarizes the post and discussion
3. Lets you ask questions about the post
4. Offers to save or open posts
5. Periodically suggests new content

Press `Ctrl+C` to exit discovery mode.

## How Recommendations Work

1. **Save posts** you find interesting using `hn save <id>`
2. **Generate embeddings** with `hn embed` - this creates vector representations of your saved posts using Gemini's text-embedding-004 model
3. **Get recommendations** with `hn recommend` - the system:
   - Fetches current HN posts
   - Embeds each candidate post
   - Finds posts similar to your saved collection using cosine similarity
   - Sends top candidates to Gemini for final ranking and personalized explanations

## Options

| Command | Option | Description |
|---------|--------|-------------|
| `top`, `new`, `best` | `-n, --number <count>` | Number of posts to show (default: 15) |
| `top`, `new`, `best` | `--no-interactive` | Disable interactive prompts |
| `recommend` | `-n, --number <count>` | Number of recommendations (default: 5) |
| `recommend` | `-s, --source <type>` | Source: top, new, or best (default: top) |
| `discover` | `-i, --interval <minutes>` | Minutes between suggestions (default: 5) |

## API Limitations

The Hacker News API doesn't support filtering by date/time period. If you ask the AI assistant about historical posts (e.g., "top posts from last month"), it will explain this limitation and suggest alternatives like the Hacker News Algolia API.

## Work Mode - AI Assistant

Work mode is a conversational AI assistant that can search APIs, execute shell commands, and manage files in your workspace.

### Features

- **Conversational** - Maintain context across messages, ask follow-up questions
- **API Search** - Query JIRA, Confluence, FireHydrant, Datadog (read-only)
- **Shell Commands** - Execute git, file operations, and other commands
- **File Management** - Create directories, read/write files in WORK_DIRS/
- **Cursor Handoff** - Automatically hand off complex codebase tasks to Cursor agent
- **Token Tracking** - See estimated token usage with `/tokens`

### Smart Task Routing

Work Mode is designed to complement Cursor, not replace it. The assistant automatically recognizes when a task requires deep codebase work and creates a handoff:

**Work Mode handles:**
- Web searches and API queries (Confluence, JIRA, Datadog, FireHydrant)
- Initial research and context gathering  
- Creating structured workspaces
- Running shell commands
- Cloning repositories

**Cursor handles (via handoff):**
- Deep codebase search and analysis
- Code changes and implementations
- Complex refactoring
- Understanding code structure

When you ask Work Mode to do something that requires codebase analysis (like "find all project types in the service code"), it will:
1. Do initial research (web search, clone repo, etc.)
2. Create a handoff directory in `WORK_DIRS/cursor_<task>_<date>/`
3. Generate `TASK.md` with clear instructions and gathered context
4. Stop and tell you to open the task in Cursor

This prevents recursion loops and makes better use of each tool's strengths.

### Environment Variables

Add these to your `.env` file:

```bash
# Required for Gemini
GEMINI_API_KEY=your_gemini_key

# JIRA (optional)
JIRA_TOKEN=your_base64_encoded_token
JIRA_BASE_URL=https://your-domain.atlassian.net

# Confluence (optional)
CONFLUENCE_USERNAME=your_email
CONFLUENCE_DOMAIN=your-domain.atlassian.net
CONFLUENCE_API_TOKEN=your_api_token

# FireHydrant (optional)
FIREHYDRANT_API_KEY=your_api_key

# GitHub (optional)
GITHUB_TOKEN=your_github_personal_access_token

# Datadog (optional - requires explicit opt-in)
DD_API_KEY=your_api_key
DD_APP_KEY=your_app_key
DD_SITE=datadoghq.com  # optional, defaults to datadoghq.com
```

### Usage

```bash
# Start work mode (conversational)
hn work

# Enable Datadog search
hn work --datadog

# List previous sessions
hn work-list
```

### In-Session Commands

| Command | Description |
|---------|-------------|
| `/prompt` | Open your `$EDITOR` for multi-line input |
| `/paste` | Paste multi-line text (end with `---END---`) |
| `/reset` | Clear conversation history and start fresh |
| `/tokens` | Show estimated token usage and stats |
| `/datadog` | Toggle Datadog search on/off |
| `/personality` | Change assistant personality (proactive/default/minimal) |
| `/character` | Select or create character personas |
| `/memory` | View and manage user preferences |
| `/exit` | Exit work mode |

### Character Personas

The assistant can create and embody character personas! Simply ask it to create a character and it will:
1. Use web search to research the character's personality
2. Create a detailed persona with traits and catchphrases
3. Save it to your library for future use

**Usage:**
```bash
# Ask the assistant to create a character
You: Add Hermione Granger from Harry Potter as a character

# Or use the /character command to:
# - View built-in characters (Chandler, Dee Reynolds, Jerry Seinfeld, etc.)
# - View custom characters you've created
# - Ask the assistant to create new characters
# - Delete custom characters

# Your chosen character persists between sessions!
```

**Example conversation:**
```
You: Add Sherlock Holmes from the Sherlock Holmes books
Assistant: *researches character* 
          I've created Sherlock Holmes! Use /character to select him.

You: /character
*Selects "🎭 Sherlock Holmes (Sherlock Holmes books)"*

### Example Conversations

**Investigation:**
```
You: Search for JIRA tickets about authentication failures
You: Now search Confluence for runbooks related to these issues
You: What FireHydrant incidents happened this week?
```

**Task Execution:**
```
You: Create a CLONED_REPOS directory in your workspace
You: Clone the acme/my-service repo into CLONED_REPOS
You: List what's in the workspace now
```

**Follow-ups:**
```
You: Find Datadog logs for request ID 019b31db-6abf-72a0-b140-f454be8db2f5
You: That returned nothing. Try searching with different query formats like @http.request_id or @trace_id
```

**JIRA Backlog Work:**
```
You: Get all unassigned tickets from PROJ project
You: Create a work dir for PROJ-1234 and save the ticket details there
You: Now let's talk about each ticket - which ones look interesting?
```

**Multi-line Prompts (use /prompt or /paste):**
```
/paste
Hey buddy, I want you to:
1. Clone the acme/my-service repo into CLONED_REPOS
2. Get unassigned tickets from PROJ project
3. Download each ticket's details into WORK_DIRS/proj-backlog/
---END---
```

### Workspace

All file operations happen in `WORK_DIRS/` in your current directory. The agent can:
- Create subdirectories (CLONED_REPOS/, investigations/, etc.)
- Clone git repositories
- Read and write files
- Execute shell commands (with 2-minute timeout)

**Note:** API calls are READ-ONLY. Shell commands have full workspace access but are sandboxed to WORK_DIRS/.

### Personal Development Plan (PDP) Tracking

Track your Personal Development Plan with Google Docs integration:

```
You: Set up my PDP from this Google Doc: https://docs.google.com/document/d/xxx/edit
You: Sync my PDP to get latest comments
You: What are my current PDP goals?
You: Add a new goal: "Complete AWS certification" in the learning category
You: Update my "leadership" goal to 50% progress
```

**Features:**
- Link your PDP Google Doc for continuous sync
- Automatically capture comments as feedback
- Track goals by category (technical, leadership, communication, collaboration)
- Monitor progress percentage and status

### Achievement Tracking ("Collecting Receipts")

Automatically collect and track your accomplishments:

```
You: Set up achievement tracking with my JIRA username "john.doe"
You: Collect my completed JIRA tickets from the last quarter
You: Collect Confluence pages I've authored
You: Show me my achievements for this quarter
You: Add this RFC as an achievement: https://confluence.example.com/rfc-123
You: Link that achievement to my "technical leadership" goal
You: Export my achievements for my performance review
```

**Features:**
- Auto-collect from JIRA (completed tickets)
- Auto-collect from Confluence (authored pages)
- Auto-collect from Google Docs (owned documents)
- Manually add technical documents, RFCs, presentations
- Link achievements to PDP goals
- Export summaries by period (week/month/quarter/year)
- Categories: delivery, documentation, collaboration, leadership, technical, incident, learning

**Environment Variables for PDP & Achievements:**
```bash
# Google Docs (for PDP sync and document collection)
GOOGLE_ACCESS_TOKEN=your_oauth_token  # For private docs
GOOGLE_API_KEY=your_api_key           # For public docs only
```

## Data Storage

Data is stored in platform-appropriate locations:

| Data | Windows | macOS | Linux |
|------|---------|-------|-------|
| Saved posts | `%APPDATA%\hn-cli\` | `~/Library/Application Support/hn-cli/` | `~/.config/hn-cli/` |
| Config & preferences | `%APPDATA%\hn-work-assistant\` | `~/Library/Application Support/hn-work-assistant/` | `~/.config/hn-work-assistant/` |
| Work sessions | `./WORK_DIRS/` | `./WORK_DIRS/` | `./WORK_DIRS/` |

All data persists across sessions and is accessible from any directory.

## Platform-Specific Features

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| TUI Interface | ✓ | ✓ | ✓ |
| API Integrations | ✓ | ✓ | ✓ |
| Shell Commands | ✓ | ✓ | ✓ |
| Cursor Integration | ✓ | ✓ | ✓ |
| Clipboard | ✓ | ✓ | ✓* |
| Voice Commands (TTS/STT) | - | ✓ | - |

*Linux clipboard requires `xclip` to be installed.

### Windows Notes

- **Use Windows Terminal** for best experience (full ANSI color and Unicode support)
- PowerShell is auto-detected as the preferred shell
- Voice features (text-to-speech, speech-to-text) are not yet available on Windows
- Cursor CLI is detected in standard Windows installation paths

### macOS Notes

- Full voice feature support with macOS `say` command and Whisper
- Cursor sandbox escape works automatically when running inside Cursor IDE

## Troubleshooting

### Windows

**TUI doesn't render correctly:**
- Use Windows Terminal instead of cmd.exe
- Update to the latest Windows Terminal version

**Cursor not detected:**
- Ensure Cursor is installed
- Check if cursor.exe is in one of these locations:
  - `%LOCALAPPDATA%\Programs\Cursor\`
  - `C:\Program Files\Cursor\`

**Clipboard doesn't work:**
- Ensure PowerShell is available
- Check Windows clipboard permissions

### macOS

**Voice features not working:**
- Install sox: `brew install sox`
- Install whisper-cpp: `brew install whisper-cpp`
- Download Whisper model (see instructions when running voice command)

For detailed Windows setup, see [docs/WINDOWS.md](docs/WINDOWS.md).

## License

MIT
