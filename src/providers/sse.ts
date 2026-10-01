/**
 * Shared Server-Sent Events reader for the provider stream clients.
 *
 * A single `reader.read()` returns an arbitrary byte slice, not a line-aligned
 * SSE frame, so a `data:` line can straddle two reads. This carries the trailing
 * partial line across reads and only emits complete lines; without it, split
 * events are dropped and throughput undercounts.
 */
export async function readSSEData(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (line: string): void => {
    if (!line.startsWith('data: ')) return
    const data = line.slice(6)
    if (data === '[DONE]') return
    onData(data)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the last, possibly-incomplete line
    for (const line of lines) handleLine(line)
  }
  if (buffer) handleLine(buffer) // flush a final line with no trailing newline
}
