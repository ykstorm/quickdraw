import { ProviderName } from './types'

export const REQUIRED_KEY: Record<ProviderName, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
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

/**
 * Throw a clean MissingApiKeyError if the env var for `provider` is unset/empty.
 * Reads from `env` (defaults to process.env) so it is testable. Skipped in
 * DRY_RUN since no network call is made.
 */
export function assertApiKey(
  provider: ProviderName,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.DRY_RUN === 'true') return
  const envVar = REQUIRED_KEY[provider]
  const value = env[envVar]
  if (!value || value.trim() === '') {
    throw new MissingApiKeyError(provider, envVar)
  }
}

/**
 * Check all providers up front. Returns the list of missing env vars (empty if
 * all present). Does not throw.
 */
export function missingKeys(
  providers: ProviderName[],
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.DRY_RUN === 'true') return []
  const missing: string[] = []
  for (const p of providers) {
    const envVar = REQUIRED_KEY[p]
    const value = env[envVar]
    if (!value || value.trim() === '') missing.push(envVar)
  }
  return missing
}
