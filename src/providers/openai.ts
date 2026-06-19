import { ProviderStreamResult } from '../types'
import { assertApiKey } from '../preflight'

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

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      // Ask OpenAI to emit a final usage chunk with exact token counts.
      stream_options: { include_usage: true },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${err}`)
  }

  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let ttft_ms = 0
  let tokenCount = 0
  let usagePromptTokens = 0
  let usageCompletionTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const event = JSON.parse(data)
        if (event.choices?.[0]?.delta?.content) {
          if (ttft_ms === 0) ttft_ms = Date.now() - start
          const text = event.choices[0].delta.content
          tokenCount++
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
    }
  }

  const duration_ms = Date.now() - start

  const haveUsage = usagePromptTokens > 0 || usageCompletionTokens > 0
  const prompt_tokens = usagePromptTokens > 0 ? usagePromptTokens : Math.ceil(prompt.length / 4)
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
