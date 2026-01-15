# Windows Installation and Usage Guide

This guide covers everything you need to know about running Assist CLI on Windows.

## System Requirements

- **Windows 10** version 1903+ or **Windows 11**
- **Node.js 18** or later
- **Git** (for cloning repositories and git operations)
- **Windows Terminal** (recommended) or **PowerShell**

## Installation

### Step 1: Install Prerequisites

1. **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
2. **Git**: Download from [git-scm.com](https://git-scm.com/)
3. **Windows Terminal** (optional but recommended): Install from [Microsoft Store](https://aka.ms/terminal)

### Step 2: Clone and Build

Open Windows Terminal or PowerShell and run:

```powershell
# Clone the repository
git clone <repo-url>
cd assist

# Install dependencies
npm install

# Build
npm run build
```

### Step 3: Setup Environment

Create a `.env` file in the project directory:

```
GEMINI_API_KEY=your_api_key_here
```

Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### Step 4: Run

```powershell
# Start the TUI
npm run dev

# Or if globally installed with `npm link`:
hn work
```

## Terminal Recommendations

For the best experience, use **Windows Terminal**:

| Terminal | ANSI Colors | Unicode | Recommended |
|----------|-------------|---------|-------------|
| Windows Terminal | Full | Full | Yes |
| PowerShell 7 (pwsh) | Full | Full | Yes |
| Windows PowerShell 5.1 | Good | Good | Yes |
| cmd.exe | Limited | Limited | No |
| VS Code Terminal | Full | Full | Yes |

### Why Windows Terminal?

- Full ANSI escape code support (colors, formatting)
- Unicode box-drawing characters display correctly
- Multiple tabs
- Better performance
- Modern design

**Download:** [Microsoft Store](https://aka.ms/terminal) or [GitHub](https://github.com/microsoft/terminal)

## Features Available on Windows

### Fully Supported

- **TUI Interface** - Full k9s-style interface with panels, lists, and conversation view
- **API Integrations** - JIRA, Confluence, GitHub, Slack, Datadog, FireHydrant
- **Shell Commands** - Execute commands via PowerShell or cmd
- **Cursor Integration** - Hand off tasks to Cursor IDE
- **File Operations** - Create directories, read/write files
- **Clipboard** - Copy/paste using PowerShell clipboard commands
- **Browser Opening** - Open URLs in your default browser
- **Character Personas** - Create and use AI character personas
- **Achievement Tracking** - Track accomplishments from various sources
- **PDP Management** - Personal Development Plan tracking

### Not Yet Available on Windows

- **Voice Commands** - Speech-to-text (STT) and text-to-speech (TTS)
  - These features use macOS-specific tools (say, sox, whisper-cpp)
  - The `[` (record) and `]` (TTS toggle) keybindings are disabled on Windows
  - All other features work normally

## Configuration Locations

Assist CLI stores configuration in platform-appropriate locations:

| Data | Location |
|------|----------|
| App config | `%APPDATA%\hn-work-assistant\` |
| Cursor config | `%APPDATA%\hn-cli\cursor-config.json` |
| Saved posts | `%APPDATA%\hn-cli\saved-posts.json` |
| Work sessions | `.\WORK_DIRS\` (in current directory) |

To find your `%APPDATA%` folder, open PowerShell and run:
```powershell
echo $env:APPDATA
```

## Keyboard Shortcuts

All keyboard shortcuts work on Windows except voice-related ones:

| Shortcut | Action | Windows |
|----------|--------|---------|
| `Tab` / `Shift+Tab` | Switch panels | Yes |
| Arrow keys | Navigate lists | Yes |
| `Enter` | Select/Open | Yes |
| `Escape` | Cancel/Close | Yes |
| `q` | Quit | Yes |
| `?` | Show help | Yes |
| `Ctrl+C` | Interrupt agent | Yes |
| `Ctrl+L` | Show Cursor logs | Yes |
| `Shift+T` | Show trash bin | Yes |
| `[` | Toggle recording | No (macOS only) |
| `]` | Toggle TTS | No (macOS only) |

## Cursor Integration

Cursor IDE integration works on Windows. The CLI automatically detects Cursor in these locations:

1. `cursor` or `cursor-agent` in PATH
2. `%LOCALAPPDATA%\Programs\Cursor\resources\app\bin\cursor.cmd`
3. `%LOCALAPPDATA%\Programs\Cursor\Cursor.exe`
4. `C:\Program Files\Cursor\Cursor.exe`

### If Cursor is not detected:

1. Ensure Cursor is installed
2. Check if the cursor command is available:
   ```powershell
   where cursor
   ```
3. If not in PATH, the CLI will check standard installation directories

## Troubleshooting

### TUI looks garbled or has display issues

**Problem:** Box characters don't display correctly, or colors are wrong.

**Solutions:**
1. **Use Windows Terminal** - It has the best ANSI and Unicode support
2. **Check terminal settings** - Ensure UTF-8 encoding is enabled
3. **Update Windows Terminal** - Get the latest version from Microsoft Store

### Clipboard copy/paste not working

**Problem:** `/copy` command fails or clipboard is empty.

**Solutions:**
1. **Check PowerShell access** - The clipboard uses PowerShell commands
   ```powershell
   powershell -Command "Set-Clipboard -Value 'test'"
   powershell -Command "Get-Clipboard"
   ```
2. **Check permissions** - Ensure your user has clipboard access

### Shell commands fail

**Problem:** Git or other shell commands don't work.

**Solutions:**
1. **Check command availability:**
   ```powershell
   where git
   where node
   ```
2. **PowerShell execution policy** - May need to allow script execution:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### "Voice features not available" message

**Expected behavior** on Windows. Voice features (TTS/STT) are macOS-only for now. All other features work normally.

### Cursor handoff not working

**Problem:** Cursor doesn't open when handing off tasks.

**Solutions:**
1. **Check Cursor installation:**
   ```powershell
   # Check if cursor is in PATH
   where cursor
   
   # Or check common installation locations
   Test-Path "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe"
   ```
2. **Ensure Cursor CLI is enabled** - In Cursor, go to Settings > Install 'cursor' command

### Build errors

**Problem:** `npm run build` fails.

**Solutions:**
1. **Check Node.js version:**
   ```powershell
   node --version  # Should be 18+
   ```
2. **Clear npm cache and reinstall:**
   ```powershell
   npm cache clean --force
   Remove-Item -Recurse -Force node_modules
   Remove-Item package-lock.json
   npm install
   ```

## Performance Notes

- The CLI performs well on Windows with performance comparable to macOS
- TUI startup time: ~1-2 seconds
- API response times depend on network latency, not platform

## Known Limitations

1. **Voice features** - Not available (macOS-only for now)
2. **Some terminal emulators** - cmd.exe has limited ANSI support; use Windows Terminal or PowerShell instead
3. **Path lengths** - Very long paths may cause issues on Windows; keep project paths reasonable

## Getting Help

If you encounter issues not covered here:

1. Check the main [README.md](../README.md)
2. Run with debug output: `DEBUG=* npm run dev`
3. Check the [issues page](https://github.com/your-repo/issues) for known problems

## Appendix: Environment Variables

All environment variables work the same on Windows:

```powershell
# Set in .env file or PowerShell session
$env:GEMINI_API_KEY = "your_key"
$env:JIRA_TOKEN = "your_token"
# ... etc
```

Or create a `.env` file in the project root (recommended).
