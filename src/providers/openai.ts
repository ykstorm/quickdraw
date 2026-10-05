import { ProviderStreamResult } from '../types'
import { assertApiKey } from '../preflight'
import { MAX_OUTPUT_TOKENS } from '../cost-tracker'
import { sanitizeHttpError, requestTimeoutMs, isAbortError } from './http-error'
import { readSSEData } from './sse'

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

export async function openaiStream(
  prompt: string,
  onChunk?: (text: string) => void,
  model: string = DEFAULT_OPENAI_MODEL
): Promise<ProviderStreamResult> {
  // Preflight: never send "Bearer undefined".
  assertApiKey('openai')
  const apiKey = process.env.OPENAI_API_KEY as string

  const start = Date.now()

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        // Ask OpenAI to emit a final usage chunk with exact token counts.
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    })
  } catch (err) {
    if (isAbortError(err)) throw new Error(`OpenAI request timed out after ${requestTimeoutMs()}ms`)
    throw err
  }

  if (!response.ok) {
    const err = await response.text()
    throw new Error(sanitizeHttpError('OpenAI', response.status, err))
  }

  if (!response.body) throw new Error('No response body')

  let fullText = ''
  let ttft_ms = 0
  let usagePromptTokens = 0
  let usageCompletionTokens = 0

  await readSSEData(response.body, (data) => {
    try {
      const event = JSON.parse(data)
      if (event.choices?.[0]?.delta?.content) {
        if (ttft_ms === 0) ttft_ms = Date.now() - start
        const text = event.choices[0].delta.content
        fullText += text
        if (onChunk) onChunk(text)
      }
      // Final usage chunk (choices is typically empty here).
      if (event.usage) {
        if (event.usage.prompt_tokens != null) usagePromptTokens = event.usage.prompt_tokens
        if (event.usage.completion_tokens != null) usageCompletionTokens = event.usage.completion_tokens
      }
    } catch {
      // skip malformed lines
    }
  })

  const duration_ms = Date.now() - start

  const haveUsage = usagePromptTokens > 0 || usageCompletionTokens > 0
  const prompt_tokens = usagePromptTokens > 0 ? usagePromptTokens : Math.ceil(prompt.length / 4)
  // Fallback completion estimate uses generated text length (char/4), matching
  // the prompt-token estimate — not the raw SSE delta-event count.
  const completion_tokens = usageCompletionTokens > 0 ? usageCompletionTokens : Math.ceil(fullText.length / 4)

  return {
    text: fullText,
    ttft_ms,
    duration_ms,
    prompt_tokens,
    completion_tokens,
    token_source: haveUsage ? 'usage' : 'estimate',
  }
}
