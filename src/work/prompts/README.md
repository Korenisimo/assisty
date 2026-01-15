# Modular Prompt System

This directory contains the **conditional context loading system** that powers the assistant's prompt management. The system is designed for token efficiency - only loading the context modules needed for each specific request.

## Architecture Overview

```
User Message
     ↓
┌─────────────────────────────────────────────┐
│  3-TIER CONTEXT LOADING                     │
├─────────────────────────────────────────────┤
│  Tier 1: Base Prompt (always ~100 tokens)   │
│  Tier 2: Heuristic Modules (fast regex)     │
│  Tier 3: LLM Classification (if ambiguous)  │
└─────────────────────────────────────────────┘
     ↓
System Prompt = Base + Detected Modules
     ↓
Agent with Tools → Response
```

## How It Works

### Tier 1: Base Prompt (Always Loaded)

**File:** `modules/base.ts`

The base prompt is minimal (~100 tokens) and always included. It contains:
- Identity: "You are a personal work assistant"
- Current date/time
- Character/personality settings (if configured)
- 7 critical rules that apply to all interactions

```typescript
// Example from base.ts
return `You are a personal work assistant...
CRITICAL RULES (always follow):
1. Execute, don't narrate - DO things with tool calls
2. One request = one focus
...`
```

### Tier 2: Heuristic Detection (Fast)

**File:** `heuristics.ts`

Fast regex pattern matching that runs on every message. Detects obvious signals without any LLM call:

```typescript
// Slack signals
/slack\.com/i                    → loads 'slack' module
/\b(DM|direct message)\b/i       → loads 'slack' module

// JIRA signals  
/\b[A-Z]+-\d+\b/                 → loads 'jira' module (PROJ-123)
/atlassian\.net/i                → loads 'jira' module

// GitHub/code signals
/github\.com/i                   → loads 'cursor' module
/(fix|implement|refactor).*code/ → loads 'cursor' module

// Investigation signals
/\b(alert|incident|outage)\b/i   → loads 'investigation' + 'datadog'
```

This catches ~80% of cases instantly without any LLM overhead.

### Tier 3: LLM Classification (When Needed)

**File:** `classifier.ts`

Only runs if heuristics return low confidence. Uses a minimal classifier prompt (~250 tokens) sent to Gemini Flash to determine:

- **Intent**: `greeting | task_query | code_task | investigation | api_query | general`
- **Modules needed**: Array of module names to load
- **Confidence score**: How sure the classification is

Results are cached for 1 minute to avoid redundant LLM calls.

```typescript
// Fast keyword fallback for obvious cases
if (/^(hey|hi|hello)[\s\.,!?]*$/i.test(message)) {
  return { intent: 'greeting', modules: ['greeting'], confidence: 0.95 };
}
```

## Directory Structure

```
prompts/
├── README.md              # This file
├── index.ts               # Main entry - buildModularPrompt(), detectContextTypes()
├── core.ts                # Legacy core prompt (getCorePrompt)
├── classifier.ts          # LLM-based intent classification
├── heuristics.ts          # Fast regex-based module detection
│
├── modules/               # Individual context modules
│   ├── index.ts           # Module exports and types
│   ├── base.ts            # Base prompt (always loaded)
│   ├── greeting.ts        # Greeting responses
│   ├── tasks.ts           # Task management guidance
│   ├── jira.ts            # JIRA API patterns
│   ├── slack.ts           # Slack browser automation
│   ├── files.ts           # File operations
│   ├── web.ts             # Web browsing
│   ├── context-parsing.ts # URL/link parsing
│   ├── efficiency-rules.ts # Token efficiency rules
│   ├── task-decomposition.ts # Complex task breakdown
│   ├── workflow-patterns.ts  # Common workflows
│   │
│   ├── cursor-patterns.ts    # Cursor handoff patterns
│   ├── cursor-recovery.ts    # Cursor error recovery
│   │
│   ├── pr-tracking-core.ts   # PR monitoring basics
│   ├── pr-tracking-examples.ts # PR tracking examples
│   ├── github-examples.ts    # GitHub API examples
│   │
│   └── slack-scrolling.ts    # Slack navigation
│
└── [Domain Contexts]      # Larger domain-specific contexts
    ├── cursor.ts          # Cursor IDE handoff (~600 tokens)
    ├── investigation.ts   # Investigation workflow
    ├── datadog.ts         # Datadog log queries
    ├── infra.ts           # Infrastructure commands
    ├── pdp.ts             # Performance/goals tracking
    ├── pr-tracking.ts     # Full PR tracking context
    ├── task-executor.ts   # Autonomous task execution
    └── linkedin-cv.ts     # LinkedIn/CV operations
```

## Available Modules

| Module | Trigger Keywords | Purpose |
|--------|-----------------|---------|
| `greeting` | "hi", "hey", "hello" | Short greeting response |
| `tasks` | "task", "todo", "reminder" | Task CRUD operations |
| `jira` | "PROJ-123", "ticket", "jira" | JIRA API usage |
| `slack` | "slack", "DM", "channel" | Slack browser automation |
| `cursor` | "cursor", "implement", "code" | Cursor IDE handoff |
| `investigation` | "alert", "incident", "outage" | Investigation workflows |
| `datadog` | "datadog", "logs" | Datadog queries |
| `infra` | "kubectl", "database", "proxy" | Infrastructure commands |
| `pr_tracking` | "watch PR", "CI", "pipeline" | PR monitoring |
| `pdp` | "performance", "achievement" | Goals tracking |
| `context_parsing` | URLs in message | Link/URL handling |
| `efficiency_rules` | Most work requests | Token efficiency |

## Module Loading Flow

In `agent.ts`, modules are loaded incrementally:

```typescript
// Track what's already loaded per conversation
private loadedModules: Set<PromptModule> = new Set();

// On each message:
// 1. Run heuristics
const heuristicResult = getHeuristicModules(userMessage);

// 2. Run classifier if needed
const classification = await classifyIntent(userMessage);

// 3. Merge and deduplicate
const allModules = [...heuristicResult.modules, ...classification.modules];
const newModules = allModules.filter(m => !this.loadedModules.has(m));

// 4. Append only NEW modules to system message
if (newModules.length > 0) {
  await this.updateModulesInSystemMessage(newModules);
}
```

## Example: Message Processing

**User says:** "Check the JIRA ticket PROJ-1234 that Nikki mentioned in Slack"

### Step 1: Heuristics
```
Patterns matched:
- /\b[A-Z]+-\d+\b/ (PROJ-1234) → jira
- /\bslack\b/i                 → slack
Result: ['jira', 'slack'], confidence: 'high'
```

### Step 2: Classification (skipped - high confidence)

### Step 3: System Prompt Built
```
[Base prompt ~100 tokens]

[CONTEXT FOR THIS REQUEST]
[JIRA module ~200 tokens]
  - How to use jira_get_ticket, jira_search, etc.
  - Error handling patterns
  
[Slack module ~800 tokens]
  - Browser automation workflow
  - slack_status → slack_open_browser → slack_read_messages
  - DM capabilities
  - Error handling
```

### Step 4: Agent Executes
Agent now has specific guidance for both JIRA and Slack operations.

## Design Principles

### Token Efficiency
- Base prompt is minimal (~100 tokens)
- Modules only loaded when needed
- Once loaded, modules persist for the conversation
- Avoids loading 5000+ tokens on every message

### Speed
- Heuristics are instant (regex only)
- Classifier results cached for 1 minute
- No LLM call for obvious cases

### Accumulative Loading
- Modules accumulate during a conversation
- If you mention Slack, then JIRA, both stay loaded
- Fresh module set per workstream

### Separation of Concerns
- Each module is self-contained
- Modules can be updated independently
- Easy to add new modules for new capabilities

## Adding a New Module

1. Create the module file in `modules/`:
```typescript
// modules/my-feature.ts
export const myFeatureModule = `
=== MY FEATURE ===
Instructions for using my feature...
`;
```

2. Export from `modules/index.ts`:
```typescript
export { myFeatureModule } from './my-feature.js';
export type PromptModule = ... | 'my_feature';
```

3. Add heuristic patterns in `heuristics.ts`:
```typescript
const myFeaturePatterns = [/\bmy-keyword\b/i];
if (myFeaturePatterns.some(p => p.test(message))) {
  modules.push('my_feature');
}
```

4. Add to classifier prompt in `classifier.ts`

5. Add loading logic in `agent.ts` `updateModulesInSystemMessage()`

## Debugging

Set `DEBUG_MODULES=1` environment variable to see:
- Which modules are being loaded
- Token estimates for system prompt
- Warnings when prompt exceeds 2000 tokens

```bash
DEBUG_MODULES=1 npm run dev
```

Output:
```
[MODULES] Heuristic detected: slack, jira
[MODULES] New modules to load: slack, jira
[MODULES] System prompt: ~1200 tokens (4800 chars)
```
