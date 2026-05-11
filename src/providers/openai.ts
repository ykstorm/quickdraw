import { ProviderStreamResult } from '../types'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const MODEL = 'gpt-4o-mini'

export async function openaiStream(
  prompt: string,
  onChunk?: (text: string) => void
): Promise<ProviderStreamResult> {
  const start = Date.now()

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
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
      } catch {
        // skip malformed lines
      }
    }
  }

  const duration_ms = Date.now() - start
  const estimatedPromptTokens = Math.ceil(prompt.length / 4)

  return {
    text: fullText,
    tokens: tokenCount,
    ttft_ms,
    duration_ms,
    prompt_tokens: estimatedPromptTokens,
    completion_tokens: tokenCount,
  }
}