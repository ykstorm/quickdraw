import { ProviderStreamResult } from '../types'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const MODEL = 'claude-3-5-haiku-20241107'
const SYSTEM = 'You are a helpful assistant.'

export async function anthropicStream(
  prompt: string,
  onChunk?: (text: string) => void
): Promise<ProviderStreamResult> {
  const start = Date.now()

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
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
        if (event.type === 'message_start') {
          ttft_ms = Date.now() - start
        } else if (event.type === 'content_block_delta' && event.delta?.text) {
          tokenCount++
          fullText += event.delta.text
          if (onChunk) onChunk(event.delta.text)
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const duration_ms = Date.now() - start
  const estimatedPromptTokens = Math.ceil((prompt.length + SYSTEM.length) / 4)

  return {
    text: fullText,
    tokens: tokenCount,
    ttft_ms,
    duration_ms,
    prompt_tokens: estimatedPromptTokens,
    completion_tokens: tokenCount,
  }
}