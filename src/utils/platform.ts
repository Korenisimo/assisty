/**
 * Platform Detection and Feature Flags
 * 
 * Core platform detection utilities for cross-platform compatibility.
 * This module provides OS detection, feature availability flags, and platform-specific paths.
 */

import { platform as osPlatform, homedir, tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export type PlatformName = 'darwin' | 'win32' | 'linux';

export interface FeatureFlags {
  /** Text-to-Speech support */
  tts: boolean;
  /** Speech-to-Text support */
  stt: boolean;
  /** Combined voice features (TTS + STT) */
  voice: boolean;
  /** Cursor IDE integration */
  cursorIntegration: boolean;
  /** Clipboard operations */
  clipboard: boolean;
}

export interface PlatformPaths {
  /** User home directory */
  home: string;
  /** Platform-appropriate config directory */
  config: string;
  /** Temp directory */
  tempDir: string;
}

export interface PlatformInfo {
  /** Whether running on macOS */
  isMacOS: boolean;
  /** Whether running on Windows */
  isWindows: boolean;
  /** Whether running on Linux */
  isLinux: boolean;
  /** Platform name as returned by os.platform() */
  name: PlatformName;
  /** Feature availability flags */
  features: FeatureFlags;
  /** Platform-specific paths */
  paths: PlatformPaths;
}

/**
 * Get the platform-appropriate config directory
 */
function getConfigDir(): string {
  const platform = osPlatform();
  const home = homedir();
  
  switch (platform) {
    case 'win32':
      return process.env.APPDATA || join(home, 'AppData', 'Roaming');
    case 'darwin':
      return join(home, 'Library', 'Application Support');
    case 'linux':
      return process.env.XDG_CONFIG_HOME || join(home, '.config');
    default:
      return join(home, '.config');
  }
}

/**
 * Platform detection singleton with feature flags and paths
 */
export const Platform: PlatformInfo = {
  // OS Detection
  isMacOS: osPlatform() === 'darwin',
  isWindows: osPlatform() === 'win32',
  isLinux: osPlatform() === 'linux',
  
  // Platform name
  name: osPlatform() as PlatformName,
  
  // Feature availability flags
  // Voice features are currently macOS-only (using say/sox/whisper)
  features: {
    tts: osPlatform() === 'darwin',
    stt: osPlatform() === 'darwin',
    voice: osPlatform() === 'darwin',
    cursorIntegration: true,  // Available on all platforms (will be made to work)
    clipboard: true,          // Available on all platforms (will be abstracted)
  },
  
  // Platform-specific paths
  paths: {
    home: homedir(),
    config: getConfigDir(),
    tempDir: tmpdir(),
  }
};

/**
 * Check if a specific feature is available on the current platform
 */
export function isFeatureAvailable(feature: keyof FeatureFlags): boolean {
  return Platform.features[feature];
}

/**
 * Get a user-friendly platform display name
 */
export function getPlatformDisplayName(): string {
  switch (Platform.name) {
    case 'darwin': return 'macOS';
    case 'win32': return 'Windows';
    case 'linux': return 'Linux';
    default: return 'Unknown';
  }
}

/**
 * Get the app-specific config directory, ensuring it's created if needed
 * 
 * @param appName - Application name for subdirectory (default: 'hn-work-assistant')
 * @returns Full path to the config directory
 */
export function getAppConfigDir(appName: string = 'hn-work-assistant'): string {
  return join(Platform.paths.config, appName);
}

/**
 * Get the app config directory, creating it if it doesn't exist
 * 
 * @param appName - Application name for subdirectory (default: 'hn-work-assistant')
 * @returns Full path to the config directory
 */
export function ensureConfigDir(appName: string = 'hn-work-assistant'): string {
  const configDir = getAppConfigDir(appName);
  
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  return configDir;
}

/**
 * Get a list of unavailable features on the current platform
 */
export function getUnavailableFeatures(): string[] {
  const unavailable: string[] = [];
  
  if (!Platform.features.tts) {
    unavailable.push('Text-to-Speech');
  }
  if (!Platform.features.stt) {
    unavailable.push('Voice Commands');
  }
  
  return unavailable;
}

/**
 * Get platform-specific startup message for TUI
 */
export function getPlatformStartupMessage(): string | null {
  const unavailable = getUnavailableFeatures();
  
  if (unavailable.length === 0) {
    return null; // All features available, no special message needed
  }
  
  return `Running on ${getPlatformDisplayName()}. ` +
    `Some features not yet available: ${unavailable.join(', ')}. ` +
    `Core functionality works normally.`;
}
