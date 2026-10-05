/**
 * Shared handling for provider HTTP errors and for scrubbing secrets out of any
 * string before it is thrown, printed, or written to disk.
 *
 * API keys must never reach stdout, stderr, the JSONL ledger, or a results file.
 * A provider's raw error body can echo the request (including the key), so every
 * surface runs its output through `redactSecrets` first.
 */

/** Patterns for provider API keys and bearer tokens. */
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / Anthropic style keys: sk-..., sk-ant-..., sk-proj-..., sk-live-...
  /\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_-]{4,}/g,
  // Authorization: Bearer <token>
  // token characters only, so a closing quote after the token survives and
  // a redacted JSON document still parses
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
]

const REDACTION = '[REDACTED]'

/** Request timeout in ms. Honors QUICKDRAW_TIMEOUT_MS, defaulting to 120s. */
export function requestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.QUICKDRAW_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000
}

/** True when an error is a fetch/AbortSignal timeout or abort. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/** Replace anything that looks like an API key or bearer token with a marker. */
export function redactSecrets(input: string): string {
  let out = input
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTION)
  return out
}

/**
 * Build a safe one-line error message from a provider's HTTP error response.
 * Keeps only `error.type` / `error.code` / `error.message` from a JSON body (or
 * the raw body when it is not JSON), redacts secrets, then caps the detail at
 * 200 characters. Redaction runs BEFORE the cap so a key near the boundary can
 * never survive by being split.
 */
export function sanitizeHttpError(provider: string, status: number, body: string): string {
  let detail: string
  try {
    const parsed = JSON.parse(body)
    const e = (parsed && typeof parsed === 'object' && 'error' in parsed ? parsed.error : parsed) ?? {}
    const parts = [e.type, e.code, e.message].filter((p): p is string => typeof p === 'string' && p.length > 0)
    detail = parts.length > 0 ? parts.join(': ') : ''
  } catch {
    detail = typeof body === 'string' ? body : ''
  }
  detail = redactSecrets(detail).slice(0, 200)
  return `${provider} API error ${status}${detail ? `: ${detail}` : ''}`
}
