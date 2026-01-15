// Character creation tool for the Work Mode assistant

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  getCustomCharacters,
  saveCharacter,
  deleteCharacter,
  characterExists,
  type CustomCharacter,
} from '../storage/characters.js';

/**
 * Create a character creation tool
 * The assistant can use this to create new characters based on web search
 */
export function createCharacterCreationTool() {
  return new DynamicStructuredTool({
    name: 'create_character',
    description: `Create a new character persona that can be used by the assistant.
    
Use this when the user asks you to add a character (e.g., "add Hermione from Harry Potter").

Steps to create a character:
1. First, use the web_search tool to research the character
2. Gather information about their personality, mannerisms, catchphrases, quirks
3. Then call this tool with a detailed description

The description should be in the same format as existing characters:
- Start with "You ARE [character name] from [source]"
- List their key personality traits with bullet points
- Include example phrases they would say
- End with "IMPORTANT: Still complete tasks accurately and helpfully..."`,
    schema: z.object({
      name: z.string().describe('Full character name (e.g., "Hermione Granger")'),
      source: z.string().describe('Where the character is from (e.g., "Harry Potter series")'),
      description: z.string().describe(`Full personality description for the system prompt. Should be detailed and include:
- Who they are and their background
- Personality traits and quirks
- How they speak and act
- Example phrases they would say
- Note that they should still be helpful while staying in character`),
      traits: z.array(z.string()).optional().describe('Optional list of quick personality traits'),
    }),
    func: async ({ name, source, description, traits }) => {
      try {
        // Check if character already exists
        const exists = await characterExists(name);
        if (exists) {
          return `Character "${name}" already exists. Use list_characters to see all characters, or choose a different name.`;
        }
        
        // Save the character
        const character = await saveCharacter(name, description, source, 'assistant', traits);
        
        return `Successfully created character "${name}" from ${source}!

Character ID: ${character.id}

The user can now select this character with the /character command.
Tell the user the character has been created and how to use it.`;
      } catch (error) {
        return `Error creating character: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    },
  });
}

/**
 * Create a character listing tool
 */
export function createCharacterListTool() {
  return new DynamicStructuredTool({
    name: 'list_characters',
    description: 'List all available custom characters that have been created',
    schema: z.object({}),
    func: async () => {
      const characters = await getCustomCharacters();
      
      if (characters.length === 0) {
        return 'No custom characters have been created yet.';
      }
      
      const lines = [`Found ${characters.length} custom character(s):\n`];
      for (const char of characters) {
        lines.push(`- ${char.name} (from ${char.source})`);
        lines.push(`  ID: ${char.id}`);
        if (char.traits) {
          lines.push(`  Traits: ${char.traits.join(', ')}`);
        }
        lines.push(`  Created: ${new Date(char.createdAt).toLocaleDateString()}`);
        lines.push('');
      }
      
      return lines.join('\n');
    },
  });
}

/**
 * Create a character deletion tool
 */
export function createCharacterDeleteTool() {
  return new DynamicStructuredTool({
    name: 'delete_character',
    description: 'Delete a custom character by name',
    schema: z.object({
      name: z.string().describe('Name of the character to delete'),
    }),
    func: async ({ name }) => {
      const characters = await getCustomCharacters();
      const character = characters.find(c => c.name.toLowerCase() === name.toLowerCase());
      
      if (!character) {
        return `Character "${name}" not found. Use list_characters to see available characters.`;
      }
      
      const deleted = await deleteCharacter(character.id);
      if (deleted) {
        return `Successfully deleted character "${character.name}".`;
      } else {
        return `Failed to delete character "${name}".`;
      }
    },
  });
}

/**
 * Get all character tools
 */
export function getCharacterTools() {
  return [
    createCharacterCreationTool(),
    createCharacterListTool(),
    createCharacterDeleteTool(),
  ];
}


