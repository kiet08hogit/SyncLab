import Anthropic from '@anthropic-ai/sdk';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { requireAnthropicKey, requireGeminiKey, type LlmConfig } from '../config.js';

export function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireAnthropicKey() });
}

export function createGeminiModel(llm: LlmConfig): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: llm.model,
    apiKey: requireGeminiKey(),
    // Temperature is deliberately left unset. Gemini 3 defaults to 1.0 and
    // Google reports that lowering it degrades reasoning on complex tasks.
  });
}
