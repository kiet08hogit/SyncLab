import OpenAI from 'openai';

export const openai = new OpenAI({ maxRetries: 0 });

export const RESEARCH_AGENT = 'agent_research';
