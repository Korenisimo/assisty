// Markdown to Blessed tags converter
// Converts markdown to blessed.js compatible tags for TUI display

// ANSI escape code regex - comprehensive pattern
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

// Blessed tags regex - matches {tagname} and {/tagname}
const BLESSED_TAG_REGEX = /\{[^}]+\}/g;

/**
 * Strip ANSI escape codes from text
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Strip blessed tags from text to get visual length
 */
export function stripBlessedTags(text: string): string {
  return text.replace(BLESSED_TAG_REGEX, '');
}

/**
 * Get visual width of text (excluding blessed tags and ANSI codes)
 */
export function getVisualWidth(text: string): number {
  return stripBlessedTags(stripAnsi(text)).length;
}

/**
 * Wrap a line of text to fit within maxWidth, preserving blessed tags
 * Handles long URLs by breaking them at appropriate points
 */
export function wrapLine(text: string, maxWidth: number): string[] {
  if (getVisualWidth(text) <= maxWidth) {
    return [text];
  }

  const lines: string[] = [];
  let currentLine = '';
  let currentVisualWidth = 0;
  
  // Track open tags to reopen them on new lines
  const openTags: string[] = [];
  
  // Split by spaces for word wrapping
  const words = text.split(/(\s+)/);
  
  for (const word of words) {
    // Check for tags in this word
    const tagMatches = word.match(BLESSED_TAG_REGEX) || [];
    const visualWord = stripBlessedTags(word);
    const wordVisualWidth = visualWord.length;
    
    // Track tag state
    for (const tag of tagMatches) {
      if (tag.startsWith('{/')) {
        // Closing tag - remove from open tags
        const tagName = tag.slice(2, -1);
        const idx = openTags.lastIndexOf(`{${tagName}}`);
        if (idx !== -1) openTags.splice(idx, 1);
      } else {
        // Opening tag
        openTags.push(tag);
      }
    }
    
    // Handle very long words (like URLs) by breaking them
    if (wordVisualWidth > maxWidth * 0.8) {
      // If we have content on the current line, flush it first
      if (currentLine.length > 0) {
        let closingTags = '';
        for (let i = openTags.length - 1; i >= 0; i--) {
          const tag = openTags[i];
          const tagName = tag.slice(1, -1).split('-')[0];
          closingTags += `{/${tagName}}`;
        }
        lines.push(currentLine + closingTags);
        currentLine = openTags.join('');
        currentVisualWidth = 0;
      }
      
      // Break the long word into chunks
      const chunkSize = Math.floor(maxWidth * 0.9);
      let remainingWord = word;
      
      while (remainingWord.length > 0) {
        const visualRemaining = stripBlessedTags(remainingWord);
        
        if (visualRemaining.length <= chunkSize) {
          currentLine += remainingWord;
          currentVisualWidth += visualRemaining.length;
          break;
        }
        
        // Find a good break point in the chunk
        let breakPoint = chunkSize;
        const chunk = visualRemaining.substring(0, chunkSize);
        
        // Try to break at URL-friendly points: /, ?, &, =
        const breakChars = ['/', '?', '&', '=', '-', '_'];
        for (let i = chunk.length - 1; i > chunk.length * 0.6; i--) {
          if (breakChars.includes(chunk[i])) {
            breakPoint = i + 1;
            break;
          }
        }
        
        // Extract the chunk (accounting for blessed tags)
        let extractedChunk = '';
        let visualCount = 0;
        let i = 0;
        
        while (i < remainingWord.length && visualCount < breakPoint) {
          if (remainingWord[i] === '{') {
            // Copy the entire tag
            const tagEnd = remainingWord.indexOf('}', i);
            if (tagEnd !== -1) {
              extractedChunk += remainingWord.substring(i, tagEnd + 1);
              i = tagEnd + 1;
              continue;
            }
          }
          extractedChunk += remainingWord[i];
          visualCount++;
          i++;
        }
        
        // Add chunk to lines
        let closingTags = '';
        for (let j = openTags.length - 1; j >= 0; j--) {
          const tag = openTags[j];
          const tagName = tag.slice(1, -1).split('-')[0];
          closingTags += `{/${tagName}}`;
        }
        lines.push(currentLine + extractedChunk + closingTags);
        
        // Continue with remaining
        currentLine = openTags.join('') + '  '; // Indent continuation
        currentVisualWidth = 2;
        remainingWord = remainingWord.substring(i);
      }
      
      continue;
    }
    
    // Check if word fits on current line
    if (currentVisualWidth + wordVisualWidth > maxWidth && currentLine.length > 0) {
      // Close all open tags before line break
      let closingTags = '';
      for (let i = openTags.length - 1; i >= 0; i--) {
        const tag = openTags[i];
        const tagName = tag.slice(1, -1).split('-')[0]; // Get base tag name
        closingTags += `{/${tagName}}`;
      }
      lines.push(currentLine + closingTags);
      
      // Start new line with reopened tags
      currentLine = openTags.join('') + word;
      currentVisualWidth = wordVisualWidth;
    } else {
      currentLine += word;
      currentVisualWidth += wordVisualWidth;
    }
  }
  
  // Add remaining content
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Convert markdown to blessed.js tags
 * Simple conversion that works with blessed's tag system
 */
export function markdownToBlessed(text: string): string {
  // First strip any ANSI codes that might leak in
  let result = stripAnsi(text);
  
  // Headers - convert ### Header to bold with spacing
  result = result.replace(/^### (.+)$/gm, '\n{bold}$1{/bold}');
  result = result.replace(/^## (.+)$/gm, '\n{bold}{cyan-fg}$1{/cyan-fg}{/bold}');
  result = result.replace(/^# (.+)$/gm, '\n{bold}{cyan-fg}$1{/cyan-fg}{/bold}');
  
  // Bold - **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/bold}');
  result = result.replace(/__([^_]+)__/g, '{bold}$1{/bold}');
  
  // Italic - *text* or _text_ (but not inside words or after :)
  result = result.replace(/(?<![*:\w])\*([^*\n]+)\*(?!\*)/g, '$1');
  result = result.replace(/(?<![_\w])_([^_\n]+)_(?!_)/g, '$1');
  
  // Inline code - `code` - subtle styling
  result = result.replace(/`([^`]+)`/g, '{cyan-fg}$1{/cyan-fg}');
  
  // Links - [text](url) - styled without OSC 8 escape sequences (those cause rendering artifacts)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '{blue-fg}{underline}$1{/underline}{/blue-fg}');
  
  // List items - clean bullets with spacing
  result = result.replace(/^(\s*)\* /gm, '$1  • ');
  result = result.replace(/^(\s*)- /gm, '$1  • ');
  
  // Numbered lists - subtle numbering
  result = result.replace(/^(\s*)(\d+)\. /gm, '$1  $2. ');
  
  // Blockquotes - subtle border
  result = result.replace(/^> (.+)$/gm, '  {gray-fg}│{/gray-fg} $1');
  
  // Horizontal rules - minimal
  result = result.replace(/^---+$/gm, '');
  result = result.replace(/^\*\*\*+$/gm, '');
  
  // Code blocks - clean display
  result = result.replace(/```[\w]*\n([\s\S]*?)```/g, '\n{gray-fg}┌─────{/gray-fg}\n$1{gray-fg}└─────{/gray-fg}\n');
  
  // Emoji indicators for common patterns
  result = result.replace(/⚠️/g, '{yellow-fg}⚠{/yellow-fg}');
  result = result.replace(/✅/g, '{green-fg}✓{/green-fg}');
  result = result.replace(/❌/g, '{red-fg}✗{/red-fg}');
  result = result.replace(/📝/g, '{cyan-fg}📝{/cyan-fg}');
  result = result.replace(/🔍/g, '{cyan-fg}🔍{/cyan-fg}');
  
  return result;
}
