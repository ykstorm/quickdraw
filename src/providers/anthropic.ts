import { ProviderStreamResult } from '../types'
import { assertApiKey } from '../preflight'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'
const SYSTEM = 'You are a helpful assistant.'

export async function anthropicStream(
  prompt: string,
  onChunk?: (text: string) => void,
  model: string = DEFAULT_ANTHROPIC_MODEL
): Promise<ProviderStreamResult> {
  // Preflight: never send "Bearer undefined" / empty x-api-key.
  assertApiKey('anthropic')
  const apiKey = process.env.ANTHROPIC_API_KEY as string

  const start = Date.now()

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${err}`)
  }

  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let ttft_ms = 0
  let tokenCount = 0
  let usagePromptTokens = 0
  let usageCompletionTokens = 0

  // A single reader.read() returns an arbitrary byte slice, not a line-aligned
  // SSE frame — a `data:` line can straddle two reads. Carry the trailing
  // partial line in `buffer` and only parse complete (newline-terminated)
  // lines; otherwise split events are dropped and throughput undercounts.
  let buffer = ''

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6)
    if (data === '[DONE]') return
    try {
      const event = JSON.parse(data)
      if (event.type === 'message_start') {
        // Prompt-token usage is on the initial message.
        const u = event.message?.usage
        if (u?.input_tokens != null) usagePromptTokens = u.input_tokens
        if (u?.output_tokens != null) usageCompletionTokens = u.output_tokens
      } else if (event.type === 'content_block_delta' && event.delta?.text) {
        if (ttft_ms === 0) ttft_ms = Date.now() - start
        tokenCount++
        fullText += event.delta.text
        if (onChunk) onChunk(event.delta.text)
      } else if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
        // Final cumulative output-token count.
        usageCompletionTokens = event.usage.output_tokens
      }
    } catch {
      // skip malformed lines
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the last, possibly-incomplete line
    for (const line of lines) handleLine(line)
  }
  if (buffer) handleLine(buffer) // flush any final line with no trailing newline

  const duration_ms = Date.now() - start

  // Prefer provider usage; fall back to char/4 estimate.
  const haveUsage = usagePromptTokens > 0 || usageCompletionTokens > 0
  const prompt_tokens = usagePromptTokens > 0
    ? usagePromptTokens
    : Math.ceil((prompt.length + SYSTEM.length) / 4)
  const completion_tokens = usageCompletionTokens > 0 ? usageCompletionTokens : tokenCount

  return {
    text: fullText,
    tokens: tokenCount,
    ttft_ms,
    duration_ms,
    prompt_tokens,
    completion_tokens,
    token_source: haveUsage ? 'usage' : 'estimate',
  }
}
