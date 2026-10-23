import { openai, RESEARCH_AGENT } from './client.js';

/** Starts a research session for a support ticket. */
export async function startResearch(question, { ticket } = {}) {
  if (!question.trim()) throw new Error('a research question is required');

  const session = await openai.beta.agents.sessions.create({
    agent_id: RESEARCH_AGENT,
    environment: { type: 'none' },
    input: question.trim(),
    metadata: ticket ? { ticket } : {},
  });

  return { sessionId: session.id, agentId: session.agent.id };
}
