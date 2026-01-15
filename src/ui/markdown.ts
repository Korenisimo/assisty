// Terminal markdown rendering
import { Marked, MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// Create a marked instance with terminal renderer
const marked = new Marked();

// Configure terminal renderer with nice styling
// Note: markedTerminal types are outdated, cast to MarkedExtension
// Using colors that work in standard terminals (italic often doesn't render)
marked.use(
  markedTerminal({
    // Bold - use actual bold + bright color
    strong: chalk.bold.hex('#FFFFFF'),
    
    // Italic/emphasis - use a distinct color since terminals often don't show italic
    em: chalk.hex('#EBCB8B'),  // Yellow/gold - stands out without needing italic
    
    // Code styling
    code: chalk.hex('#A3BE8C'),
    codespan: chalk.hex('#A3BE8C').bgHex('#3B4252'),
    
    // Heading styling
    heading: chalk.hex('#88C0D0').bold,
    firstHeading: chalk.hex('#88C0D0').bold.underline,
    
    // Link styling
    href: chalk.hex('#5E81AC').underline,
    link: chalk.hex('#81A1C1'),
    
    // List styling
    listitem: chalk.hex('#ECEFF4'),
    
    // Blockquote - use color instead of italic
    blockquote: chalk.hex('#616E88'),
    
    // Horizontal rule
    hr: chalk.hex('#4C566A'),
    
    // Table styling
    table: chalk.hex('#D8DEE9'),
    tableOptions: {
      chars: {
        top: '─',
        'top-mid': '┬',
        'top-left': '┌',
        'top-right': '┐',
        bottom: '─',
        'bottom-mid': '┴',
        'bottom-left': '└',
        'bottom-right': '┘',
        left: '│',
        'left-mid': '├',
        mid: '─',
        'mid-mid': '┼',
        right: '│',
        'right-mid': '┤',
        middle: '│',
      },
    },
    
    // Width for wrapping
    width: 100,
    
    // Paragraph styling
    paragraph: chalk.hex('#ECEFF4'),
    
    // Emoji support
    emoji: true,
    
    // Don't show link references at the bottom
    reflowText: true,
    
    // Tab size
    tab: 2,
  }) as MarkedExtension
);

/**
 * Render markdown text for terminal display
 */
export function renderMarkdown(text: string): string {
  try {
    // Parse and render
    let rendered = marked.parse(text);
    rendered = typeof rendered === 'string' ? rendered : '';
    
    // Fallback: catch any remaining *text* patterns that the parser missed
    // This handles cases where markdown parser doesn't process emphasis in certain contexts
    // Match *text* but not **text** (bold) and not * at start of line (list)
    rendered = rendered.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, content) => {
      // Apply yellow/gold color to emphasis text
      return chalk.hex('#EBCB8B')(content);
    });
    
    // Also catch **text** for bold that might have been missed
    rendered = rendered.replace(/\*\*([^*\n]+)\*\*/g, (_, content) => {
      return chalk.bold.hex('#FFFFFF')(content);
    });
    
    // Clean up extra newlines at the end
    return rendered.trimEnd();
  } catch {
    // If rendering fails, return original text
    return text;
  }
}

/**
 * Render markdown with indentation for assistant responses
 */
export function renderAssistantResponse(text: string, indent: string = '  '): string {
  const rendered = renderMarkdown(text);
  
  // Add indentation to each line
  return rendered
    .split('\n')
    .map(line => indent + line)
    .join('\n');
}

