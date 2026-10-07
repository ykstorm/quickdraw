// Fake fetch responses for the provider tests: nothing here touches a network.

const encoder = new TextEncoder()

/** A fetch Response whose body streams the given SSE lines. */
export function sseResponse(lines: string[], ok = true, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return { ok, status, body, text: async () => lines.join('') } as unknown as Response
}

/**
 * A 200 Response whose body sends the given SSE lines and then fails the way
 * fetch's body does when its AbortSignal.timeout fires part-way through.
 */
export function timedOutResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('')))
    },
    // Called once the lines have been read: the next read fails.
    pull(controller) {
      controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
    },
  })
  return { ok: true, status: 200, body, text: async () => '' } as unknown as Response
}
