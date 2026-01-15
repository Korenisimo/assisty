/**
 * Platform Abstraction Layer - Public API
 * 
 * Re-exports all platform utilities for convenient importing.
 * Import from this module to access platform detection and services.
 * 
 * @example
 * import { Platform, isFeatureAvailable, getPlatformDisplayName } from '../utils/platform/index.js';
 * 
 * if (Platform.isWindows) {
 *   // Windows-specific code
 * }
 * 
 * if (isFeatureAvailable('voice')) {
 *   // Voice features available
 * }
 */

// Re-export main platform utilities
export {
  Platform,
  isFeatureAvailable,
  getPlatformDisplayName,
  getAppConfigDir,
  ensureConfigDir,
  getUnavailableFeatures,
  getPlatformStartupMessage,
} from '../platform.js';

// Re-export types
export type {
  PlatformName,
  PlatformInfo,
  FeatureFlags,
  PlatformPaths,
} from '../platform.js';

// Re-export service interface types (with Interface suffix to avoid conflicts with implementations)
export type {
  ClipboardService as ClipboardServiceInterface,
  ShellService as ShellServiceInterface,
  EditorService as EditorServiceInterface,
  BrowserService as BrowserServiceInterface,
  TerminalService as TerminalServiceInterface,
  VoiceService as VoiceServiceInterface,
  CursorService as CursorServiceInterface,
} from './types.js';

// Re-export service implementations
export { ClipboardService } from './clipboard.js';
export { BrowserService } from './browser.js';
export { ShellService } from './shell.js';
export { EditorService } from './editor.js';
export { TerminalService } from './terminal.js';
