// LinkedIn & CV Management
// Helps users update their LinkedIn and CV based on achievements and PDP

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  setLinkedInUrl,
  getLinkedInUrl,
  setCvPath,
  getCvPath,
} from '../storage/preferences.js';
import { getAchievements, Achievement } from './achievements.js';
import { getPDPGoals, getCachedPDPContent, PDPGoal } from './pdp.js';

// ===== Types =====

export interface LinkedInProfile {
  url: string;
  headline?: string;
  summary?: string;
  experience?: LinkedInExperience[];
  skills?: string[];
  scrapedAt: number;
  rawContent?: string;
}

export interface LinkedInExperience {
  title: string;
  company: string;
  duration?: string;
  description?: string;
}

export interface CVContent {
  path: string;
  rawContent?: string;
  parsedAt?: number;
}

export interface ProfileReviewSession {
  status: 'not_started' | 'linkedin_review' | 'cv_review' | 'comparing' | 'recommendations' | 'completed';
  linkedinProfile?: LinkedInProfile;
  cvContent?: CVContent;
  achievements?: Achievement[];
  pdpGoals?: PDPGoal[];
  recommendations?: ProfileRecommendation[];
  currentStep?: number;
  totalSteps?: number;
  startedAt?: number;
}

export interface ProfileRecommendation {
  id: string;
  type: 'headline' | 'summary' | 'experience' | 'skill' | 'achievement_to_add' | 'cv_update';
  target: 'linkedin' | 'cv' | 'both';
  priority: 'high' | 'medium' | 'low';
  currentValue?: string;
  suggestedValue: string;
  reason: string;
  linkedAchievementIds?: string[];
  approved?: boolean;
}

// ===== Module State =====

let currentSession: ProfileReviewSession = { status: 'not_started' };

// ===== Storage =====

function getProfileStorePath(): string {
  return join(homedir(), '.hn-work-assistant', 'linkedin-cv.json');
}

interface ProfileStore {
  linkedinProfile?: LinkedInProfile;
  cvContent?: CVContent;
  lastReviewAt?: number;
  pastRecommendations?: ProfileRecommendation[];
}

async function loadProfileStore(): Promise<ProfileStore> {
  const path = getProfileStorePath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveProfileStore(store: ProfileStore): Promise<void> {
  const path = getProfileStorePath();
  const dir = join(homedir(), '.hn-work-assistant');
  if (!existsSync(dir)) {
    const { mkdir } = await import('fs/promises');
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(store, null, 2));
}

// ===== Public API =====

/**
 * Set user's LinkedIn profile URL
 */
export async function setLinkedIn(url: string): Promise<{ success: boolean; message: string }> {
  // Validate URL format
  if (!url.includes('linkedin.com/in/')) {
    return { success: false, message: 'Invalid LinkedIn URL. Expected format: https://www.linkedin.com/in/username' };
  }
  
  await setLinkedInUrl(url);
  
  // Clear any cached profile data since URL changed
  const store = await loadProfileStore();
  store.linkedinProfile = undefined;
  await saveProfileStore(store);
  
  return { success: true, message: `LinkedIn URL saved: ${url}` };
}

/**
 * Set user's CV file path
 */
export async function setCV(path: string): Promise<{ success: boolean; message: string }> {
  // Expand ~ to home directory
  const expandedPath = path.startsWith('~') ? path.replace('~', homedir()) : path;
  
  if (!existsSync(expandedPath)) {
    return { success: false, message: `File not found: ${expandedPath}` };
  }
  
  await setCvPath(expandedPath);
  
  // Clear cached CV content
  const store = await loadProfileStore();
  store.cvContent = undefined;
  await saveProfileStore(store);
  
  return { success: true, message: `CV path saved: ${expandedPath}` };
}

/**
 * Get current LinkedIn and CV configuration
 */
export async function getProfileConfig(): Promise<{
  linkedinUrl?: string;
  cvPath?: string;
  lastLinkedInScrape?: number;
  lastCVParse?: number;
}> {
  const linkedinUrl = await getLinkedInUrl();
  const cvPath = await getCvPath();
  const store = await loadProfileStore();
  
  return {
    linkedinUrl,
    cvPath,
    lastLinkedInScrape: store.linkedinProfile?.scrapedAt,
    lastCVParse: store.cvContent?.parsedAt,
  };
}

/**
 * Start a profile review session
 * This is the main entry point for the consultative flow
 */
export async function startProfileReview(): Promise<{
  success: boolean;
  message: string;
  nextStep?: string;
  missingConfig?: string[];
}> {
  const linkedinUrl = await getLinkedInUrl();
  const cvPath = await getCvPath();
  const missing: string[] = [];
  
  if (!linkedinUrl) {
    missing.push('LinkedIn URL (use set_linkedin tool)');
  }
  if (!cvPath) {
    missing.push('CV path (use set_cv tool)');
  }
  
  if (missing.length > 0) {
    return {
      success: false,
      message: 'Cannot start review - missing configuration',
      missingConfig: missing,
    };
  }
  
  // Load achievements and PDP goals
  const achievements = await getAchievements();
  const pdpGoals = await getPDPGoals();
  
  currentSession = {
    status: 'linkedin_review',
    achievements,
    pdpGoals,
    currentStep: 1,
    totalSteps: 5,
    startedAt: Date.now(),
    recommendations: [],
  };
  
  return {
    success: true,
    message: 'Profile review session started!',
    nextStep: `Step 1/5: Let's review your LinkedIn profile. Please navigate to ${linkedinUrl} and I'll analyze it using the browser.`,
  };
}

/**
 * Store scraped LinkedIn profile data
 */
export async function storeLinkedInProfile(profile: Omit<LinkedInProfile, 'scrapedAt'>): Promise<void> {
  const store = await loadProfileStore();
  store.linkedinProfile = {
    ...profile,
    scrapedAt: Date.now(),
  };
  await saveProfileStore(store);
  
  currentSession.linkedinProfile = store.linkedinProfile;
  currentSession.status = 'cv_review';
  currentSession.currentStep = 2;
}

/**
 * Store CV content
 */
export async function storeCVContent(content: string): Promise<void> {
  const cvPath = await getCvPath();
  if (!cvPath) return;
  
  const store = await loadProfileStore();
  store.cvContent = {
    path: cvPath,
    rawContent: content,
    parsedAt: Date.now(),
  };
  await saveProfileStore(store);
  
  currentSession.cvContent = store.cvContent;
  currentSession.status = 'comparing';
  currentSession.currentStep = 3;
}

/**
 * Add a recommendation during the review process
 */
export function addRecommendation(rec: Omit<ProfileRecommendation, 'id' | 'approved'>): void {
  const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  currentSession.recommendations = currentSession.recommendations || [];
  currentSession.recommendations.push({
    ...rec,
    id,
    approved: undefined,
  });
}

/**
 * Approve or reject a recommendation
 */
export function setRecommendationApproval(recId: string, approved: boolean): boolean {
  const rec = currentSession.recommendations?.find(r => r.id === recId);
  if (!rec) return false;
  rec.approved = approved;
  return true;
}

/**
 * Get current session state
 */
export function getReviewSession(): ProfileReviewSession {
  return { ...currentSession };
}

/**
 * Get recommendations summary
 */
export function getRecommendationsSummary(): {
  total: number;
  byTarget: Record<string, number>;
  byPriority: Record<string, number>;
  pending: number;
  approved: number;
  rejected: number;
} {
  const recs = currentSession.recommendations || [];
  
  return {
    total: recs.length,
    byTarget: {
      linkedin: recs.filter(r => r.target === 'linkedin' || r.target === 'both').length,
      cv: recs.filter(r => r.target === 'cv' || r.target === 'both').length,
    },
    byPriority: {
      high: recs.filter(r => r.priority === 'high').length,
      medium: recs.filter(r => r.priority === 'medium').length,
      low: recs.filter(r => r.priority === 'low').length,
    },
    pending: recs.filter(r => r.approved === undefined).length,
    approved: recs.filter(r => r.approved === true).length,
    rejected: recs.filter(r => r.approved === false).length,
  };
}

/**
 * Complete the review session
 */
export async function completeReview(): Promise<{
  summary: string;
  approvedRecommendations: ProfileRecommendation[];
}> {
  const store = await loadProfileStore();
  store.lastReviewAt = Date.now();
  store.pastRecommendations = [
    ...(store.pastRecommendations || []),
    ...(currentSession.recommendations || []).filter(r => r.approved),
  ];
  await saveProfileStore(store);
  
  const approved = (currentSession.recommendations || []).filter(r => r.approved);
  
  const summary = [
    `## Profile Review Complete`,
    ``,
    `**Session Duration:** ${Math.round((Date.now() - (currentSession.startedAt || Date.now())) / 60000)} minutes`,
    `**Recommendations Generated:** ${currentSession.recommendations?.length || 0}`,
    `**Approved for Implementation:** ${approved.length}`,
    ``,
    approved.length > 0 ? `### Approved Changes` : '',
    ...approved.map(r => `- **${r.type}** (${r.target}): ${r.suggestedValue.substring(0, 100)}...`),
  ].filter(Boolean).join('\n');
  
  currentSession = { status: 'completed' };
  
  return { summary, approvedRecommendations: approved };
}

/**
 * Reset the review session
 */
export function resetReviewSession(): void {
  currentSession = { status: 'not_started' };
}

/**
 * Get data for comparison (achievements not in LinkedIn/CV)
 */
export async function getUnrepresentedAchievements(): Promise<{
  achievements: Achievement[];
  message: string;
}> {
  const achievements = currentSession.achievements || await getAchievements();
  
  // Get recent high-impact achievements (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  const recent = achievements.filter(a => {
    const date = new Date(a.date);
    return date >= sixMonthsAgo;
  });
  
  // Filter to significant achievements
  const significant = recent.filter(a => 
    a.impact || 
    a.category === 'leadership' || 
    a.category === 'technical' ||
    a.source === 'github_pr' ||
    a.source === 'tech_document'
  );
  
  return {
    achievements: significant,
    message: `Found ${significant.length} significant achievements from the last 6 months that should be reflected in your profile.`,
  };
}

/**
 * Format achievements for LinkedIn/CV context
 */
export function formatAchievementsForProfile(achievements: Achievement[]): string {
  if (achievements.length === 0) {
    return 'No recent achievements to highlight.';
  }
  
  const byCategory: Record<string, Achievement[]> = {};
  for (const a of achievements) {
    byCategory[a.category] = byCategory[a.category] || [];
    byCategory[a.category].push(a);
  }
  
  const lines: string[] = ['### Achievements to Consider for Profile', ''];
  
  for (const [category, achs] of Object.entries(byCategory)) {
    lines.push(`**${category.charAt(0).toUpperCase() + category.slice(1)}:**`);
    for (const a of achs.slice(0, 5)) { // Max 5 per category
      const impact = a.impact ? ` - Impact: ${a.impact}` : '';
      lines.push(`- ${a.title} (${a.date})${impact}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Generate suggested headline based on achievements and goals
 */
export async function suggestHeadline(): Promise<string[]> {
  const achievements = currentSession.achievements || await getAchievements();
  const goals = currentSession.pdpGoals || await getPDPGoals();
  
  // Find dominant themes
  const categoryCounts: Record<string, number> = {};
  for (const a of achievements) {
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
  }
  
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);
  
  // Generate suggestions based on top categories
  const suggestions: string[] = [];
  
  if (topCategories.includes('technical')) {
    suggestions.push('Senior Software Engineer | Building Scalable Systems');
  }
  if (topCategories.includes('leadership')) {
    suggestions.push('Tech Lead | Engineering Leadership | Team Growth');
  }
  if (topCategories.includes('delivery')) {
    suggestions.push('Software Engineer | Shipping Products That Matter');
  }
  
  // Add goal-based suggestions
  for (const goal of goals.slice(0, 2)) {
    if (goal.category === 'leadership') {
      suggestions.push(`Aspiring Tech Lead | ${goal.title}`);
    }
  }
  
  return suggestions.length > 0 ? suggestions : [
    'Software Engineer | Passionate About Building Great Products',
    'Developer | Problem Solver | Continuous Learner',
  ];
}


