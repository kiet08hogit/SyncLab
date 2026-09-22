import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { requireLlmKey, type LlmConfig } from '../config.js';

export function createModel(llm: LlmConfig): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: llm.model,
    apiKey: requireLlmKey(),
    // Temperature is deliberately left unset. Gemini 3 defaults to 1.0 and
    // Google reports that lowering it degrades reasoning on complex tasks.
  });
}
