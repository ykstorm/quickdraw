import { ProviderName } from './types'

export const REQUIRED_KEY: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

/** Truthy env-flag parse: accepts 1/true/yes/on (case-insensitive). */
export function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export class MissingApiKeyError extends Error {
  constructor(
    public readonly provider: string,
    public readonly envVar: string
  ) {
    super(`Set ${envVar} to benchmark ${provider}.`)
    this.name = 'MissingApiKeyError'
  }
}

/** Thrown when a provider call is attempted while DRY_RUN is set. */
export class DryRunError extends Error {
  constructor(public readonly provider: string) {
    super(`DRY_RUN is set: refusing to call ${provider}. Unset DRY_RUN to make real calls.`)
    this.name = 'DryRunError'
  }
}

/**
 * Throw a clean MissingApiKeyError if the env var for `provider` is unset/empty.
 * Reads from `env` (defaults to process.env) so it is testable. Skipped in
 * DRY_RUN, where the CLI only prints the plan; the adapters call
 * `assertLiveCall`, which refuses DRY_RUN before it gets here.
 */
export function assertApiKey(
  provider: ProviderName,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (isTruthy(env.DRY_RUN)) return
  const envVar = REQUIRED_KEY[provider]
  const value = env[envVar]
  if (!value || value.trim() === '') {
    throw new MissingApiKeyError(provider, envVar)
  }
}

/**
 * The gate each provider adapter runs before `fetch`. Under DRY_RUN it throws
 * DryRunError, so a direct adapter call never reaches the network; otherwise it
 * throws MissingApiKeyError when the key is unset, so no request is sent with
 * "Bearer undefined".
 */
export function assertLiveCall(provider: ProviderName, env: NodeJS.ProcessEnv = process.env): void {
  if (isTruthy(env.DRY_RUN)) throw new DryRunError(provider)
  assertApiKey(provider, env)
}

/**
 * Check all providers up front. Returns the list of missing env vars (empty if
 * all present). Does not throw.
 */
export function missingKeys(
  providers: ProviderName[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (isTruthy(env.DRY_RUN)) return []
  const missing: string[] = []
  for (const p of providers) {
    const envVar = REQUIRED_KEY[p]
    const value = env[envVar]
    if (!value || value.trim() === '') missing.push(envVar)
  }
  return missing
}
