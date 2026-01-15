import { GoogleGenerativeAI } from '@google/generative-ai';
import { HNStory, HNItem } from '../types.js';
import { fetchItem, fetchTopCommentedStories, getTimeAgo } from '../api/hackernews.js';
import { getSavedPosts, getSkippedPostIds, getTemperature } from '../storage/posts.js';
import { getGeminiRecommendations, hasEmbeddedPosts } from './gemini.js';

let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment. Please add it to your .env file.');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

const CLI_CONTEXT = `You are an AI assistant for a Hacker News CLI tool called "hn".

AVAILABLE COMMANDS:
- hn top [-n count] - Show top commented posts from front page (current trending)
- hn new [-n count] - Show top commented posts from new stories
- hn best [-n count] - Show top commented posts from best stories (all-time popular)
- hn saved - View your saved posts
- hn save <id> - Save a post by its Hacker News ID
- hn remove <id> - Remove a saved post
- hn embed - Generate embeddings for saved posts (needed for recommendations)
- hn recommend [-n count] [-s source] - Get AI recommendations based on saved posts
- hn open <id> - Open a post in browser
- hn ask "<question>" - Ask the AI assistant for help (this command)
- hn discover - Enter interactive discovery mode where AI suggests posts periodically

IMPORTANT LIMITATIONS:
- The Hacker News API does NOT support filtering by date/time period
- There is no way to get "top posts from last month" or "posts from a specific date"
- The "best" command shows all-time popular posts, not time-filtered
- The "top" command shows current front page posts
- For historical posts, users would need to use external archives like the Hacker News Algolia API

OPTIONS:
- -n, --number <count>: Number of posts to show (default: 15)
- -s, --source <type>: For recommend command - top, new, or best (default: top)
- --no-interactive: Disable interactive prompts after listing

WORKFLOW FOR RECOMMENDATIONS:
1. Save interesting posts with "hn save <id>"
2. Run "hn embed" to create embeddings
3. Run "hn recommend" to get personalized suggestions

Be helpful, concise, and if the user asks for something impossible (like time-filtered posts), explain the limitation and suggest alternatives.`;

export async function askAssistant(question: string): Promise<string> {
  const ai = getGenAI();
  const temperature = await getTemperature();
  const model = ai.getGenerativeModel({ 
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature,
    },
  });
  
  const prompt = `${CLI_CONTEXT}

USER QUESTION: ${question}

Provide a helpful, concise answer. If they're asking how to do something, give them the exact command. If what they want isn't possible, explain why and suggest alternatives.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function fetchComments(storyId: number, limit: number = 10): Promise<string[]> {
  const story = await fetchItem(storyId);
  if (!story || !story.kids) return [];
  
  const comments: string[] = [];
  const commentIds = story.kids.slice(0, limit);
  
  for (const id of commentIds) {
    const comment = await fetchItem(id);
    if (comment && comment.text && !comment.dead) {
      // Clean HTML from comment text
      const cleanText = comment.text
        .replace(/<[^>]*>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanText.length > 20) {
        comments.push(`[${comment.by}]: ${cleanText.substring(0, 500)}`);
      }
    }
  }
  
  return comments;
}

export async function generatePostSummary(story: HNStory): Promise<string> {
  const ai = getGenAI();
  const temperature = await getTemperature();
  const model = ai.getGenerativeModel({ 
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature,
    },
  });
  
  // Fetch some top comments
  const comments = await fetchComments(story.id, 8);
  
  const commentsContext = comments.length > 0 
    ? `\n\nTOP COMMENTS:\n${comments.join('\n\n')}`
    : '';
  
  const prompt = `Summarize this Hacker News post and the discussion around it in 2-3 engaging sentences. Make it sound interesting and capture the key points and any notable opinions from the comments.

TITLE: ${story.title}
URL: ${story.url || 'No URL (text post)'}
SCORE: ${story.score} points
COMMENTS: ${story.descendants}
${commentsContext}

Write a brief, engaging summary that would make someone want to read more:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function pickPostForUser(
  excludeIds: number[] = [],
  preferDifferent: boolean = false
): Promise<{ story: HNStory; summary: string; reason: string } | null> {
  const savedPosts = await getSavedPosts();
  const hasEmbedded = savedPosts.length > 0 && await hasEmbeddedPosts();
  const skippedIds = await getSkippedPostIds();
  const temperature = await getTemperature();
  
  // Combine excludeIds with skipped posts
  const allExcluded = [...new Set([...excludeIds, ...skippedIds])];
  
  let story: HNStory;
  let reason: string;
  
  if (hasEmbedded) {
    // Use recommendation system only if we have saved posts with embeddings
    try {
      const candidates = await fetchTopCommentedStories('top', 50);
      // Filter out excluded posts
      const filteredCandidates = candidates.filter(s => !allExcluded.includes(s.id));
      
      if (filteredCandidates.length === 0) {
        // All candidates were excluded, reset and try again
        const allCandidates = await fetchTopCommentedStories('top', 20);
        story = allCandidates[Math.floor(Math.random() * Math.min(10, allCandidates.length))];
        reason = "This post is currently trending with lots of discussion.";
      } else {
        const recommendations = await getGeminiRecommendations(
          filteredCandidates, 
          5, 
          temperature,
          preferDifferent
        );
        
        if (recommendations.length > 0) {
          if (preferDifferent) {
            // When preferring different, pick from lower similarity posts
            story = recommendations[recommendations.length - 1].story;
            reason = recommendations[recommendations.length - 1].reason + " (Selected for diversity)";
          } else {
            // Pick randomly from top recommendations to add variety
            const randomIndex = Math.floor(Math.random() * Math.min(3, recommendations.length));
            story = recommendations[randomIndex].story;
            reason = recommendations[randomIndex].reason;
          }
        } else {
          // Fallback to random from top
          story = filteredCandidates[Math.floor(Math.random() * Math.min(10, filteredCandidates.length))];
          reason = "This post is currently trending with lots of discussion.";
        }
      }
    } catch (error) {
      // If recommendation fails, fall back to random selection
      const stories = await fetchTopCommentedStories('top', 30);
      const filtered = stories.filter(s => !allExcluded.includes(s.id));
      story = filtered[Math.floor(Math.random() * Math.min(10, filtered.length))];
      reason = "This post is currently trending with lots of discussion.";
    }
  } else {
    // No saved posts or no embeddings, pick randomly from top stories
    const stories = await fetchTopCommentedStories('top', 30);
    const filtered = stories.filter(s => !allExcluded.includes(s.id));
    
    if (filtered.length === 0) {
      // All were excluded, use any
      story = stories[Math.floor(Math.random() * Math.min(10, stories.length))];
    } else {
      story = filtered[Math.floor(Math.random() * Math.min(10, filtered.length))];
    }
    reason = "This post is currently trending with lots of discussion.";
  }
  
  const summary = await generatePostSummary(story);
  
  return { story, summary, reason };
}

export async function continueExploration(story: HNStory, userQuestion: string): Promise<string> {
  const ai = getGenAI();
  const temperature = await getTemperature();
  const model = ai.getGenerativeModel({ 
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature,
    },
  });
  
  const comments = await fetchComments(story.id, 15);
  
  const prompt = `You're helping a user explore a Hacker News post. Answer their question based on the post and comments.

POST TITLE: ${story.title}
URL: ${story.url || 'Text post'}
SCORE: ${story.score} points
COMMENTS: ${story.descendants} total

TOP COMMENTS:
${comments.join('\n\n')}

USER'S QUESTION: ${userQuestion}

Provide a helpful, informative response based on the post and discussion:`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

