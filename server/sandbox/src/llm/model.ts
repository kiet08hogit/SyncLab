import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { requireGeminiKey, type LlmConfig } from '../config.js';

export function createGeminiModel(llm: LlmConfig): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: llm.model,
    apiKey: requireGeminiKey(),
    // Temperature is deliberately left unset. Gemini 3 defaults to 1.0 and
    // Google reports that lowering it degrades reasoning on complex tasks.
  });
}

export function createOllamaModel(llm: LlmConfig, maxOutputTokens: number): ChatOllama {
  return new ChatOllama({
    model: llm.model,
    baseUrl: llm.baseUrl,
    // Ollama's default context is a few thousand tokens and it truncates the
    // prompt silently past that. A whole file goes in and comes back out, so
    // the window has to hold both.
    numCtx: llm.numCtx,
    // A local model that loses track of where the file ends keeps writing
    // until the context is full, which can outlast the phase timeout.
    numPredict: maxOutputTokens,
    // Unlike Gemini 3, small local models drift at high temperatures.
    temperature: 0,
  });
}
