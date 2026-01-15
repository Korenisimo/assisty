// AI Model Configuration
// Centralized configuration for different AI use cases

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PersonalityConfig, CharacterConfig } from './types.js';

/**
 * Model for standard assistant interactions (chat, analysis)
 * Uses a balanced model for cost/performance
 */
export const STANDARD_MODEL = 'gemini-3-flash-preview';

/**
 * Model for external communications (Slack, JIRA, etc.)
 * Uses the best available model for high-quality, professional output
 * These are customer-facing or team-facing and need to be excellent
 */
export const EXTERNAL_COMMS_MODEL = 'gemini-3-pro-preview';

/**
 * Get Gemini AI instance
 */
let genAI: GoogleGenerativeAI | null = null;

export function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Get personality context for external communications
 * This ensures the assistant maintains its personality when posting to Slack/JIRA
 */
export function getPersonalityContext(personality: PersonalityConfig, character: CharacterConfig): string {
  const characterDescriptions: Record<string, string> = {
    'monica': `You embody Monica Geller's organized, enthusiastic personality—be helpful and thorough.`,
    'chandler': `You have Chandler Bing's wit—keep it professional but add subtle humor where appropriate.`,
    'dwight': `Channel Dwight Schrute's intensity—be direct, thorough, and take the task seriously.`,
    'ron': `Follow Ron Swanson's philosophy—be efficient, direct, and minimize unnecessary words.`,
    'none': '',
  };

  const characterNote = character.type === 'custom' && character.customDescription
    ? character.customDescription
    : characterDescriptions[character.type] || '';

  const personalityNote = 
    personality.type === 'proactive' ? 'Be proactive and helpful.' :
    personality.type === 'minimal' ? 'Be concise and to the point.' :
    '';

  const verbosityNote = 
    personality.verbosity === 'concise' ? 'Keep responses brief and clear.' : '';

  const parts = [characterNote, personalityNote, verbosityNote].filter(p => p);
  
  return parts.length > 0 
    ? `PERSONALITY: ${parts.join(' ')} Always be friendly and self-aware.`
    : 'PERSONALITY: Be friendly, helpful, and self-aware.';
}

/**
 * Create a model instance for external communications
 * @param temperature - Temperature setting for the model (default: 0.3)
 * @param modelOverride - Override the default model (optional)
 */
export function createExternalCommsModel(temperature: number = 0.3, modelOverride?: string) {
  const ai = getGenAI();
  return ai.getGenerativeModel({
    model: modelOverride || EXTERNAL_COMMS_MODEL,
    generationConfig: {
      temperature,
    },
  });
}

/**
 * Create a model instance for standard interactions
 * @param temperature - Temperature setting for the model (default: 0.3)
 * @param modelOverride - Override the default model (optional)
 */
export function createStandardModel(temperature: number = 0.3, modelOverride?: string) {
  const ai = getGenAI();
  return ai.getGenerativeModel({
    model: modelOverride || STANDARD_MODEL,
    generationConfig: {
      temperature,
    },
  });
}

