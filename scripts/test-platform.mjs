/**
 * Quick platform utilities test script
 * Verifies Windows compatibility implementation
 */

import { Platform, getPlatformDisplayName, isFeatureAvailable, getAppConfigDir, getUnavailableFeatures, getPlatformStartupMessage } from '../dist/utils/platform.js';
import { ClipboardService } from '../dist/utils/platform/clipboard.js';
import { ShellService } from '../dist/utils/platform/shell.js';
import { TerminalService } from '../dist/utils/platform/terminal.js';

console.log('=== Platform Detection Test ===\n');

console.log('Platform Info:');
console.log(`  Display name: ${getPlatformDisplayName()}`);
console.log(`  Platform name: ${Platform.name}`);
console.log(`  isWindows: ${Platform.isWindows}`);
console.log(`  isMacOS: ${Platform.isMacOS}`);
console.log(`  isLinux: ${Platform.isLinux}`);
console.log('');

console.log('Paths:');
console.log(`  Home: ${Platform.paths.home}`);
console.log(`  Config: ${Platform.paths.config}`);
console.log(`  Temp: ${Platform.paths.tempDir}`);
console.log(`  App config dir: ${getAppConfigDir()}`);
console.log('');

console.log('Feature Flags:');
console.log(`  Voice: ${isFeatureAvailable('voice')}`);
console.log(`  TTS: ${isFeatureAvailable('tts')}`);
console.log(`  STT: ${isFeatureAvailable('stt')}`);
console.log(`  Clipboard: ${isFeatureAvailable('clipboard')}`);
console.log(`  Cursor Integration: ${isFeatureAvailable('cursorIntegration')}`);
console.log('');

console.log('Unavailable features:', getUnavailableFeatures());
console.log('Startup message:', getPlatformStartupMessage() || '(none - all features available)');
console.log('');

console.log('=== Shell Service Test ===\n');
console.log(`  Default shell: ${ShellService.getDefaultShell()}`);
console.log(`  Preferred shell: ${ShellService.getPreferredShell()}`);
console.log(`  Path separator: "${ShellService.getPathSeparator()}"`);
console.log(`  Command exists (node): ${ShellService.commandExists('node')}`);
console.log(`  Command exists (powershell): ${ShellService.commandExists('powershell')}`);
console.log(`  Normalize path: ${ShellService.normalizePath('/some/unix/path')}`);
console.log('');

console.log('=== Terminal Service Test ===\n');
console.log(`  Supports color: ${TerminalService.supportsColor()}`);
console.log(`  Supports unicode: ${TerminalService.supportsUnicode()}`);
console.log(`  Terminal type: ${TerminalService.getTerminalType()}`);
console.log(`  Is Windows Terminal: ${TerminalService.isWindowsTerminal()}`);
console.log(`  Is VS Code Terminal: ${TerminalService.isVSCodeTerminal()}`);
console.log(`  Recommended terminal: ${TerminalService.getRecommendedTerminal()}`);
console.log('');

console.log('Terminal Info:', TerminalService.getTerminalInfo());
console.log('');

console.log('=== Clipboard Service Test ===\n');
const testText = 'Hello from Assist CLI - Windows Test ' + Date.now();
console.log(`  Clipboard available: ${ClipboardService.isAvailable()}`);
console.log(`  Test: copying "${testText}" to clipboard...`);

try {
  const copyResult = await ClipboardService.copy(testText);
  console.log(`  Copy result: ${copyResult}`);
  
  if (copyResult) {
    const pasteResult = await ClipboardService.paste();
    console.log(`  Paste result: "${pasteResult}"`);
    console.log(`  Clipboard test: ${pasteResult === testText ? 'PASSED ✓' : 'FAILED ✗'}`);
  }
} catch (error) {
  console.log(`  Clipboard test error: ${error.message}`);
}

console.log('\n=== All Tests Complete ===');
