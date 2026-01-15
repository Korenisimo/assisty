// Multi-line prompt support using temp file + editor

import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EditorService } from '../../utils/platform/index.js';

// Open editor for multi-line input
export async function openEditorForPrompt(initialContent: string = ''): Promise<string> {
  const tmpFile = join(tmpdir(), `hn-prompt-${Date.now()}.md`);
  
  // Write initial content with instructions
  const template = `${initialContent}
# ─────────────────────────────────────────────────────────
# Write your prompt above this line.
# Save and close the editor when done.
# Lines starting with # will be ignored.
# ─────────────────────────────────────────────────────────
`;
  
  writeFileSync(tmpFile, template, 'utf-8');
  
  try {
    // Use EditorService for platform-aware editor opening
    await EditorService.openFile(tmpFile);
    
    // Read the result
    const content = readFileSync(tmpFile, 'utf-8');
    unlinkSync(tmpFile);
    
    // Remove comment lines and trim
    const lines = content.split('\n');
    const promptLines = lines.filter(line => !line.startsWith('#'));
    return promptLines.join('\n').trim();
  } catch (error) {
    // Clean up temp file on error
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
    throw new Error(`Editor failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Read multi-line input until delimiter (for /paste command)
export async function readUntilDelimiter(
  readline: { question: (prompt: string) => Promise<string> },
  delimiter: string = '---END---'
): Promise<string> {
  const lines: string[] = [];
  
  console.log(`  Enter your text (type "${delimiter}" on a new line when done):`);
  console.log();
  
  while (true) {
    const line = await readline.question('  ');
    
    if (line.trim() === delimiter) {
      break;
    }
    
    lines.push(line);
  }
  
  return lines.join('\n').trim();
}




