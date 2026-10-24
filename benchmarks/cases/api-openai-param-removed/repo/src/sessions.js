import { openai } from './client.js';

/** Links a running session to the ticket it now belongs to. */
export async function moveSession(sessionId, ticket) {
  const session = await openai.beta.agents.sessions.update(sessionId, { metadata: { ticket } });
  return session.metadata.ticket;
}
