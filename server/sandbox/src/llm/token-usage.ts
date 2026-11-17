// Each sandbox process runs one phase. Keep only numeric provider usage, never prompts or replies.
let input = 0;
let output = 0;
let observed = false;

export function recordTokenUsage(inputTokens: unknown, outputTokens: unknown): void {
  for (const [direction, value] of [['input', inputTokens], ['output', outputTokens]] as const) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) continue;
    observed = true;
    if (direction === 'input') input += value;
    else output += value;
  }
}

export function tokenUsage(): { input: number; output: number } | undefined {
  return observed ? { input, output } : undefined;
}
