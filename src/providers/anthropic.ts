import { ProviderStreamResult } from '../types'
import { assertLiveCall } from '../preflight'
import { MAX_OUTPUT_TOKENS } from '../cost-tracker'
import { sanitizeHttpError, requestTimeoutMs, isAbortError, withStreamTimeout } from './http-error'
import { readSSEData } from './sse'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'
const SYSTEM = 'You are a helpful assistant.'

/** What the stream has delivered so far. */
interface StreamState {
  text: string
  ttft_ms: number
  promptTokens: number
  completionTokens: number
}

function onMessageStart(usage: { input_tokens?: number; output_tokens?: number } | undefined, s: StreamState): void {
  if (usage?.input_tokens != null) s.promptTokens = usage.input_tokens
  if (usage?.output_tokens != null) s.completionTokens = usage.output_tokens
}

function onText(text: string, s: StreamState, start: number, onChunk?: (text: string) => void): void {
  if (s.ttft_ms === 0) s.ttft_ms = Date.now() - start
  s.text += text
  if (onChunk) onChunk(text)
}

/** Fold one parsed SSE event into the stream state. */
function applyEvent(event: any, s: StreamState, start: number, onChunk?: (text: string) => void): void {
  if (event.type === 'message_start') {
    // Prompt-token usage is on the initial message.
    onMessageStart(event.message?.usage, s)
  } else if (event.type === 'content_block_delta' && event.delta?.text) {
    onText(event.delta.text, s, start, onChunk)
  } else if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
    // Final cumulative output-token count.
    s.completionTokens = event.usage.output_tokens
  }
}

export async function anthropicStream(
  prompt: string,
  onChunk?: (text: string) => void,
  model: string = DEFAULT_ANTHROPIC_MODEL
): Promise<ProviderStreamResult> {
  // Preflight: no request under DRY_RUN, and never an empty x-api-key.
  assertLiveCall('anthropic')
  const apiKey = process.env.ANTHROPIC_API_KEY as string

  const start = Date.now()

  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    })
  } catch (err) {
    if (isAbortError(err)) throw new Error(`Anthropic request timed out after ${requestTimeoutMs()}ms`)
    throw err
  }

  if (!response.ok) {
    const err = await response.text()
    throw new Error(sanitizeHttpError('Anthropic', response.status, err))
  }

  if (!response.body) throw new Error('No response body')

  const s: StreamState = { text: '', ttft_ms: 0, promptTokens: 0, completionTokens: 0 }

  const read = readSSEData(response.body, (data) => {
    try {
      applyEvent(JSON.parse(data), s, start, onChunk)
    } catch {
      // skip malformed lines
    }
  })
  await withStreamTimeout('Anthropic', read, () => s.text)

  const duration_ms = Date.now() - start

  // Prefer provider usage; fall back to char/4 estimate.
  const haveUsage = s.promptTokens > 0 || s.completionTokens > 0
  const prompt_tokens = s.promptTokens > 0
    ? s.promptTokens
    : Math.ceil((prompt.length + SYSTEM.length) / 4)
  // Fallback completion estimate uses generated text length (char/4), matching
  // the prompt-token estimate — not the raw SSE delta-event count.
  const completion_tokens = s.completionTokens > 0 ? s.completionTokens : Math.ceil(s.text.length / 4)

  return {
    text: s.text,
    ttft_ms: s.ttft_ms,
    duration_ms,
    prompt_tokens,
    completion_tokens,
    token_source: haveUsage ? 'usage' : 'estimate',
  }
}
