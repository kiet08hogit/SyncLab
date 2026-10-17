export const API_PROVIDERS = ['anthropic', 'openai'] as const;

export type ApiProvider = (typeof API_PROVIDERS)[number];

/** The SDK package each provider ships, and the class it exports for a client. */
export const SDK_PACKAGES: Record<string, { provider: ApiProvider; clientClass: string }> = {
  '@anthropic-ai/sdk': { provider: 'anthropic', clientClass: 'Anthropic' },
  openai: { provider: 'openai', clientClass: 'OpenAI' },
};

export const API_HOSTS: Record<string, ApiProvider> = {
  'api.anthropic.com': 'anthropic',
  'api.openai.com': 'openai',
};

/**
 * SDK method paths, relative to the client, mapped to the HTTP operation they
 * send. Streaming and parsing helpers send the same request as the plain call.
 * A method missing from the table is still recorded, with no operation, so a
 * gap here never hides a usage.
 */
const OPERATIONS: Record<ApiProvider, Record<string, string>> = {
  anthropic: {
    'messages.create': 'POST /v1/messages',
    'messages.stream': 'POST /v1/messages',
    'messages.parse': 'POST /v1/messages',
    'messages.countTokens': 'POST /v1/messages/count_tokens',
    'messages.batches.create': 'POST /v1/messages/batches',
    'messages.batches.retrieve': 'GET /v1/messages/batches/{message_batch_id}',
    'messages.batches.list': 'GET /v1/messages/batches',
    'messages.batches.cancel': 'POST /v1/messages/batches/{message_batch_id}/cancel',
    'messages.batches.delete': 'DELETE /v1/messages/batches/{message_batch_id}',
    'messages.batches.results': 'GET /v1/messages/batches/{message_batch_id}/results',
    'models.list': 'GET /v1/models',
    'models.retrieve': 'GET /v1/models/{model_id}',
    'files.upload': 'POST /v1/files',
    'files.list': 'GET /v1/files',
    'files.retrieveMetadata': 'GET /v1/files/{file_id}',
    'files.download': 'GET /v1/files/{file_id}/content',
    'files.delete': 'DELETE /v1/files/{file_id}',
    'completions.create': 'POST /v1/complete',
  },
  openai: {
    'chat.completions.create': 'POST /v1/chat/completions',
    'chat.completions.stream': 'POST /v1/chat/completions',
    'chat.completions.parse': 'POST /v1/chat/completions',
    'responses.create': 'POST /v1/responses',
    'responses.stream': 'POST /v1/responses',
    'responses.parse': 'POST /v1/responses',
    'responses.retrieve': 'GET /v1/responses/{response_id}',
    'responses.delete': 'DELETE /v1/responses/{response_id}',
    'responses.cancel': 'POST /v1/responses/{response_id}/cancel',
    'completions.create': 'POST /v1/completions',
    'embeddings.create': 'POST /v1/embeddings',
    'moderations.create': 'POST /v1/moderations',
    'images.generate': 'POST /v1/images/generations',
    'images.edit': 'POST /v1/images/edits',
    'images.createVariation': 'POST /v1/images/variations',
    'audio.speech.create': 'POST /v1/audio/speech',
    'audio.transcriptions.create': 'POST /v1/audio/transcriptions',
    'audio.translations.create': 'POST /v1/audio/translations',
    'models.list': 'GET /v1/models',
    'models.retrieve': 'GET /v1/models/{model}',
    'models.delete': 'DELETE /v1/models/{model}',
    'files.create': 'POST /v1/files',
    'files.list': 'GET /v1/files',
    'files.retrieve': 'GET /v1/files/{file_id}',
    'files.content': 'GET /v1/files/{file_id}/content',
    'files.delete': 'DELETE /v1/files/{file_id}',
    'batches.create': 'POST /v1/batches',
    'batches.retrieve': 'GET /v1/batches/{batch_id}',
    'batches.list': 'GET /v1/batches',
    'batches.cancel': 'POST /v1/batches/{batch_id}/cancel',
    'fineTuning.jobs.create': 'POST /v1/fine_tuning/jobs',
    'fineTuning.jobs.retrieve': 'GET /v1/fine_tuning/jobs/{fine_tuning_job_id}',
    'fineTuning.jobs.list': 'GET /v1/fine_tuning/jobs',
    'fineTuning.jobs.cancel': 'POST /v1/fine_tuning/jobs/{fine_tuning_job_id}/cancel',
    'beta.assistants.create': 'POST /v1/assistants',
    'beta.threads.create': 'POST /v1/threads',
    'beta.threads.messages.create': 'POST /v1/threads/{thread_id}/messages',
    'beta.threads.runs.create': 'POST /v1/threads/{thread_id}/runs',
  },
};

/**
 * Beta namespaces mostly mirror the stable surface, such as Anthropic's
 * `beta.messages.stream`, so a beta method falls back to its stable twin.
 * Methods that only exist under beta are listed with their prefix.
 */
export function lookupOperation(provider: ApiProvider, method: string): string | null {
  const table = OPERATIONS[provider];
  return table[method] ?? (method.startsWith('beta.') ? table[method.slice(5)] : undefined) ?? null;
}
