#!/usr/bin/env node
/**
 * Quickdraw CLI — benchmark LLM streaming from the command line.
 * Usage: quickdraw --provider openai --model gpt-4o-mini --prompt "Hello world"
 */
async function main() {
  console.log('[quickdraw] CLI stub — benchmark LLM streaming');
  console.log('[quickdraw] Usage: quickdraw --provider openai --model gpt-4o-mini --prompt "..."');
  process.exit(0);
}

main().catch((err) => {
  console.error('[quickdraw] Fatal:', err);
  process.exit(1);
});
