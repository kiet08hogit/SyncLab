import { openai, RESEARCH_AGENT } from './client.js';

const DEFAULT_BUDGET_CENTS = 500;

/** Starts a research session for a support ticket, capped at a budget in USD cents. */
export async function startResearch(question, { ticket, budgetCents = DEFAULT_BUDGET_CENTS } = {}) {
  if (!question.trim()) throw new Error('a research question is required');

  const session = await openai.beta.agents.sessions.create({
    agent_id: RESEARCH_AGENT,
    environment: { type: 'none' },
    input: question.trim(),
    metadata: ticket ? { ticket } : {},
    spend_control: { limit: budgetCents },
  });

  return { sessionId: session.id, agentId: session.agent.id };
}
