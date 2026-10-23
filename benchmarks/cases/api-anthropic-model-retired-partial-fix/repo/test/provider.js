import http from 'node:http';

/**
 * A local stand-in for the Anthropic API, so the suite runs with no network
 * and no key. `reply(request)` picks the text the model answers with.
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
      send(refusal.status, { type: 'error', error: refusal.error });
      return;
    }

    if (request.method === 'POST' && request.path === '/v1/messages') {
      send(200, {
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: request.body.model,
        content: [{ type: 'text', text: reply(request) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
      return;
    }

    if (request.method === 'POST' && request.path === '/v1/complete') {
      send(200, {
        id: `compl_${requests.length}`,
        type: 'completion',
        completion: ` ${reply(request)}`,
        stop_reason: 'stop_sequence',
        model: request.body.model,
      });
      return;
    }

    send(404, { type: 'error', error: { type: 'not_found_error', message: `${request.method} ${request.path}` } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** The text of the last user turn, whichever endpoint the request went to. */
export function userText(request) {
  if (typeof request.body.prompt === 'string') {
    return request.body.prompt.split('\n\nHuman:').pop().split('\n\nAssistant:')[0].trim();
  }
  const last = request.body.messages.at(-1).content;
  return typeof last === 'string' ? last : last.map((block) => block.text ?? '').join('');
}
