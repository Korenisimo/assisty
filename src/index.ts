#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import chalk from 'chalk';

// Load .env from the CLI installation directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  join(__dirname, '../.env'),           // When running from dist/
  join(__dirname, '../../.env'),        // When running from src/
  join(process.cwd(), '.env'),          // Current working directory
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}
import { fetchTopCommentedStories, fetchItem, getHNUrl } from './api/hackernews.js';
import { getSavedPosts, savePost, removePost, skipPost, getSkippedPostIds, getTemperature, setTemperature } from './storage/posts.js';
import { embedSavedPosts, getGeminiRecommendations, hasEmbeddedPosts } from './ai/gemini.js';
import { askAssistant, pickPostForUser, continueExploration, generatePostSummary } from './ai/assistant.js';
import {
  displayPostList,
  displaySavedPostList,
  displayRecommendations,
  displaySuccess,
  displayError,
  displayInfo,
  displayWelcome,
  displayDiscoveryPost,
  displayAssistantResponse,
  displayPostSummary,
} from './ui/display.js';
import { renderMarkdown } from './ui/markdown.js';
import { HNStory, SavedPost } from './types.js';
import {
  WorkInput,
  runWorkAgent,
  WorkAgentSession,
  getWorkspace,
  createWorkSession,
  saveResults,
  listWorkSessions,
  isJiraConfigured,
  getJiraConfigStatus,
  isConfluenceConfigured,
  isFireHydrantConfigured,
  isDatadogConfigured,
  isGitHubConfigured,
  getGitHubConfigStatus,
  PersonalityType,
  CharacterType,
  // Memory system
  getMemories,
  getPendingMemories,
  approveMemory,
  rejectMemory,
  deleteMemory,
  // Character system
  getCustomCharacters,
  getCharacterById,
  deleteCharacter as deleteCustomCharacter,
  // Session preferences
  getSessionPreferences,
  setPersonalityPreference,
  setCharacterPreference,
  setDatadogPreference,
  // Checkpoint system
  Checkpoint,
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  deleteCheckpoint,
  deserializeMessages,
} from './work/index.js';
import { runWorkTUI } from './work/tui/index.js';
import { openEditorForPrompt } from './work/tools/prompt.js';

const program = new Command();

program
  .name('hn')
  .description('Hacker News CLI with AI-powered recommendations')
  .version('1.0.0');

// Top commented posts from front page
program
  .command('top')
  .description('Show top commented posts from the front page')
  .option('-n, --number <count>', 'Number of posts to show', '15')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    const spinner = ora('Fetching top commented posts...').start();
    try {
      const stories = await fetchTopCommentedStories('top', parseInt(options.number));
      const saved = await getSavedPosts();
      spinner.stop();
      displayPostList(stories, saved, '🔥 Top Commented (Front Page)');
      if (options.interactive !== false) {
        await promptSavePost(stories);
      }
    } catch (error) {
      spinner.fail('Failed to fetch posts');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Top commented from new posts
program
  .command('new')
  .description('Show top commented posts from new stories')
  .option('-n, --number <count>', 'Number of posts to show', '15')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    const spinner = ora('Fetching new top commented posts...').start();
    try {
      const stories = await fetchTopCommentedStories('new', parseInt(options.number));
      const saved = await getSavedPosts();
      spinner.stop();
      displayPostList(stories, saved, '🚀 Top Commented (New)');
      if (options.interactive !== false) {
        await promptSavePost(stories);
      }
    } catch (error) {
      spinner.fail('Failed to fetch posts');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Top commented from best posts
program
  .command('best')
  .description('Show top commented posts from best stories')
  .option('-n, --number <count>', 'Number of posts to show', '15')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    const spinner = ora('Fetching best top commented posts...').start();
    try {
      const stories = await fetchTopCommentedStories('best', parseInt(options.number));
      const saved = await getSavedPosts();
      spinner.stop();
      displayPostList(stories, saved, '⭐ Top Commented (Best)');
      if (options.interactive !== false) {
        await promptSavePost(stories);
      }
    } catch (error) {
      spinner.fail('Failed to fetch posts');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// View saved posts
program
  .command('saved')
  .description('View your saved posts')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    try {
      const saved = await getSavedPosts();
      displaySavedPostList(saved);
      if (saved.length > 0 && options.interactive !== false) {
        await promptSavedPostAction(saved);
      }
    } catch (error) {
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Save a post by ID
program
  .command('save <id>')
  .description('Save a post by its Hacker News ID')
  .action(async (id: string) => {
    const spinner = ora('Fetching post...').start();
    try {
      const item = await fetchItem(parseInt(id));
      if (!item || item.type !== 'story') {
        spinner.stop();
        displayError('Post not found or not a story');
        return;
      }
      
      const saved = await savePost(item as HNStory);
      spinner.stop();
      
      if (saved) {
        displaySuccess(`Saved: "${item.title}"`);
        displayInfo(`Run "hn embed" to update embeddings for recommendations`);
      } else {
        displayInfo('Post already saved');
      }
    } catch (error) {
      spinner.fail('Failed to save post');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Remove a saved post
program
  .command('remove <id>')
  .description('Remove a saved post by its ID')
  .action(async (id: string) => {
    try {
      const removed = await removePost(parseInt(id));
      if (removed) {
        displaySuccess('Post removed from saved');
      } else {
        displayError('Post not found in saved posts');
      }
    } catch (error) {
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Clear all saved posts
program
  .command('clear')
  .description('Clear all saved posts')
  .action(async () => {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to clear all saved posts?',
        default: false,
      },
    ]);
    
    if (confirm) {
      try {
        const saved = await getSavedPosts();
        for (const post of saved) {
          await removePost(post.id);
        }
        displaySuccess(`Cleared ${saved.length} saved post(s)`);
        displayInfo('Recommendations will now be based on trending posts only');
      } catch (error) {
        displayError(error instanceof Error ? error.message : 'Unknown error');
      }
    } else {
      displayInfo('Cancelled');
    }
  });

// Skip a post for 10 days
program
  .command('skip <id>')
  .description('Skip a post - hide it from suggestions for 10 days')
  .option('-d, --days <number>', 'Number of days to skip (default: 10)', '10')
  .action(async (id: string, options) => {
    try {
      const item = await fetchItem(parseInt(id));
      if (!item || item.type !== 'story') {
        displayError('Post not found or not a story');
        return;
      }
      
      await skipPost(parseInt(id), parseInt(options.days));
      displaySuccess(`Skipping "${item.title}" for ${options.days} days`);
    } catch (error) {
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Set temperature
program
  .command('temperature')
  .alias('temp')
  .description('View or set LLM temperature (0.0-2.0, default: 0.7)')
  .option('-s, --set <value>', 'Set temperature value')
  .action(async (options) => {
    try {
      if (options.set !== undefined) {
        const temp = parseFloat(options.set);
        if (isNaN(temp) || temp < 0 || temp > 2) {
          displayError('Temperature must be between 0.0 and 2.0');
          return;
        }
        await setTemperature(temp);
        displaySuccess(`Temperature set to ${temp}`);
        displayInfo('Lower (0.0-0.5): More focused, deterministic\nHigher (1.0-2.0): More creative, diverse');
      } else {
        const temp = await getTemperature();
        displayInfo(`Current temperature: ${temp}`);
        displayInfo('Use "hn temperature --set <value>" to change');
        displayInfo('Lower (0.0-0.5): More focused, deterministic\nHigher (1.0-2.0): More creative, diverse');
      }
    } catch (error) {
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Embed saved posts
program
  .command('embed')
  .description('Generate embeddings for saved posts (required for recommendations)')
  .action(async () => {
    const spinner = ora('Embedding saved posts with Gemini...').start();
    try {
      const count = await embedSavedPosts();
      spinner.stop();
      if (count > 0) {
        displaySuccess(`Embedded ${count} new post(s)`);
      } else {
        displayInfo('All posts already embedded');
      }
    } catch (error) {
      spinner.fail('Failed to embed posts');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Get AI recommendations
program
  .command('recommend')
  .alias('rec')
  .description('Get AI-powered post recommendations based on your saved posts')
  .option('-n, --number <count>', 'Number of recommendations', '5')
  .option('-s, --source <type>', 'Source for candidates (top, new, best)', 'top')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options) => {
    try {
      // Check if we have embedded posts
      const hasEmbedded = await hasEmbeddedPosts();
      if (!hasEmbedded) {
        displayError('No embedded posts found. Run "hn embed" first.');
        displayInfo('Tip: Save some posts with "hn save <id>" then run "hn embed"');
        return;
      }
      
      const spinner = ora('Fetching candidate posts...').start();
      const source = options.source as 'top' | 'new' | 'best';
      const candidates = await fetchTopCommentedStories(source, 50);
      
      spinner.text = 'Generating AI recommendations...';
      const recommendations = await getGeminiRecommendations(candidates, parseInt(options.number));
      spinner.stop();
      
      displayRecommendations(recommendations);
      
      if (recommendations.length > 0 && options.interactive !== false) {
        await promptSavePost(recommendations.map(r => r.story));
      }
    } catch (error) {
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Open a post in browser
program
  .command('open <id>')
  .description('Open a post in your browser')
  .action(async (id: string) => {
    const url = getHNUrl(parseInt(id));
    displayInfo(`Opening: ${url}`);
    
    // Dynamic import for cross-platform open
    const { default: open } = await import('open');
    await open(url);
  });

// AI Assistant for help
program
  .command('ask <question...>')
  .description('Ask the AI assistant for help with commands')
  .action(async (questionParts: string[]) => {
    const question = questionParts.join(' ');
    const spinner = ora('Thinking...').start();
    try {
      const response = await askAssistant(question);
      spinner.stop();
      displayAssistantResponse(response);
    } catch (error) {
      spinner.fail('Failed to get response');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Interactive Discovery Mode
program
  .command('discover')
  .description('Enter interactive discovery mode - AI will suggest posts for you')
  .option('-i, --interval <minutes>', 'Minutes between suggestions', '5')
  .action(async (options) => {
    await runDiscoveryMode(parseInt(options.interval));
  });

// Discovery mode implementation
async function runDiscoveryMode(intervalMinutes: number): Promise<void> {
  console.clear();
  displayDiscoveryWelcome();
  
  let running = true;
  let currentStory: HNStory | null = null;
  const recentlySuggested: number[] = []; // Track last 10 suggested posts to avoid duplicates
  
  const suggestPost = async (preferDifferent: boolean = false) => {
    if (!running) return;
    
    const spinner = ora(preferDifferent ? 'Finding something really different...' : 'Finding something interesting for you...').start();
    try {
      const result = await pickPostForUser(recentlySuggested, preferDifferent);
      spinner.stop();
      
      if (result) {
        currentStory = result.story;
        
        // Track this post to avoid suggesting it again soon
        recentlySuggested.push(result.story.id);
        // Keep only last 10
        if (recentlySuggested.length > 10) {
          recentlySuggested.shift();
        }
        
        displayDiscoveryPost(result.story, result.summary, result.reason);
        await handleDiscoveryInteraction(result.story, recentlySuggested);
      }
    } catch (error) {
      spinner.stop();
      displayError(error instanceof Error ? error.message : 'Failed to find posts');
    }
  };
  
  // Initial suggestion
  await suggestPost();
  
  // Set up interval for periodic suggestions
  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      return;
    }
    
    const { wantMore } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'wantMore',
        message: '🔔 Want to see something interesting?',
        default: true,
      },
    ]);
    
    if (wantMore) {
      await suggestPost(false);
    }
  }, intervalMinutes * 60 * 1000);
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    running = false;
    clearInterval(interval);
    console.log('\n');
    displayInfo('Discovery mode ended. Happy reading! 📚');
    process.exit(0);
  });
}

async function handleDiscoveryInteraction(story: HNStory, recentlySuggested: number[]): Promise<void> {
  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '💬 Ask about this post', value: 'ask' },
          { name: '🔖 Save for later', value: 'save' },
          { name: '🌐 Open in browser', value: 'open' },
          { name: '🚫 Skip this post (hide for 10 days)', value: 'skip' },
          { name: '➡️  Show me another post', value: 'next' },
          { name: '🎲 Show me something REALLY different', value: 'different' },
          { name: '⏸️  Wait for next suggestion', value: 'wait' },
          { name: '🚪 Exit discovery mode', value: 'exit' },
        ],
      },
    ]);
    
    switch (action) {
      case 'ask': {
        const { question } = await inquirer.prompt([
          {
            type: 'input',
            name: 'question',
            message: 'What would you like to know?',
          },
        ]);
        
        if (question.trim()) {
          const spinner = ora('Analyzing post and comments...').start();
          try {
            const response = await continueExploration(story, question);
            spinner.stop();
            displayAssistantResponse(response);
          } catch (error) {
            spinner.stop();
            displayError('Failed to analyze post');
          }
        }
        break;
      }
      
      case 'save': {
        const saved = await savePost(story);
        if (saved) {
          displaySuccess(`Saved: "${story.title}"`);
          displayInfo('Run "hn embed" later to update recommendations');
        } else {
          displayInfo('Already saved');
        }
        break;
      }
      
      case 'open': {
        const url = getHNUrl(story.id);
        displayInfo(`Opening: ${url}`);
        const { default: open } = await import('open');
        await open(url);
        break;
      }
      
      case 'skip': {
        await skipPost(story.id, 10);
        displaySuccess(`Skipping "${story.title}" for 10 days`);
        displayInfo('Finding another post...');
        // Continue to next post
        const spinner = ora('Finding something else...').start();
        try {
          const result = await pickPostForUser(recentlySuggested);
          spinner.stop();
          if (result) {
            recentlySuggested.push(result.story.id);
            if (recentlySuggested.length > 10) {
              recentlySuggested.shift();
            }
            displayDiscoveryPost(result.story, result.summary, result.reason);
            return handleDiscoveryInteraction(result.story, recentlySuggested);
          }
        } catch {
          spinner.stop();
          displayError('Failed to find more posts');
        }
        break;
      }
      
      case 'next': {
        const spinner = ora('Finding something else...').start();
        try {
          const result = await pickPostForUser(recentlySuggested);
          spinner.stop();
          if (result) {
            // Track this post
            recentlySuggested.push(result.story.id);
            if (recentlySuggested.length > 10) {
              recentlySuggested.shift();
            }
            
            displayDiscoveryPost(result.story, result.summary, result.reason);
            return handleDiscoveryInteraction(result.story, recentlySuggested);
          }
        } catch {
          spinner.stop();
          displayError('Failed to find more posts');
        }
        break;
      }
      
      case 'different': {
        const spinner = ora('Finding something really different...').start();
        try {
          const result = await pickPostForUser(recentlySuggested, true);
          spinner.stop();
          if (result) {
            recentlySuggested.push(result.story.id);
            if (recentlySuggested.length > 10) {
              recentlySuggested.shift();
            }
            displayDiscoveryPost(result.story, result.summary, result.reason);
            return handleDiscoveryInteraction(result.story, recentlySuggested);
          }
        } catch {
          spinner.stop();
          displayError('Failed to find different posts');
        }
        break;
      }
      
      case 'wait':
        displayInfo('Waiting for next suggestion... (Ctrl+C to exit)');
        return;
      
      case 'exit':
        displayInfo('Exiting discovery mode. Happy reading! 📚');
        process.exit(0);
    }
  }
}

function displayDiscoveryWelcome(): void {
  console.log();
  console.log(chalk.hex('#88C0D0').bold('  ╭─────────────────────────────────────────────────────╮'));
  console.log(chalk.hex('#88C0D0').bold('  │') + chalk.hex('#ECEFF4').bold('          🔮 Discovery Mode                       ') + chalk.hex('#88C0D0').bold('│'));
  console.log(chalk.hex('#88C0D0').bold('  ╰─────────────────────────────────────────────────────╯'));
  console.log();
  console.log(chalk.hex('#4C566A')('  Sit back and relax. I\'ll find interesting posts for you.'));
  console.log(chalk.hex('#4C566A')('  Press Ctrl+C anytime to exit.'));
  console.log();
}

// Interactive saved post selection
async function promptSavedPostAction(savedPosts: SavedPost[]): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📝 View a post summary', value: 'view' },
        { name: '🌐 Open a post', value: 'open' },
        { name: '🗑️  Remove a post', value: 'remove' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);
  
  if (action === 'exit') return;
  
  const choices = savedPosts.map((post, i) => ({
    name: `${i + 1}. ${post.title.substring(0, 60)}${post.title.length > 60 ? '...' : ''}`,
    value: post,
  }));
  
  const { post } = await inquirer.prompt([
    {
      type: 'list',
      name: 'post',
      message: `Select a post to ${action === 'view' ? 'view' : action === 'open' ? 'open' : 'remove'}:`,
      choices,
      pageSize: 15,
    },
  ]);
  
  if (action === 'view') {
    const spinner = ora('Fetching post details...').start();
    try {
      const story = await fetchItem(post.id);
      if (!story || story.type !== 'story') {
        spinner.stop();
        displayError('Post not found or not a story');
        return;
      }
      
      spinner.text = 'Generating summary...';
      const summary = await generatePostSummary(story as HNStory);
      spinner.stop();
      displayPostSummary(story as HNStory, summary);
      
      // Ask what to do next
      await promptSavedPostNextAction(story as HNStory, savedPosts);
    } catch (error) {
      spinner.fail('Failed to fetch post');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  } else if (action === 'open') {
    const url = getHNUrl(post.id);
    displayInfo(`Opening: ${url}`);
    const { default: open } = await import('open');
    await open(url);
  } else if (action === 'remove') {
    const removed = await removePost(post.id);
    if (removed) {
      displaySuccess(`Removed: "${post.title}"`);
      displayInfo('Post removed from saved');
    } else {
      displayError('Failed to remove post');
    }
  }
}

// Follow-up actions after viewing a saved post
async function promptSavedPostNextAction(story: HNStory, savedPosts: SavedPost[]): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What next?',
      choices: [
        { name: '🌐 Open in browser', value: 'open' },
        { name: '🗑️  Remove from saved', value: 'remove' },
        { name: '📝 View another saved post', value: 'another' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);
  
  switch (action) {
    case 'open': {
      const url = getHNUrl(story.id);
      displayInfo(`Opening: ${url}`);
      const { default: open } = await import('open');
      await open(url);
      break;
    }
    case 'remove': {
      const removed = await removePost(story.id);
      if (removed) {
        displaySuccess(`Removed: "${story.title}"`);
        displayInfo('Post removed from saved');
      } else {
        displayError('Failed to remove post');
      }
      break;
    }
    case 'another':
      await promptSavedPostAction(savedPosts);
      break;
    case 'exit':
      return;
  }
}

// Interactive save prompt
async function promptSavePost(stories: HNStory[]): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📝 Summarize a post', value: 'summarize' },
        { name: '🔖 Save a post', value: 'save' },
        { name: '🌐 Open a post', value: 'open' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);
  
  if (action === 'exit') return;
  
  const choices = stories.map((story, i) => ({
    name: `${i + 1}. ${story.title.substring(0, 60)}${story.title.length > 60 ? '...' : ''}`,
    value: story,
  }));
  
  const { post } = await inquirer.prompt([
    {
      type: 'list',
      name: 'post',
      message: `Select a post to ${action}:`,
      choices,
      pageSize: 15,
    },
  ]);
  
  if (action === 'summarize') {
    const spinner = ora('Summarizing post and comments...').start();
    try {
      const summary = await generatePostSummary(post);
      spinner.stop();
      displayPostSummary(post, summary);
      // After summarizing, ask what to do next
      await promptPostAction(post, stories);
    } catch (error) {
      spinner.fail('Failed to summarize');
      displayError(error instanceof Error ? error.message : 'Unknown error');
    }
  } else if (action === 'save') {
    const saved = await savePost(post);
    if (saved) {
      displaySuccess(`Saved: "${post.title}"`);
      displayInfo('Run "hn embed" to update embeddings');
    } else {
      displayInfo('Post already saved');
    }
  } else if (action === 'open') {
    const url = getHNUrl(post.id);
    displayInfo(`Opening: ${url}`);
    const { default: open } = await import('open');
    await open(url);
  }
}

// Follow-up actions after summarizing
async function promptPostAction(post: HNStory, allStories: HNStory[]): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What next?',
      choices: [
        { name: '🔖 Save this post', value: 'save' },
        { name: '🌐 Open in browser', value: 'open' },
        { name: '📝 Summarize another', value: 'another' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);
  
  switch (action) {
    case 'save': {
      const saved = await savePost(post);
      if (saved) {
        displaySuccess(`Saved: "${post.title}"`);
        displayInfo('Run "hn embed" to update embeddings');
      } else {
        displayInfo('Already saved');
      }
      break;
    }
    case 'open': {
      const url = getHNUrl(post.id);
      displayInfo(`Opening: ${url}`);
      const { default: open } = await import('open');
      await open(url);
      break;
    }
    case 'another':
      await promptSavePost(allStories);
      break;
    case 'exit':
      return;
  }
}

// Valid character types
const VALID_CHARACTERS: CharacterType[] = [
  'none', 'dee', 'dennis', 'mac', 'charlie', 'frank',  // Always Sunny
  'jerry', 'george', 'elaine', 'kramer',               // Seinfeld
  'chandler', 'joey', 'ross', 'monica', 'rachel', 'phoebe',  // Friends
  'dwight', 'ron', 'archer', 'custom'                  // Other
];

// Work mode - k9s-style TUI for investigations and tasks
program
  .command('work')
  .description('Enter work mode - k9s-style TUI for managing multiple workstreams')
  .action(async () => {
    await runWorkTUI();
  });

// List work sessions
program
  .command('work-list')
  .description('List previous work sessions')
  .action(async () => {
    const sessions = await listWorkSessions();
    if (sessions.length === 0) {
      displayInfo('No work sessions found. Run "hn work" to start one.');
      return;
    }
    console.log();
    console.log(chalk.hex('#88C0D0').bold('  📁 Work Sessions'));
    console.log();
    for (const session of sessions.slice(0, 20)) {
      console.log(chalk.hex('#A3BE8C')(`  • ${session}`));
    }
    console.log();
    displayInfo(`Sessions stored in: ${process.cwd()}/WORK_DIRS/`);
  });

// Character display names for pretty printing
const CHARACTER_DISPLAY_NAMES: Record<CharacterType, string> = {
  none: 'None',
  dee: 'Dee Reynolds (Always Sunny)',
  dennis: 'Dennis Reynolds (Always Sunny)',
  mac: 'Mac McDonald (Always Sunny)',
  charlie: 'Charlie Kelly (Always Sunny)',
  frank: 'Frank Reynolds (Always Sunny)',
  jerry: 'Jerry Seinfeld (Seinfeld)',
  george: 'George Costanza (Seinfeld)',
  elaine: 'Elaine Benes (Seinfeld)',
  kramer: 'Cosmo Kramer (Seinfeld)',
  chandler: 'Chandler Bing (Friends)',
  joey: 'Joey Tribbiani (Friends)',
  ross: 'Ross Geller (Friends)',
  monica: 'Monica Geller (Friends)',
  rachel: 'Rachel Green (Friends)',
  phoebe: 'Phoebe Buffay (Friends)',
  dwight: 'Dwight Schrute (The Office)',
  ron: 'Ron Swanson (Parks & Rec)',
  archer: 'Sterling Archer (Archer)',
  custom: 'Custom Character',
};

async function runWorkMode(includeDatadog: boolean, personalityType: PersonalityType = 'proactive', characterType: CharacterType = 'none', checkpoint?: Checkpoint | null): Promise<void> {
  // Load session preferences - use saved preferences if command line args not specified
  const savedPrefs = await getSessionPreferences();
  if (personalityType === 'proactive' && savedPrefs.personality !== 'proactive') {
    personalityType = savedPrefs.personality;
  }
  
  // Load saved character if not specified on command line
  let customCharacterDesc: string | undefined;
  if (characterType === 'none' && savedPrefs.characterType !== 'none') {
    if (savedPrefs.characterType === 'custom' && savedPrefs.characterId) {
      const savedChar = await getCharacterById(savedPrefs.characterId);
      if (savedChar) {
        characterType = 'custom';
        customCharacterDesc = savedChar.description;
      }
    } else if (savedPrefs.characterType === 'builtin' && savedPrefs.builtinCharacter) {
      characterType = savedPrefs.builtinCharacter as CharacterType;
    }
  }
  
  console.clear();
  displayWorkWelcome(personalityType, characterType);
  
  // Check configured services
  const jiraStatus = getJiraConfigStatus();
  const githubStatus = getGitHubConfigStatus();
  const services = {
    jira: jiraStatus.configured,
    confluence: isConfluenceConfigured(),
    firehydrant: isFireHydrantConfigured(),
    datadog: isDatadogConfigured(),
    github: githubStatus.configured,
  };
  
  console.log(chalk.hex('#4C566A')(`  Personality: ${chalk.hex('#A3BE8C')(personalityType.toUpperCase())}`));
  if (characterType !== 'none') {
    console.log(chalk.hex('#4C566A')(`  Character: ${chalk.hex('#EBCB8B')(CHARACTER_DISPLAY_NAMES[characterType])}`));
  }
  console.log();
  console.log(chalk.hex('#4C566A')('  Configured services:'));
  if (jiraStatus.configured) {
    console.log(chalk.hex('#4C566A')(`    JIRA: ${chalk.green('✓')}`));
  } else {
    console.log(chalk.hex('#4C566A')(`    JIRA: ${chalk.red('✗')} ${chalk.yellow(jiraStatus.error || '')}`));
  }
  console.log(chalk.hex('#4C566A')(`    Confluence: ${services.confluence ? chalk.green('✓') : chalk.red('✗')}`));
  console.log(chalk.hex('#4C566A')(`    FireHydrant: ${services.firehydrant ? chalk.green('✓') : chalk.red('✗')}`));
  if (githubStatus.configured) {
    console.log(chalk.hex('#4C566A')(`    GitHub: ${chalk.green('✓')}`));
  } else {
    console.log(chalk.hex('#4C566A')(`    GitHub: ${chalk.red('✗')} ${chalk.yellow(githubStatus.error || '')}`));
  }
  console.log(chalk.hex('#4C566A')(`    Datadog: ${services.datadog && includeDatadog ? chalk.green('✓') : services.datadog ? chalk.yellow('○ (use --datadog to enable)') : chalk.red('✗')}`));
  console.log();
  console.log(chalk.hex('#4C566A')(`  Workspace: ${getWorkspace()}`));
  console.log();
  console.log(chalk.hex('#5E81AC')('  Commands:'));
  console.log(chalk.hex('#4C566A')('    /prompt      - Open editor for multi-line input'));
  console.log(chalk.hex('#4C566A')('    /paste       - Paste multi-line text (end with ---END---)'));
  console.log(chalk.hex('#4C566A')('    /reset       - Reset conversation'));
  console.log(chalk.hex('#4C566A')('    /tokens      - Show token usage'));
  console.log(chalk.hex('#4C566A')('    /plan        - View agent\'s current checklist/plan'));
  console.log(chalk.hex('#4C566A')('    /checkpoint  - Save current chat as checkpoint'));
  console.log(chalk.hex('#4C566A')('    /load        - Load a saved checkpoint'));
  console.log(chalk.hex('#4C566A')('    /datadog     - Toggle Datadog'));
  console.log(chalk.hex('#4C566A')('    /personality - Change personality'));
  console.log(chalk.hex('#4C566A')('    /character   - Change character (or set custom)'));
  console.log(chalk.hex('#4C566A')('    /memory      - View and manage memories'));
  console.log(chalk.hex('#4C566A')('    /exit        - Exit work mode'));
  console.log();
  console.log(chalk.hex('#4C566A').dim('  💡 Press Ctrl+C while thinking to interrupt.'));
  console.log();
  
  // Create agent session
  const session = new WorkAgentSession(includeDatadog, personalityType, characterType, customCharacterDesc);
  let datadogEnabled = includeDatadog;
  let hitRecursionLimit = false; // Track if we hit recursion limit
  
  // Restore from checkpoint if provided
  if (checkpoint) {
    const spinner = ora('Restoring checkpoint...').start();
    try {
      const messages = deserializeMessages(checkpoint.messages);
      await session.restoreFromCheckpoint(messages, {
        personality: checkpoint.personality,
        character: checkpoint.character,
        datadogEnabled: checkpoint.datadogEnabled,
      });
      datadogEnabled = checkpoint.datadogEnabled;
      spinner.stop();
      console.log();
      displaySuccess(`Restored checkpoint: ${checkpoint.name}`);
      console.log(chalk.hex('#4C566A')(`  ${checkpoint.summary}`));
      console.log(chalk.hex('#4C566A')(`  ${checkpoint.turnCount} turns, ~${checkpoint.tokenEstimate.toLocaleString()} tokens`));
      console.log();
    } catch (error) {
      spinner.stop();
      displayError(`Failed to restore checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
      displayInfo('Starting fresh session instead.');
      console.log();
    }
  }
  
  // Check for pending memories
  const pendingMems = await getPendingMemories();
  if (pendingMems.length > 0) {
    console.log(chalk.hex('#EBCB8B')(`  📝 You have ${pendingMems.length} pending memory proposal(s). Use /memory to review.`));
    console.log();
  }
  
  // Set up progress callback to show what's happening
  session.setProgressCallback((message) => {
    // Clear spinner line and show progress
    process.stdout.write(`\r\x1b[K  ${chalk.hex('#5E81AC')(message)}\n`);
  });
  
  // Set up checklist callback to display updates
  session.setChecklistCallback((checklist) => {
    if (checklist) {
      const doneCount = checklist.items.filter(i => i.status === 'done').length;
      const totalCount = checklist.items.length;
      const current = checklist.items.find(i => i.status === 'in_progress');
      const progressBar = `[${doneCount}/${totalCount}]`;
      const currentTask = current ? ` → ${current.task}` : '';
      process.stdout.write(`\r\x1b[K  ${chalk.hex('#EBCB8B')(`📋 ${progressBar}${currentTask}`)}\n`);
    }
  });
  
  // Handle Ctrl+C during thinking (interrupt agent)
  let interruptHandler: (() => void) | null = null;
  const originalSigintHandler = process.listeners('SIGINT');
  
  const setupInterruptHandler = () => {
    // Remove default handlers temporarily
    process.removeAllListeners('SIGINT');
    
    interruptHandler = () => {
      if (session.isProcessing()) {
        const interrupted = session.interrupt();
        if (interrupted) {
          process.stdout.write(`\n  ${chalk.hex('#BF616A')('⚠️ Interrupting...')}\n`);
        }
      } else {
        // Not processing, so exit normally
        displayInfo('Exiting work mode. Files saved to WORK_DIRS/');
        process.exit(0);
      }
    };
    
    process.on('SIGINT', interruptHandler);
  };
  
  const restoreHandlers = () => {
    if (interruptHandler) {
      process.removeListener('SIGINT', interruptHandler);
      interruptHandler = null;
    }
    // Restore original handlers
    for (const handler of originalSigintHandler) {
      process.on('SIGINT', handler as () => void);
    }
  };
  
  setupInterruptHandler();
  
  // Conversation loop
  while (true) {
    const { input } = await inquirer.prompt([
      {
        type: 'input',
        name: 'input',
        message: chalk.hex('#88C0D0')('You:'),
        prefix: '',
      },
    ]);
    
    const trimmedInput = input.trim();
    
    // Handle commands - only treat as command if it matches known patterns
    const knownCommands = ['/exit', '/quit', '/reset', '/tokens', '/datadog', '/prompt', '/paste', '/personality', '/character', '/memory', '/plan', '/checkpoint', '/load'];
    const isCommand = knownCommands.some(cmd => trimmedInput.toLowerCase().startsWith(cmd));
    
    if (isCommand) {
      const command = trimmedInput.toLowerCase();
      
      if (command === '/exit' || command === '/quit') {
        restoreHandlers();
        displayInfo('Exiting work mode. Files saved to WORK_DIRS/');
        break;
      }
      
      if (command === '/reset') {
        await session.reset();
        console.log();
        displaySuccess('Conversation reset');
        console.log();
        continue;
      }
      
      if (command === '/tokens') {
        const stats = session.getStats();
        console.log();
        console.log(chalk.hex('#5E81AC')('  📊 Token Stats'));
        console.log(chalk.hex('#4C566A')(`    Estimated tokens: ~${stats.estimated.toLocaleString()}`));
        console.log(chalk.hex('#4C566A')(`    Conversation turns: ${stats.turns}`));
        console.log(chalk.hex('#4C566A')(`    Messages: ${stats.messageCount}`));
        console.log();
        continue;
      }
      
      if (command === '/plan') {
        const checklist = session.getChecklist();
        console.log();
        if (!checklist) {
          console.log(chalk.hex('#4C566A')('  No active plan. The assistant will create one for complex tasks.'));
        } else {
          console.log(chalk.hex('#5E81AC').bold(`  📋 ${checklist.goal}`));
          console.log();
          for (const item of checklist.items) {
            const statusIcon = item.status === 'done' ? '✅' :
                              item.status === 'in_progress' ? '🔄' :
                              item.status === 'skipped' ? '⏭️' : '⬜';
            const statusColor = item.status === 'done' ? '#A3BE8C' :
                               item.status === 'in_progress' ? '#EBCB8B' :
                               item.status === 'skipped' ? '#4C566A' : '#D8DEE9';
            console.log(chalk.hex(statusColor)(`    ${statusIcon} ${item.task}`));
          }
        }
        console.log();
        continue;
      }
      
      if (command === '/datadog') {
        datadogEnabled = !datadogEnabled;
        session.setDatadog(datadogEnabled);
        await setDatadogPreference(datadogEnabled);
        console.log();
        displayInfo(`Datadog ${datadogEnabled ? 'enabled' : 'disabled'}`);
        console.log();
        continue;
      }
      
      if (command === '/personality') {
        const { personality } = await inquirer.prompt([
          {
            type: 'list',
            name: 'personality',
            message: 'Choose personality:',
            choices: [
              { name: 'Proactive - Reminds about tasks, asks for deadlines, concise', value: 'proactive' },
              { name: 'Default - Balanced, helpful', value: 'default' },
              { name: 'Minimal - Only speaks when asked, brief', value: 'minimal' },
            ],
          },
        ]);
        await session.setPersonality(personality as PersonalityType);
        await setPersonalityPreference(personality as PersonalityType);
        console.log();
        displaySuccess(`Personality changed to: ${personality}`);
        console.log();
        continue;
      }
      
      if (command === '/character') {
        const currentCharacter = session.getCharacter();
        console.log();
        console.log(chalk.hex('#5E81AC')(`  Current character: ${chalk.hex('#EBCB8B')(CHARACTER_DISPLAY_NAMES[currentCharacter.type])}`));
        console.log();
        
        // Load custom characters
        const customCharacters = await getCustomCharacters();
        
        // Build choices list dynamically
        const choices: any[] = [
          { name: '🚫 None (no character)', value: 'none' },
          new inquirer.Separator('── It\'s Always Sunny in Philadelphia ──'),
          { name: '🐔 Dee Reynolds - Defensive, sarcastic, wants validation', value: 'dee' },
          { name: '⭐ Dennis Reynolds - Golden God, narcissistic, intense', value: 'dennis' },
          { name: '💪 Mac McDonald - Badass wannabe, karate obsessed', value: 'mac' },
          { name: '🐀 Charlie Kelly - Wild card, bird law expert', value: 'charlie' },
          { name: '🥚 Frank Reynolds - Crass, schemes, "so anyway I started..."', value: 'frank' },
          new inquirer.Separator('── Seinfeld ──'),
          { name: '🎤 Jerry Seinfeld - "What\'s the deal with...", observational', value: 'jerry' },
          { name: '😰 George Costanza - Neurotic, "serenity now!", opposite day', value: 'george' },
          { name: '💁 Elaine Benes - "GET OUT!", confident, sponge-worthy', value: 'elaine' },
          { name: '🚪 Kramer - Bursts in, "giddyup!", knows a guy', value: 'kramer' },
          new inquirer.Separator('── Friends ──'),
          { name: '😏 Chandler Bing - "Could this BE...", sarcastic, awkward', value: 'chandler' },
          { name: '🍕 Joey Tribbiani - "How YOU doin\'?", lovable, food-obsessed', value: 'joey' },
          { name: '🦖 Ross Geller - "PIVOT!", dinosaurs, "we were on a break"', value: 'ross' },
          { name: '🧹 Monica Geller - Competitive, obsessively organized', value: 'monica' },
          { name: '👗 Rachel Green - "Oh my God", fashion, growth arc', value: 'rachel' },
          { name: '🎸 Phoebe Buffay - Quirky, "Smelly Cat", dark past', value: 'phoebe' },
          new inquirer.Separator('── Other Shows ──'),
          { name: '📋 Dwight Schrute - "FALSE.", beet farm, assistant TO the', value: 'dwight' },
          { name: '🥩 Ron Swanson - Terse, meat-loving, hates government', value: 'ron' },
          { name: '🍸 Sterling Archer - "DANGER ZONE!", egotistical spy', value: 'archer' },
        ];
        
        // Add custom characters section if any exist
        if (customCharacters.length > 0) {
          choices.push(new inquirer.Separator('── Custom Characters ──'));
          for (const char of customCharacters) {
            const traits = char.traits ? ` - ${char.traits.slice(0, 2).join(', ')}` : '';
            choices.push({
              name: `🎭 ${char.name} (${char.source})${traits}`,
              value: `custom:${char.id}`,
            });
          }
        }
        
        choices.push(new inquirer.Separator('──────────────'));
        choices.push({ name: '✏️  Ask assistant to create a character', value: 'ask_create' });
        choices.push({ name: '🗑️  Manage custom characters', value: 'manage' });
        
        const { characterChoice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'characterChoice',
            message: 'Choose character:',
            pageSize: 20,
            choices,
          },
        ]);
        
        // Handle custom character selection
        if (characterChoice.startsWith('custom:')) {
          const customId = characterChoice.substring(7);
          const customChar = customCharacters.find(c => c.id === customId);
          if (customChar) {
            await session.setCharacter('custom', customChar.description);
            await setCharacterPreference('custom', customId);
            console.log();
            displaySuccess(`Character set to: ${customChar.name} (${customChar.source})`);
            console.log();
          }
          continue;
        }
        
        // Handle "ask assistant to create"
        if (characterChoice === 'ask_create') {
          console.log();
          displayInfo('You can now ask the assistant to create a character!');
          displayInfo('Example: "Add Hermione Granger from Harry Potter"');
          console.log();
          continue;
        }
        
        // Handle manage custom characters
        if (characterChoice === 'manage') {
          if (customCharacters.length === 0) {
            console.log();
            displayInfo('No custom characters created yet.');
            displayInfo('Ask the assistant to create one! Example: "Add Yoda from Star Wars"');
            console.log();
            continue;
          }
          
          const { charToDelete } = await inquirer.prompt([
            {
              type: 'list',
              name: 'charToDelete',
              message: 'Select character to delete:',
              choices: [
                ...customCharacters.map(c => ({
                  name: `${c.name} (${c.source})`,
                  value: c.id,
                })),
                { name: '← Cancel', value: null },
              ],
            },
          ]);
          
          if (charToDelete) {
            await deleteCustomCharacter(charToDelete);
            displaySuccess('Character deleted');
          }
          console.log();
          continue;
        }
        
        // Handle builtin characters
        if (characterChoice === 'none') {
          await session.setCharacter('none');
          await setCharacterPreference('none');
          console.log();
          displaySuccess('Character mode disabled');
          console.log();
        } else {
          await session.setCharacter(characterChoice as CharacterType);
          await setCharacterPreference('builtin', undefined, characterChoice);
          console.log();
          displaySuccess(`Character changed to: ${CHARACTER_DISPLAY_NAMES[characterChoice as CharacterType]}`);
          console.log();
        }
        continue;
      }
      
      if (command === '/memory') {
        console.log();
        
        // Get current memories and pending
        const memories = await getMemories();
        const pending = await getPendingMemories();
        
        // Show pending memories that need approval
        if (pending.length > 0) {
          console.log(chalk.hex('#EBCB8B').bold('  📝 Pending Memories (awaiting approval):'));
          console.log();
          for (const p of pending) {
            console.log(chalk.hex('#D08770')(`    [${p.category}] "${p.content}"`));
            console.log(chalk.hex('#4C566A')(`    Reason: ${p.reason}`));
            console.log(chalk.hex('#4C566A').dim(`    ID: ${p.id}`));
            console.log();
          }
          
          const { pendingAction } = await inquirer.prompt([
            {
              type: 'list',
              name: 'pendingAction',
              message: 'What would you like to do with pending memories?',
              choices: [
                { name: 'Approve all', value: 'approve_all' },
                { name: 'Reject all', value: 'reject_all' },
                { name: 'Review one by one', value: 'review' },
                { name: 'Skip for now', value: 'skip' },
              ],
            },
          ]);
          
          if (pendingAction === 'approve_all') {
            for (const p of pending) {
              await approveMemory(p.id);
            }
            await session.reloadMemories();
            displaySuccess(`Approved ${pending.length} memories`);
          } else if (pendingAction === 'reject_all') {
            for (const p of pending) {
              await rejectMemory(p.id);
            }
            displayInfo(`Rejected ${pending.length} memories`);
          } else if (pendingAction === 'review') {
            for (const p of pending) {
              console.log();
              console.log(chalk.hex('#D08770')(`    "${p.content}"`));
              console.log(chalk.hex('#4C566A')(`    Reason: ${p.reason}`));
              
              const { decision } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'decision',
                  message: 'Approve this memory?',
                  choices: [
                    { name: '✓ Approve', value: 'approve' },
                    { name: '✗ Reject', value: 'reject' },
                  ],
                },
              ]);
              
              if (decision === 'approve') {
                await approveMemory(p.id);
                displaySuccess('Approved');
              } else {
                await rejectMemory(p.id);
                displayInfo('Rejected');
              }
            }
            await session.reloadMemories();
          }
          console.log();
        }
        
        // Show current memories
        if (memories.length > 0) {
          console.log(chalk.hex('#A3BE8C').bold('  🧠 Saved Memories:'));
          console.log();
          for (const m of memories) {
            console.log(chalk.hex('#88C0D0')(`    [${m.category}] ${m.content}`));
            console.log(chalk.hex('#4C566A').dim(`    ID: ${m.id}`));
          }
          console.log();
          
          const { memAction } = await inquirer.prompt([
            {
              type: 'list',
              name: 'memAction',
              message: 'Manage memories:',
              choices: [
                { name: 'Done', value: 'done' },
                { name: 'Delete a memory', value: 'delete' },
              ],
            },
          ]);
          
          if (memAction === 'delete') {
            const { memoryToDelete } = await inquirer.prompt([
              {
                type: 'list',
                name: 'memoryToDelete',
                message: 'Which memory to delete?',
                choices: memories.map(m => ({
                  name: `[${m.category}] ${m.content}`,
                  value: m.id,
                })),
              },
            ]);
            
            await deleteMemory(memoryToDelete);
            await session.reloadMemories();
            displaySuccess('Memory deleted');
          }
        } else if (pending.length === 0) {
          console.log(chalk.hex('#4C566A')('  No memories saved yet.'));
          console.log(chalk.hex('#4C566A')('  The assistant will propose memories when it notices your preferences.'));
          console.log(chalk.hex('#4C566A')('  You can also say "remember that I prefer..." to save directly.'));
        }
        
        console.log();
        continue;
      }
      
      if (command === '/checkpoint') {
        console.log();
        const stats = session.getStats();
        
        if (stats.turns === 0) {
          displayInfo('No conversation to checkpoint yet. Start chatting first!');
          console.log();
          continue;
        }
        
        // Ask assistant to summarize and name the checkpoint
        const spinner = ora('Creating checkpoint summary...').start();
        try {
          const summaryPrompt = `[INTERNAL SYSTEM REQUEST - DO NOT MENTION TO USER]
Please provide a BRIEF summary (2-3 sentences) of what we've discussed and worked on in this conversation.
Then suggest a SHORT name (3-5 words) for this checkpoint.

Format your response EXACTLY as:
SUMMARY: <your summary here>
NAME: <short name here>`;
          
          const { response } = await session.chat(summaryPrompt);
          spinner.stop();
          
          // Parse the response
          const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=\nNAME:|$)/s);
          const nameMatch = response.match(/NAME:\s*(.+)/);
          
          const summary = summaryMatch?.[1]?.trim() || 'Chat checkpoint';
          const suggestedName = nameMatch?.[1]?.trim() || `checkpoint-${new Date().toISOString().substring(0, 10)}`;
          
          // Let user confirm or edit the name
          const { checkpointName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'checkpointName',
              message: 'Checkpoint name:',
              default: suggestedName,
            },
          ]);
          
          const savingSpinner = ora('Saving checkpoint...').start();
          const checkpoint = await saveCheckpoint(
            checkpointName,
            summary,
            session.getMessages(),
            { tokenEstimate: stats.estimated, turnCount: stats.turns },
            session.getConfig()
          );
          savingSpinner.stop();
          
          console.log();
          displaySuccess(`Checkpoint saved: ${checkpoint.name}`);
          console.log(chalk.hex('#4C566A')(`  Summary: ${summary}`));
          console.log(chalk.hex('#4C566A')(`  Turns: ${stats.turns}, Tokens: ~${stats.estimated.toLocaleString()}`));
          console.log(chalk.hex('#4C566A')(`  ID: ${checkpoint.id}`));
          console.log();
          displayInfo('Use /load to restore this checkpoint later');
        } catch (error) {
          spinner.stop();
          displayError(`Failed to create checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        console.log();
        continue;
      }
      
      if (command === '/load') {
        console.log();
        const checkpoints = await listCheckpoints();
        
        if (checkpoints.length === 0) {
          displayInfo('No checkpoints saved yet. Use /checkpoint to save one.');
          console.log();
          continue;
        }
        
        console.log(chalk.hex('#5E81AC').bold('  📁 Saved Checkpoints:'));
        console.log();
        
        const choices = checkpoints.map((cp, i) => {
          const date = new Date(cp.createdAt).toLocaleString();
          const preview = cp.summary.length > 60 ? cp.summary.substring(0, 60) + '...' : cp.summary;
          return {
            name: `${i + 1}. ${cp.name}\n     ${chalk.hex('#4C566A')(date)} | ${cp.turnCount} turns | ~${cp.tokenEstimate.toLocaleString()} tokens\n     ${chalk.hex('#4C566A').dim(preview)}`,
            value: cp.id,
            short: cp.name,
          };
        });
        
        choices.push({ name: '← Cancel', value: 'cancel', short: 'Cancel' });
        choices.push({ name: '🗑️  Delete a checkpoint', value: 'delete', short: 'Delete' });
        
        const { checkpointChoice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'checkpointChoice',
            message: 'Select checkpoint:',
            choices,
            pageSize: 10,
          },
        ]);
        
        if (checkpointChoice === 'cancel') {
          console.log();
          continue;
        }
        
        if (checkpointChoice === 'delete') {
          const deleteChoices = checkpoints.map(cp => ({
            name: `${cp.name} (${new Date(cp.createdAt).toLocaleDateString()})`,
            value: cp.id,
          }));
          deleteChoices.push({ name: '← Cancel', value: 'cancel' });
          
          const { toDelete } = await inquirer.prompt([
            {
              type: 'list',
              name: 'toDelete',
              message: 'Which checkpoint to delete?',
              choices: deleteChoices,
            },
          ]);
          
          if (toDelete !== 'cancel') {
            await deleteCheckpoint(toDelete);
            displaySuccess('Checkpoint deleted');
          }
          console.log();
          continue;
        }
        
        // Load the selected checkpoint
        const checkpoint = await loadCheckpoint(checkpointChoice);
        if (!checkpoint) {
          displayError('Failed to load checkpoint');
          console.log();
          continue;
        }
        
        const spinner = ora('Restoring checkpoint...').start();
        try {
          const messages = deserializeMessages(checkpoint.messages);
          await session.restoreFromCheckpoint(messages, {
            personality: checkpoint.personality,
            character: checkpoint.character,
            datadogEnabled: checkpoint.datadogEnabled,
          });
          
          // Update local state to match checkpoint
          datadogEnabled = checkpoint.datadogEnabled;
          
          spinner.stop();
          console.log();
          displaySuccess(`Loaded checkpoint: ${checkpoint.name}`);
          console.log(chalk.hex('#4C566A')(`  ${checkpoint.summary}`));
          console.log(chalk.hex('#4C566A')(`  Restored ${checkpoint.turnCount} turns, ~${checkpoint.tokenEstimate.toLocaleString()} tokens`));
          console.log();
          displayInfo('Conversation restored. Continue where you left off!');
        } catch (error) {
          spinner.stop();
          displayError(`Failed to restore checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        console.log();
        continue;
      }
      
      if (command === '/prompt') {
        console.log();
        displayInfo('Opening editor for multi-line input...');
        try {
          const editorInput = await openEditorForPrompt('');
          if (editorInput.trim()) {
            // Process the editor input as a message
            const spinner = ora('Thinking...').start();
            try {
              const { response, tokenStats } = await session.chat(editorInput);
              spinner.stop();
              hitRecursionLimit = false; // Successful completion
              
              console.log();
              console.log(chalk.hex('#A3BE8C').bold('  Assistant:'));
              console.log();
              const rendered = renderMarkdown(response);
              const lines = rendered.split('\n');
              for (const line of lines) {
                console.log(`  ${line}`);
              }
              console.log();
              console.log(chalk.hex('#4C566A').dim(`  [~${tokenStats.estimated.toLocaleString()} tokens, ${tokenStats.turns} turns]`));
              console.log();
            } catch (error) {
              spinner.fail('Error');
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              displayError(errorMessage);
              
              // Detect recursion limit error
              if (errorMessage.includes('Recursion limit') || errorMessage.includes('recursionLimit')) {
                hitRecursionLimit = true;
                console.log();
                displayInfo('💡 Tip: Type "continue" to resume - the agent will summarize findings instead of restarting.');
              }
            }
          } else {
            displayInfo('Empty prompt, skipped.');
          }
        } catch (error) {
          displayError(`Editor error: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
        console.log();
        continue;
      }
      
      if (command === '/paste') {
        console.log();
        console.log(chalk.hex('#5E81AC')('  Paste your text below. Type "---END---" on a new line when done:'));
        console.log();
        
        const pasteLines: string[] = [];
        let reading = true;
        
        while (reading) {
          const { line } = await inquirer.prompt([
            {
              type: 'input',
              name: 'line',
              message: '',
              prefix: chalk.hex('#4C566A')('  │'),
            },
          ]);
          
          if (line.trim() === '---END---') {
            reading = false;
          } else {
            pasteLines.push(line);
          }
        }
        
        const pastedText = pasteLines.join('\n').trim();
        
        if (pastedText) {
          const spinner = ora('Thinking...').start();
          try {
            const { response, tokenStats } = await session.chat(pastedText);
            spinner.stop();
            hitRecursionLimit = false; // Successful completion
            
            console.log();
            console.log(chalk.hex('#A3BE8C').bold('  Assistant:'));
            console.log();
            const rendered = renderMarkdown(response);
            const lines = rendered.split('\n');
            for (const line of lines) {
              console.log(`  ${line}`);
            }
            console.log();
            console.log(chalk.hex('#4C566A').dim(`  [~${tokenStats.estimated.toLocaleString()} tokens, ${tokenStats.turns} turns]`));
            console.log();
          } catch (error) {
            spinner.fail('Error');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            displayError(errorMessage);
            
            // Detect recursion limit error
            if (errorMessage.includes('Recursion limit') || errorMessage.includes('recursionLimit')) {
              hitRecursionLimit = true;
              console.log();
              displayInfo('💡 Tip: Type "continue" to resume - the agent will summarize findings instead of restarting.');
            }
          }
        } else {
          displayInfo('Empty paste, skipped.');
          console.log();
        }
        continue;
      }
      
      displayError(`Unknown command: ${trimmedInput}`);
      continue;
    }
    
    // Skip empty input
    if (!trimmedInput) {
      continue;
    }
    
    // Send to agent
    const spinner = ora('Thinking...').start();
    
    // Check if this is a "continue" message after hitting recursion limit
    let actualInput = trimmedInput;
    const isContinueMessage = /^(continue|go on|keep going|resume|proceed|carry on)$/i.test(trimmedInput.toLowerCase().trim());
    
    if (hitRecursionLimit && isContinueMessage) {
      // Inject context to help the agent resume properly
      actualInput = `[SYSTEM: You hit a recursion limit on your previous run. DO NOT start a new investigation or create new directories. Instead:
1. Review what you already found (check the investigation directory you created)
2. Summarize your findings so far
3. Either conclude with what you learned, OR create a cursor_handoff if more codebase work is needed
4. If you need more Datadog searches, be strategic - don't repeat the same queries]

User says: ${trimmedInput}`;
      hitRecursionLimit = false; // Reset the flag
    }
    
    try {
      const { response, tokenStats, interrupted, hitRecursionLimit: hitLimit } = await session.chat(actualInput);
      spinner.stop();
      
      // Update the flag based on whether this run hit the limit
      hitRecursionLimit = hitLimit || false;
      
      // Display response with markdown rendering
      console.log();
      if (interrupted) {
        console.log(chalk.hex('#BF616A').bold('  Assistant (interrupted):'));
      } else if (hitLimit) {
        console.log(chalk.hex('#EBCB8B').bold('  Assistant (reached step limit):'));
      } else {
        console.log(chalk.hex('#A3BE8C').bold('  Assistant:'));
      }
      console.log();
      // Render markdown and add indentation
      const rendered = renderMarkdown(response);
      const lines = rendered.split('\n');
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      console.log();
      console.log(chalk.hex('#4C566A').dim(`  [~${tokenStats.estimated.toLocaleString()} tokens, ${tokenStats.turns} turns${interrupted ? ', interrupted' : ''}${hitLimit ? ', hit step limit' : ''}]`));
      console.log();
      
      if (interrupted) {
        displayInfo('💡 Use "continue" to resume, or start a new query.');
      }
      
      if (hitLimit) {
        displayInfo('💡 Conversation preserved. Ask follow-up questions or say "continue" to dig deeper.');
      }
      
    } catch (error) {
      spinner.fail('Error');
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      displayError(errorMessage);
      
      // Detect recursion limit error (fallback, shouldn't happen with new handling)
      if (errorMessage.includes('Recursion limit') || errorMessage.includes('recursionLimit')) {
        hitRecursionLimit = true;
        console.log();
        displayInfo('💡 Tip: Type "continue" to resume - the agent will summarize findings instead of restarting.');
      }
      console.log();
    }
  }
}

function displayWorkWelcome(personality: PersonalityType = 'proactive', character: CharacterType = 'none'): void {
  console.log();
  console.log(chalk.hex('#BF616A').bold('  ╭─────────────────────────────────────────────────────╮'));
  console.log(chalk.hex('#BF616A').bold('  │') + chalk.hex('#ECEFF4').bold('          🔧 Work Mode - AI Assistant               ') + chalk.hex('#BF616A').bold('│'));
  console.log(chalk.hex('#BF616A').bold('  ╰─────────────────────────────────────────────────────╯'));
  console.log();
  
  let personalityDesc = personality === 'proactive' 
    ? 'I\'ll remind you of tasks and keep you accountable!'
    : personality === 'minimal'
    ? 'I\'ll keep it short and only speak when needed.'
    : 'I can search APIs, run shell commands, and manage files.';
  
  // Add character flavor to the intro
  if (character !== 'none') {
    const characterIntros: Partial<Record<CharacterType, string>> = {
      dee: 'Ugh, FINE. I\'ll help you. Not like I have anything better to do...',
      dennis: 'You\'re in the presence of a GOLDEN GOD of productivity.',
      mac: 'Bro, I am SO ready to karate-chop these tasks!',
      charlie: 'OH! Ohhh! I totally know how to do computer stuff! WILD CARD!',
      frank: 'So anyway, I started helping...',
      jerry: 'What\'s the DEAL with work assistants? I mean, seriously!',
      george: 'I\'m not saying this is gonna go wrong, but... it might go wrong.',
      elaine: 'GET OUT! You actually need help? Fine, let\'s do this.',
      kramer: '*bursts in* Oh yeah, I know a guy who can help with that. That guy is ME!',
      chandler: 'Could I BE any more helpful? ...Probably not.',
      joey: 'How YOU doin\'? Let\'s get some work done... then maybe pizza?',
      ross: 'Hi! HI. I\'m gonna help you now. *awkward thumbs up*',
      monica: 'I am SO ready to organize the HECK out of your tasks!',
      rachel: 'Oh my God. Okay. I can totally do this. New Rachel, let\'s go!',
      phoebe: '🎵 Smelly tasks, smelly tasks, what are they feeding you? 🎵',
      dwight: 'Question: What is your task? Follow-up: Is it URGENT?',
      ron: 'I\'m only here because competence matters. Ask your question.',
      archer: 'Do you want help? Because THAT\'s how you get help. DANGER ZONE!',
    };
    personalityDesc = characterIntros[character] || personalityDesc;
  }
  
  console.log(chalk.hex('#4C566A')(`  ${personalityDesc}`));
  if (character === 'none') {
    console.log(chalk.hex('#4C566A')('  Ask me anything or tell me what to do!'));
  }
  console.log();
}

// Default command shows help
if (process.argv.length <= 2) {
  displayWelcome();
} else {
  program.parse();
}

