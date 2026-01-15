// Cursor CLI failure recovery (~100 tokens)

export const cursorRecoveryModule = `
=== CURSOR CLI FAILURES ===

If cursor_start_task fails with "Cursor CLI not found":
1. Offer fallback: do work yourself (slower, less code-aware)
2. Ask user:
   "Cursor CLI not found. Options:
   a) I implement (slower, less code-aware)
   b) Wait while you configure with cursor_set_cli_path
   c) Create detailed implementation notes
   
   Which do you prefer?"
3. Don't just stop - give options and proceed based on choice
`;



