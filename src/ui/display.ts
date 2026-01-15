import chalk from 'chalk';
import { HNStory, SavedPost, DisplayPost } from '../types.js';
import { getTimeAgo, getHNUrl } from '../api/hackernews.js';
import { isPostSaved } from '../storage/posts.js';

// Beautiful color scheme - Nord-inspired with warm accents
const colors = {
  primary: chalk.hex('#88C0D0'),      // Frost blue
  secondary: chalk.hex('#81A1C1'),    // Lighter blue
  accent: chalk.hex('#EBCB8B'),       // Yellow/gold
  success: chalk.hex('#A3BE8C'),      // Green
  warning: chalk.hex('#D08770'),      // Orange
  muted: chalk.hex('#4C566A'),        // Dark gray
  text: chalk.hex('#ECEFF4'),         // Light text
  highlight: chalk.hex('#B48EAD'),    // Purple
  link: chalk.hex('#5E81AC'),         // Deep blue
};

const icons = {
  fire: '🔥',
  comment: '💬',
  star: '⭐',
  bookmark: '🔖',
  rocket: '🚀',
  brain: '🧠',
  arrow: '›',
  check: '✓',
  dot: '•',
};

export function displayHeader(title: string): void {
  const line = colors.muted('─'.repeat(60));
  console.log();
  console.log(line);
  console.log(colors.primary.bold(`  ${title}`));
  console.log(line);
  console.log();
}

export function displayPost(
  story: HNStory,
  rank: number,
  saved: boolean = false
): void {
  const timeAgo = getTimeAgo(story.time);
  const savedIcon = saved ? ` ${colors.accent(icons.bookmark)}` : '';
  
  // Rank and title
  console.log(
    colors.muted(`  ${String(rank).padStart(2, ' ')}.`) +
    ` ${colors.text.bold(story.title)}${savedIcon}`
  );
  
  // URL domain
  if (story.url) {
    try {
      const domain = new URL(story.url).hostname.replace('www.', '');
      console.log(colors.muted(`      ${icons.arrow} ${colors.link(domain)}`));
    } catch {
      // Invalid URL, skip
    }
  }
  
  // Stats line
  const stats = [
    `${colors.accent(story.score?.toString() || '0')} pts`,
    `${colors.primary(icons.comment)} ${colors.primary(story.descendants.toString())}`,
    colors.muted(`by ${story.by}`),
    colors.muted(timeAgo),
  ].join(colors.muted(` ${icons.dot} `));
  
  console.log(`      ${stats}`);
  console.log();
}

export function displaySavedPost(post: SavedPost, rank: number): void {
  const timeAgo = getTimeAgo(post.savedAt / 1000);
  
  console.log(
    colors.muted(`  ${String(rank).padStart(2, ' ')}.`) +
    ` ${colors.text.bold(post.title)} ${colors.accent(icons.bookmark)}`
  );
  
  if (post.url) {
    try {
      const domain = new URL(post.url).hostname.replace('www.', '');
      console.log(colors.muted(`      ${icons.arrow} ${colors.link(domain)}`));
    } catch {
      // Invalid URL
    }
  }
  
  const stats = [
    `${colors.accent(post.score.toString())} pts`,
    `${colors.primary(icons.comment)} ${colors.primary(post.descendants.toString())}`,
    colors.muted(`saved ${timeAgo}`),
  ].join(colors.muted(` ${icons.dot} `));
  
  console.log(`      ${stats}`);
  
  // Show embedding status
  const embeddingStatus = post.embedding 
    ? colors.success(`${icons.check} embedded`)
    : colors.muted('not embedded');
  console.log(`      ${embeddingStatus}`);
  console.log();
}

export function displayRecommendation(
  story: HNStory,
  rank: number,
  reason: string
): void {
  const timeAgo = getTimeAgo(story.time);
  
  console.log(
    colors.muted(`  ${String(rank).padStart(2, ' ')}.`) +
    ` ${colors.text.bold(story.title)} ${colors.highlight(icons.brain)}`
  );
  
  if (story.url) {
    try {
      const domain = new URL(story.url).hostname.replace('www.', '');
      console.log(colors.muted(`      ${icons.arrow} ${colors.link(domain)}`));
    } catch {
      // Invalid URL
    }
  }
  
  const stats = [
    `${colors.accent(story.score?.toString() || '0')} pts`,
    `${colors.primary(icons.comment)} ${colors.primary(story.descendants.toString())}`,
    colors.muted(`by ${story.by}`),
    colors.muted(timeAgo),
  ].join(colors.muted(` ${icons.dot} `));
  
  console.log(`      ${stats}`);
  console.log(`      ${colors.highlight('Why:')} ${colors.muted(reason)}`);
  console.log();
}

export function displayPostList(
  stories: HNStory[],
  savedPosts: SavedPost[],
  title: string
): void {
  displayHeader(title);
  
  stories.forEach((story, index) => {
    const saved = isPostSaved(savedPosts, story.id);
    displayPost(story, index + 1, saved);
  });
  
  displayFooter(`Showing ${stories.length} posts`);
}

export function displaySavedPostList(posts: SavedPost[]): void {
  displayHeader(`${icons.bookmark} Your Saved Posts`);
  
  if (posts.length === 0) {
    console.log(colors.muted('  No saved posts yet. Use "hn save <id>" to save a post.'));
    console.log();
    return;
  }
  
  posts.forEach((post, index) => {
    displaySavedPost(post, index + 1);
  });
  
  const withEmbeddings = posts.filter(p => p.embedding).length;
  displayFooter(`${posts.length} saved • ${withEmbeddings} embedded`);
}

export function displayRecommendations(
  recommendations: { story: HNStory; reason: string }[]
): void {
  displayHeader(`${icons.brain} AI Recommendations`);
  
  if (recommendations.length === 0) {
    console.log(colors.muted('  No recommendations available.'));
    console.log();
    return;
  }
  
  recommendations.forEach((rec, index) => {
    displayRecommendation(rec.story, index + 1, rec.reason);
  });
  
  displayFooter('Powered by Gemini AI');
}

export function displayFooter(message: string): void {
  console.log(colors.muted(`  ${message}`));
  console.log(colors.muted('─'.repeat(60)));
  console.log();
}

export function displaySuccess(message: string): void {
  console.log();
  console.log(colors.success(`  ${icons.check} ${message}`));
  console.log();
}

export function displayError(message: string): void {
  console.log();
  console.log(colors.warning(`  ✗ ${message}`));
  console.log();
}

export function displayInfo(message: string): void {
  console.log();
  console.log(colors.secondary(`  ${icons.arrow} ${message}`));
  console.log();
}

export function displayWelcome(): void {
  console.log();
  console.log(colors.primary.bold('  ╭─────────────────────────────────────────╮'));
  console.log(colors.primary.bold('  │') + colors.text.bold('    Hacker News CLI with AI Recs        ') + colors.primary.bold('│'));
  console.log(colors.primary.bold('  ╰─────────────────────────────────────────╯'));
  console.log();
  console.log(colors.muted('  Commands:'));
  console.log(`    ${colors.accent('top')}       ${colors.muted('Top commented posts from front page')}`);
  console.log(`    ${colors.accent('new')}       ${colors.muted('Top commented from new posts')}`);
  console.log(`    ${colors.accent('best')}      ${colors.muted('Top commented from best posts')}`);
  console.log(`    ${colors.accent('saved')}     ${colors.muted('View your saved posts')}`);
  console.log(`    ${colors.accent('save')}      ${colors.muted('Save a post by ID')}`);
  console.log(`    ${colors.accent('remove')}    ${colors.muted('Remove a saved post')}`);
  console.log(`    ${colors.accent('clear')}     ${colors.muted('Clear all saved posts')}`);
  console.log(`    ${colors.accent('skip')}      ${colors.muted('Skip a post for 10 days')}`);
  console.log(`    ${colors.accent('recommend')} ${colors.muted('Get AI recommendations')}`);
  console.log(`    ${colors.accent('embed')}     ${colors.muted('Embed saved posts for recommendations')}`);
  console.log();
  console.log(colors.highlight('  AI Features:'));
  console.log(`    ${colors.accent('ask')}        ${colors.muted('Ask AI for help with commands')}`);
  console.log(`    ${colors.accent('discover')}   ${colors.muted('Enter interactive discovery mode')}`);
  console.log(`    ${colors.accent('temperature')} ${colors.muted('View/set LLM temperature (0-2)')}`);
  console.log();
  console.log(colors.muted('  Use "hn <command> --help" for more info'));
  console.log(colors.muted('  Try: hn ask "how do I see top posts from last month?"'));
  console.log();
}

export function displayAssistantResponse(response: string): void {
  console.log();
  console.log(colors.primary.bold('  🤖 AI Assistant'));
  console.log(colors.muted('  ' + '─'.repeat(56)));
  
  // Format the response with proper indentation
  const lines = response.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      console.log(colors.muted(`  ${line}`));
    } else if (line.trim().startsWith('hn ')) {
      console.log(`  ${colors.accent(line.trim())}`);
    } else if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
      console.log(`  ${colors.secondary(line)}`);
    } else {
      console.log(`  ${colors.text(line)}`);
    }
  }
  
  console.log(colors.muted('  ' + '─'.repeat(56)));
  console.log();
}

export function displayPostSummary(story: HNStory, summary: string): void {
  console.log();
  console.log(colors.primary.bold('  📝 Post Summary'));
  console.log(colors.muted('  ' + '─'.repeat(56)));
  console.log();
  
  // Title
  console.log(`  ${colors.text.bold(story.title)}`);
  
  // URL
  if (story.url) {
    try {
      const domain = new URL(story.url).hostname.replace('www.', '');
      console.log(colors.muted(`  ${icons.arrow} ${colors.link(domain)}`));
    } catch {
      // Invalid URL
    }
  }
  
  // Stats
  const timeAgo = getTimeAgo(story.time);
  const stats = [
    `${colors.accent(story.score?.toString() || '0')} pts`,
    `${colors.primary(icons.comment)} ${colors.primary(story.descendants.toString())}`,
    colors.muted(`by ${story.by}`),
    colors.muted(timeAgo),
  ].join(colors.muted(` ${icons.dot} `));
  console.log(`  ${stats}`);
  console.log();
  
  // Summary
  console.log(colors.secondary('  Summary:'));
  const summaryLines = summary.split('\n');
  for (const line of summaryLines) {
    if (line.trim()) {
      console.log(colors.text(`  ${line}`));
    }
  }
  
  console.log();
  console.log(colors.muted(`  Post ID: ${story.id}`));
  console.log(colors.muted('  ' + '─'.repeat(56)));
  console.log();
}

export function displayDiscoveryPost(
  story: HNStory,
  summary: string,
  reason: string
): void {
  console.log();
  console.log(colors.highlight.bold('  ✨ Found something for you!'));
  console.log(colors.muted('  ' + '─'.repeat(56)));
  console.log();
  
  // Title
  console.log(`  ${colors.text.bold(story.title)}`);
  
  // URL
  if (story.url) {
    try {
      const domain = new URL(story.url).hostname.replace('www.', '');
      console.log(colors.muted(`  ${icons.arrow} ${colors.link(domain)}`));
    } catch {
      // Invalid URL
    }
  }
  
  // Stats
  const timeAgo = getTimeAgo(story.time);
  const stats = [
    `${colors.accent(story.score?.toString() || '0')} pts`,
    `${colors.primary(icons.comment)} ${colors.primary(story.descendants.toString())}`,
    colors.muted(`by ${story.by}`),
    colors.muted(timeAgo),
  ].join(colors.muted(` ${icons.dot} `));
  console.log(`  ${stats}`);
  console.log();
  
  // Why this post
  console.log(colors.highlight(`  Why this post:`));
  console.log(colors.muted(`  ${reason}`));
  console.log();
  
  // Summary
  console.log(colors.primary(`  📝 Quick Summary:`));
  const summaryLines = summary.split('\n');
  for (const line of summaryLines) {
    console.log(colors.text(`  ${line}`));
  }
  
  console.log();
  console.log(colors.muted(`  Post ID: ${story.id}`));
  console.log(colors.muted('  ' + '─'.repeat(56)));
  console.log();
}

