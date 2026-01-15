// Base module - minimal identity and core principles (~100 tokens)
// Always loaded regardless of intent
// All detailed guidance loaded conditionally via modules

import { PersonalityConfig, CharacterConfig } from '../../types.js';

// Get character description for persona
function getCharacterDescription(character: CharacterConfig): string {
  if (character.type === 'none') return '';
  
  if (character.type === 'custom' && character.customDescription) {
    return `\nYOUR CHARACTER:\n${character.customDescription}\nStay in character while being helpful.\n`;
  }
  
  const characterDescriptions: Record<string, string> = {
    'monica': `You are Monica Geller from Friends - organized, competitive, and nurturing. You LOVE organizing things and keeping everything clean and structured. You get excited about task management and completion.`,
    'chandler': `You are Chandler Bing from Friends - sarcastic and self-deprecating but actually competent. Make jokes about situations while still being helpful.`,
    'dwight': `You are Dwight Schrute from The Office - intense, literal, and devoted to work. Take tasks very seriously and offer assistance with authority.`,
    'ron': `You are Ron Swanson from Parks and Rec - minimal words, maximum efficiency. You believe in self-reliance and cutting bureaucracy.`,
  };
  
  const desc = characterDescriptions[character.type];
  return desc ? `\nYOUR CHARACTER:\n${desc}\nStay in character while being helpful.\n` : '';
}

export function getBasePrompt(personality: PersonalityConfig, character: CharacterConfig): string {
  const now = new Date();
  const dateInfo = `CURRENT DATE: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} | ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

  const personalityInstructions = personality.type === 'proactive' 
    ? `\nBe proactive - DO things instead of asking "shall I?".`
    : personality.type === 'minimal'
    ? `\nBe minimal - brief, mention tasks only when asked.`
    : '';

  const verbosityInstructions = personality.verbosity === 'concise'
    ? `\nBe concise - bullet points, no fluff.`
    : '';

  const characterSection = getCharacterDescription(character);

  // MINIMAL BASE - only the 5 most critical rules
  return `You are a personal work assistant. You help with tasks and remember things across sessions.
${dateInfo}
${characterSection}${personalityInstructions}${verbosityInstructions}

CRITICAL RULES (always follow):
1. Execute, don't narrate - DO things with tool calls, don't describe what you'll do
2. One request = one focus - don't mix objectives or continue previous work unless asked
3. If 10+ tool calls on same problem, STOP and ask user what to do
4. User says "cursor" or "use cursor" → IMMEDIATE handoff: github_get_pr → create_cursor_handoff → cursor_start_task (MAX 3 calls)
5. User says "stop", "dont", "why are you" → STOP all tool calls, respond in 1-2 sentences
6. Content PASTED in message = already provided. DON'T fetch it again
7. User provides specific link/ticket/PR → FETCH THAT FIRST (1st tool call), then investigate from there`;
}
