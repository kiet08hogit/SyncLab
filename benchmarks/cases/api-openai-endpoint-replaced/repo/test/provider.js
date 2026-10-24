import http from 'node:http';

/**
 * A local stand-in for the OpenAI API, so the suite runs with no network and
 * no key. `reply(request)` picks the text the model answers with.
 * `reject(request)` may return `{ status, error }` to refuse a request the
 * way the API does.
 */
export async function startProvider({ reply = () => 'ok', reject } = {}) {
  const requests = [];

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = {
      method: req.method,
      path: new URL(req.url, 'http://localhost').pathname,
      body: raw ? JSON.parse(raw) : {},
    };
    requests.push(request);

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    const refusal = reject?.(request);
    if (refusal) {
      send(refusal.status, { error: refusal.error });
      return;
    }

    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };

    if (request.method === 'POST' && request.path === '/v1/chat/completions') {
      send(200, {
        id: `chatcmpl-${requests.length}`,
        object: 'chat.completion',
        created,
        model: request.body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: reply(request) }, finish_reason: 'stop', logprobs: null },
        ],
        usage,
      });
      return;
    }

    if (request.method === 'POST' && request.path === '/v1/edits') {
      send(200, { object: 'edit', created, choices: [{ index: 0, text: reply(request) }], usage });
      return;
    }

    const session = request.path.match(/^\/v1\/agents\/sessions(?:\/([^/]+))?$/);
    if (request.method === 'POST' && session) {
      send(200, {
        id: session[1] ?? `sess_${requests.length}`,
        object: 'agent.session',
        agent: { id: request.body.agent_id ?? 'agent_default', version: 1 },
        created_at: created,
        last_active_at: created,
        environment: request.body.environment ?? { type: 'none' },
        error: null,
        metadata: request.body.metadata ?? {},
        status: 'idle',
      });
      return;
    }

    send(404, {
      error: { message: `Invalid URL (${request.method} ${request.path})`, type: 'invalid_request_error', param: null, code: null },
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** The user text a request carries, whichever endpoint it went to. */
export function userText(request) {
  if (typeof request.body.input === 'string') return request.body.input;
  return request.body.messages.filter((message) => message.role === 'user').at(-1).content;
}
