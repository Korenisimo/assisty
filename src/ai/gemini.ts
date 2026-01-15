import { GoogleGenerativeAI } from '@google/generative-ai';
import { SavedPost, HNStory } from '../types.js';
import { getPostsWithEmbeddings, getPostsWithoutEmbeddings, updatePostEmbedding, getSavedPosts } from '../storage/posts.js';

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

/**
 * Retry helper for Gemini API calls with exponential backoff
 * Handles rate limits (429) and transient errors gracefully
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Extract error details for better logging
      const errorMsg = error?.message || JSON.stringify(error);
      const statusText = error?.statusText || '';
      const status = error?.status || (errorMsg.includes('429') ? 429 : null);
      
      // Check if it's a rate limit or quota error
      const isRateLimit = status === 429 || 
                         errorMsg.includes('429') || 
                         errorMsg.includes('quota') ||
                         errorMsg.includes('Too Many Requests') ||
                         errorMsg.includes('rate limit') ||
                         errorMsg.includes('RESOURCE_EXHAUSTED');
      
      const isTransient = status === 503 || status === 500 ||
                         errorMsg.includes('503') || 
                         errorMsg.includes('500');
      
      // Don't retry on non-retriable errors
      if (!isRateLimit && !isTransient) {
        throw error;
      }
      
      // On last attempt, throw with helpful message
      if (attempt === maxRetries) {
        if (isRateLimit) {
          throw new Error(
            `❌ Gemini API quota/rate limit exceeded.\n\n` +
            `Check your quota and usage at: https://aistudio.google.com/apikey\n` +
            `Free tier limits: 15 RPM, 1 million TPM, 1500 RPD\n\n` +
            `Original error: ${errorMsg}`
          );
        }
        throw new Error(`Gemini API error after ${maxRetries} retries: ${errorMsg}`);
      }
      
      // Exponential backoff with jitter
      const delayMs = initialDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`⚠️  Gemini API error (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMsg.substring(0, 100)}`);
      console.log(`   Retrying in ${Math.round(delayMs)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError!;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return retryWithBackoff(async () => {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: 'text-embedding-004' });
    
    const result = await model.embedContent(text);
    return result.embedding.values;
  });
}

export async function embedSavedPosts(): Promise<number> {
  const postsWithoutEmbeddings = await getPostsWithoutEmbeddings();
  let embedded = 0;
  
  for (const post of postsWithoutEmbeddings) {
    try {
      const text = `${post.title}${post.url ? ` (${new URL(post.url).hostname})` : ''}`;
      const embedding = await generateEmbedding(text);
      await updatePostEmbedding(post.id, embedding);
      embedded++;
    } catch (error: any) {
      // Check if it's a rate limit error - stop processing to avoid more failures
      const isRateLimit = error?.message?.includes('rate limit') || 
                         error?.message?.includes('quota');
      if (isRateLimit) {
        console.error(`\nGemini API rate limit hit after ${embedded} posts. Please wait and try again later.`);
        break; // Stop processing to avoid hammering the API
      }
      console.error(`Failed to embed post ${post.id}:`, error?.message || error);
    }
  }
  
  return embedded;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

export async function findSimilarPosts(
  candidates: HNStory[],
  topK: number = 10
): Promise<{ story: HNStory; similarity: number }[]> {
  const savedPosts = await getPostsWithEmbeddings();
  
  if (savedPosts.length === 0) {
    return [];
  }
  
  // Calculate average embedding of saved posts (user's interest profile)
  const avgEmbedding = savedPosts[0].embedding!.map((_, i) => {
    return savedPosts.reduce((sum, post) => sum + (post.embedding![i] || 0), 0) / savedPosts.length;
  });
  
  // Embed and score each candidate
  const scored: { story: HNStory; similarity: number }[] = [];
  
  for (const story of candidates) {
    // Skip if already saved
    if (savedPosts.some(p => p.id === story.id)) continue;
    
    try {
      const text = `${story.title}${story.url ? ` (${new URL(story.url).hostname})` : ''}`;
      const embedding = await generateEmbedding(text);
      const similarity = cosineSimilarity(embedding, avgEmbedding);
      scored.push({ story, similarity });
      
      // Only process enough candidates to get topK results
      if (scored.length >= topK) break;
    } catch {
      // Skip failed embeddings silently
    }
  }
  
  // Sort by similarity
  scored.sort((a, b) => b.similarity - a.similarity);
  
  return scored.slice(0, topK);
}

export async function getGeminiRecommendations(
  candidates: HNStory[],
  limit: number = 5,
  temperature: number = 0.7,
  preferDifferent: boolean = false
): Promise<{ story: HNStory; reason: string }[]> {
  const savedPosts = await getSavedPosts();
  
  if (savedPosts.length === 0) {
    throw new Error('No saved posts yet. Save some posts first to get personalized recommendations.');
  }
  
  // First, use embeddings to find similar posts
  const similarPosts = await findSimilarPosts(candidates, 15);
  
  if (similarPosts.length === 0) {
    throw new Error(`Could not find similar posts. You have ${savedPosts.length} saved posts. Candidates: ${candidates.length}. Try saving more diverse posts.`);
  }
  
  // Prepare context for Gemini
  const savedPostsSummary = savedPosts
    .slice(0, 20)
    .map(p => `- "${p.title}"`)
    .join('\n');
  
  // If preferDifferent, reverse sort by similarity to get diverse posts
  const sortedPosts = preferDifferent 
    ? [...similarPosts].sort((a, b) => a.similarity - b.similarity) // Lower similarity = more different
    : similarPosts;
  
  const candidatesSummary = sortedPosts
    .map((sp, i) => `${i + 1}. [ID:${sp.story.id}] "${sp.story.title}" (similarity: ${(sp.similarity * 100).toFixed(1)}%, ${sp.story.descendants} comments)`)
    .join('\n');
  
  const ai = getGenAI();
  const model = ai.getGenerativeModel({ 
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      temperature,
    },
  });
  
  const diversityInstruction = preferDifferent
    ? '\n\nIMPORTANT: The user wants something DIFFERENT from their usual interests. Prioritize posts that are LESS similar to their saved posts. Look for variety and novelty.'
    : '';
  
  const prompt = `You are a personalized Hacker News recommendation engine. Based on the user's saved posts, recommend the best matching new posts from the candidates.

USER'S SAVED POSTS (showing their interests):
${savedPostsSummary}

CANDIDATE POSTS (pre-filtered by embedding similarity):
${candidatesSummary}
${diversityInstruction}

Analyze the user's interests from their saved posts and select the ${limit} best recommendations from the candidates. Consider:
1. Topic alignment with saved posts${preferDifferent ? ' (but prioritize DIFFERENT topics)' : ''}
2. Semantic similarity scores provided${preferDifferent ? ' (lower similarity = more different)' : ''}
3. Post engagement (comment count)
4. Variety in recommendations

Respond ONLY with a JSON array in this exact format (no markdown, no explanation):
[{"id": POST_ID, "reason": "Brief reason why this matches their interests"}]

Select exactly ${limit} posts. Use the actual post IDs shown in brackets.`;

  const response = await retryWithBackoff(async () => {
    const result = await model.generateContent(prompt);
    return result.response.text();
  });
  
  // Parse the JSON response
  let recommendations: { id: number; reason: string }[];
  try {
    // Clean up the response (remove markdown code blocks if present)
    const cleanJson = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    recommendations = JSON.parse(cleanJson);
  } catch (e) {
    throw new Error(`Failed to parse Gemini recommendations: ${response.substring(0, 200)}`);
  }
  
  // Map back to stories (Gemini might return IDs as strings)
  const results: { story: HNStory; reason: string }[] = [];
  
  for (const rec of recommendations) {
    const recId = typeof rec.id === 'string' ? parseInt(rec.id, 10) : rec.id;
    const match = similarPosts.find(sp => sp.story.id === recId);
    if (match) {
      results.push({ story: match.story, reason: rec.reason });
    }
  }
  
  return results;
}

export async function hasEmbeddedPosts(): Promise<boolean> {
  const posts = await getPostsWithEmbeddings();
  return posts.length > 0;
}

