// Session preferences for Work Mode assistant
// Stores user's preferred settings between sessions

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { PersonalityType } from '../types.js';
import { ensureConfigDir as ensurePlatformConfigDir } from '../../utils/platform.js';

export interface SessionPreferences {
  personality: PersonalityType;
  characterType: 'builtin' | 'custom' | 'none';
  characterId?: string; // For custom characters, stores the character ID
  builtinCharacter?: string; // For builtin characters (dee, chandler, etc.)
  datadogEnabled: boolean;
  // LinkedIn & CV
  linkedinUrl?: string;
  cvPath?: string; // Path to CV file (PDF/DOC)
}

// Get the preferences store path (uses platform-appropriate config directory)
function getPreferencesPath(): string {
  const configDir = ensurePlatformConfigDir();
  return join(configDir, 'preferences.json');
}

// Ensure config directory exists (delegates to platform utils)
async function ensureConfigDir(): Promise<void> {
  ensurePlatformConfigDir();
}

// Load preferences
async function loadPreferences(): Promise<SessionPreferences> {
  const prefsPath = getPreferencesPath();
  
  if (!existsSync(prefsPath)) {
    return {
      personality: 'proactive',
      characterType: 'none',
      datadogEnabled: true,
    };
  }
  
  try {
    const content = await readFile(prefsPath, 'utf-8');
    return JSON.parse(content) as SessionPreferences;
  } catch {
    return {
      personality: 'proactive',
      characterType: 'none',
      datadogEnabled: true,
    };
  }
}

// Save preferences
async function savePreferences(prefs: SessionPreferences): Promise<void> {
  await ensureConfigDir();
  const prefsPath = getPreferencesPath();
  await writeFile(prefsPath, JSON.stringify(prefs, null, 2));
}

// ===== PUBLIC API =====

/**
 * Get current session preferences
 */
export async function getSessionPreferences(): Promise<SessionPreferences> {
  return await loadPreferences();
}

/**
 * Update personality preference
 */
export async function setPersonalityPreference(personality: PersonalityType): Promise<void> {
  const prefs = await loadPreferences();
  prefs.personality = personality;
  await savePreferences(prefs);
}

/**
 * Update character preference
 */
export async function setCharacterPreference(
  characterType: 'builtin' | 'custom' | 'none',
  characterId?: string,
  builtinCharacter?: string
): Promise<void> {
  const prefs = await loadPreferences();
  prefs.characterType = characterType;
  prefs.characterId = characterId;
  prefs.builtinCharacter = builtinCharacter;
  await savePreferences(prefs);
}

/**
 * Update datadog preference
 */
export async function setDatadogPreference(enabled: boolean): Promise<void> {
  const prefs = await loadPreferences();
  prefs.datadogEnabled = enabled;
  await savePreferences(prefs);
}

/**
 * Reset preferences to defaults
 */
export async function resetPreferences(): Promise<void> {
  await savePreferences({
    personality: 'proactive',
    characterType: 'none',
    datadogEnabled: true,
  });
}

/**
 * Set LinkedIn URL
 */
export async function setLinkedInUrl(url: string): Promise<void> {
  const prefs = await loadPreferences();
  prefs.linkedinUrl = url;
  await savePreferences(prefs);
}

/**
 * Get LinkedIn URL
 */
export async function getLinkedInUrl(): Promise<string | undefined> {
  const prefs = await loadPreferences();
  return prefs.linkedinUrl;
}

/**
 * Set CV path
 */
export async function setCvPath(path: string): Promise<void> {
  const prefs = await loadPreferences();
  prefs.cvPath = path;
  await savePreferences(prefs);
}

/**
 * Get CV path
 */
export async function getCvPath(): Promise<string | undefined> {
  const prefs = await loadPreferences();
  return prefs.cvPath;
}

