// Web Extractor - LLM-powered DOM extraction for generic web browsing
// Uses Playwright Page API + LLM for intelligent content extraction

import { GoogleGenerativeAI } from '@google/generative-ai';
import { Page } from 'playwright';
import { getWebBrowser } from './web-browser.js';

// Initialize Gemini for extraction
let genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment. Required for web extraction.');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Clean HTML to reduce noise for LLM extraction
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, '') // Remove SVGs
    .replace(/<style[\s\S]*?<\/style>/g, '') // Remove styles
    .replace(/<script[\s\S]*?<\/script>/g, '') // Remove scripts
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/**
 * Extract structured data from HTML using LLM
 */
async function llmExtract<T>(html: string, prompt: string): Promise<T | null> {
  try {
    const ai = getGenAI();
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent extraction
      },
    });

    const cleanedHtml = cleanHtml(html);
    const fullPrompt = `${prompt}

HTML Content:
\`\`\`html
${cleanedHtml.substring(0, 150000)} ${cleanedHtml.length > 150000 ? '... (truncated)' : ''}
\`\`\`

IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no code blocks.`;

    const result = await model.generateContent(fullPrompt);
    const response = result.response.text().trim();

    // Clean up response (remove any markdown artifacts)
    let cleanJson = response;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    }

    return JSON.parse(cleanJson) as T;
  } catch (error) {
    console.error('LLM extraction failed:', error);
    return null;
  }
}

export interface PageElement {
  type: 'button' | 'link' | 'input' | 'textarea' | 'select' | 'other';
  text?: string;
  placeholder?: string;
  value?: string;
  selector?: string;
  description: string; // AI-generated description for easy reference
}

export interface PageContent {
  title: string;
  mainContent: string;
  links: Array<{ text: string; url: string }>;
  buttons: Array<{ text: string; description: string }>;
  forms: Array<{
    fields: Array<{
      label: string;
      type: string;
      name: string;
      required: boolean;
    }>;
  }>;
}

/**
 * Check if the web browser/extractor is ready
 */
export function isWebBrowserReady(): boolean {
  const browser = getWebBrowser();
  return browser.getPage() !== null;
}

/**
 * Read page content using LLM extraction
 */
export async function readPageContent(options?: {
  includeLinks?: boolean;
  includeButtons?: boolean;
  includeForms?: boolean;
}): Promise<{ success: boolean; content?: PageContent; error?: string }> {
  const page = getWebBrowser().getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    // Get page HTML
    const html = await page.content();
    const url = page.url();

    // Build extraction prompt based on options
    let extractionPrompt = `Extract the following from this web page:
- title: The page title
- mainContent: The main text content (article, description, body text - NOT navigation or ads)`;

    if (options?.includeLinks) {
      extractionPrompt += '\n- links: Array of {text, url} for all links in the main content (max 20)';
    }
    if (options?.includeButtons) {
      extractionPrompt += '\n- buttons: Array of {text, description} for all buttons (max 15)';
    }
    if (options?.includeForms) {
      extractionPrompt += '\n- forms: Array of forms with their fields {label, type, name, required}';
    }

    const extracted = await llmExtract<PageContent>(html, extractionPrompt);

    if (!extracted) {
      return {
        success: false,
        error: 'Failed to extract page content',
      };
    }

    return {
      success: true,
      content: extracted,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get interactive elements on the page (buttons, links, inputs)
 */
export async function getInteractiveElements(): Promise<{
  success: boolean;
  elements?: PageElement[];
  error?: string;
}> {
  const page = getWebBrowser().getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    // Get page HTML
    const html = await page.content();

    const prompt = `Extract all interactive elements from this page.
For each element, provide:
- type: 'button', 'link', 'input', 'textarea', 'select', or 'other'
- text: The visible text (for buttons/links)
- placeholder: Placeholder text (for inputs)
- description: A clear description of what this element does or represents

Focus on elements the user can interact with. Limit to 30 most important elements.
Return as JSON array: [{type, text?, placeholder?, description}, ...]`;

    const extracted = await llmExtract<PageElement[]>(html, prompt);

    if (!extracted) {
      return {
        success: false,
        error: 'Failed to extract interactive elements',
      };
    }

    return {
      success: true,
      elements: extracted,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Click an element by description or text
 * Uses LLM to find the best matching element
 */
export async function clickElement(description: string): Promise<{
  success: boolean;
  clickedElement?: string;
  error?: string;
}> {
  const page = getWebBrowser().getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    // Get interactive elements first
    const interactiveResult = await getInteractiveElements();
    if (!interactiveResult.success || !interactiveResult.elements) {
      return { success: false, error: 'Could not find interactive elements' };
    }

    // Use LLM to find the best matching element
    const matchPrompt = `Given this user request: "${description}"

And these available elements:
${JSON.stringify(interactiveResult.elements, null, 2)}

Return the INDEX (0-based) of the element that best matches the user's intent.
Respond with ONLY a number, nothing else.`;

    const ai = getGenAI();
    const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
    const result = await model.generateContent(matchPrompt);
    const indexStr = result.response.text().trim();
    const index = parseInt(indexStr);

    if (isNaN(index) || index < 0 || index >= interactiveResult.elements.length) {
      return { success: false, error: `Could not find element matching: ${description}` };
    }

    const targetElement = interactiveResult.elements[index];

    // Try to click by text content
    if (targetElement.text) {
      try {
        await page.click(`text="${targetElement.text}"`, { timeout: 5000 });
        await page.waitForTimeout(1000);
        return { success: true, clickedElement: targetElement.text };
      } catch {
        // Fall through to other methods
      }
    }

    // Try common button/link selectors
    const selectors = [
      `button:has-text("${targetElement.text}")`,
      `a:has-text("${targetElement.text}")`,
      `input[type="submit"]`,
      `button`,
    ];

    for (const selector of selectors) {
      try {
        await page.click(selector, { timeout: 2000 });
        await page.waitForTimeout(1000);
        return { success: true, clickedElement: targetElement.description };
      } catch {
        // Try next selector
      }
    }

    return {
      success: false,
      error: `Found element "${targetElement.description}" but could not click it`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to click element',
    };
  }
}

/**
 * Fill a form with given field values
 */
export async function fillForm(fields: { [fieldName: string]: string }): Promise<{
  success: boolean;
  filledFields?: string[];
  error?: string;
}> {
  const page = getWebBrowser().getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    const filledFields: string[] = [];

    for (const [fieldName, value] of Object.entries(fields)) {
      // Try multiple strategies to find and fill the field
      const strategies = [
        // By label text
        async () => {
          const input = await page.locator(`label:has-text("${fieldName}") input, label:has-text("${fieldName}") textarea, label:has-text("${fieldName}") select`).first();
          if (await input.isVisible()) {
            await input.fill(value);
            return true;
          }
          return false;
        },
        // By placeholder
        async () => {
          const input = await page.locator(`input[placeholder*="${fieldName}" i], textarea[placeholder*="${fieldName}" i]`).first();
          if (await input.isVisible()) {
            await input.fill(value);
            return true;
          }
          return false;
        },
        // By name attribute
        async () => {
          const input = await page.locator(`input[name*="${fieldName}" i], textarea[name*="${fieldName}" i], select[name*="${fieldName}" i]`).first();
          if (await input.isVisible()) {
            await input.fill(value);
            return true;
          }
          return false;
        },
      ];

      let filled = false;
      for (const strategy of strategies) {
        try {
          if (await strategy()) {
            filledFields.push(fieldName);
            filled = true;
            break;
          }
        } catch {
          // Try next strategy
        }
      }

      if (!filled) {
        return {
          success: false,
          error: `Could not find field: ${fieldName}`,
          filledFields,
        };
      }
    }

    await page.waitForTimeout(500);
    return { success: true, filledFields };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fill form',
    };
  }
}

/**
 * Submit a form (finds and clicks the submit button)
 */
export async function submitForm(): Promise<{ success: boolean; error?: string }> {
  const page = getWebBrowser().getPage();
  if (!page) {
    return { success: false, error: 'Browser not ready' };
  }

  try {
    // Try multiple strategies to find submit button
    const strategies = [
      () => page.click('button[type="submit"]', { timeout: 2000 }),
      () => page.click('input[type="submit"]', { timeout: 2000 }),
      () => page.click('button:has-text("Submit")', { timeout: 2000 }),
      () => page.click('button:has-text("Send")', { timeout: 2000 }),
      () => page.click('button:has-text("Save")', { timeout: 2000 }),
    ];

    for (const strategy of strategies) {
      try {
        await strategy();
        await page.waitForTimeout(1500);
        return { success: true };
      } catch {
        // Try next strategy
      }
    }

    return { success: false, error: 'Could not find submit button' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to submit form',
    };
  }
}


