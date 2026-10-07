/**
 * Maximum output tokens requested from every provider. This is the pessimistic
 * upper bound used when reserving budget BEFORE a call, and it must match the
 * `max_tokens` sent by the provider clients so the output side of the
 * reservation is a true upper bound. The prompt side is only an estimate.
 */
export const MAX_OUTPUT_TOKENS = 512

export interface CostConfig {
  input_cost_per_million: number // USD per 1,000,000 input tokens
  output_cost_per_million: number // USD per 1,000,000 output tokens
}

/**
 * Pricing keyed by model id, USD per 1,000,000 tokens. Pricing is attached to
 * the model, not the provider, so a `--model` override is costed correctly
 * instead of being billed at the default model's rate.
 *
 * Prices as of 2026-10-01 from each provider's public pricing page. Update the
 * date when you change a number.
 */
export const MODEL_PRICING: Record<string, CostConfig> = {
  'claude-haiku-4-5': { input_cost_per_million: 1.0, output_cost_per_million: 5.0 },
  'claude-sonnet-4-5': { input_cost_per_million: 3.0, output_cost_per_million: 15.0 },
  'gpt-4o-mini': { input_cost_per_million: 0.15, output_cost_per_million: 0.6 },
  'gpt-4o': { input_cost_per_million: 2.5, output_cost_per_million: 10.0 },
}

/** Look up pricing for a model id, or undefined when the model is unpriced. */
export function pricingFor(model: string): CostConfig | undefined {
  return MODEL_PRICING[model]
}

/** Thrown when a reservation would push total spend past the ceiling. */
export class CostCeilingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostCeilingError'
  }
}

/** Thrown when a model has no entry in MODEL_PRICING and --allow-unpriced is off. */
export class UnknownPricingError extends Error {
  constructor(public readonly model: string) {
    super(
      `No pricing on file for model "${model}". Add it to MODEL_PRICING, or pass ` +
        `--allow-unpriced to run anyway (its cost is reported as $0 and is NOT ` +
        `counted against the cost ceiling).`
    )
    this.name = 'UnknownPricingError'
  }
}

const round6 = (n: number) => parseFloat(n.toFixed(6))

/**
 * Tracks spend against a hard ceiling. The ceiling is enforced by `reserve()`,
 * which runs BEFORE a call and charges a pessimistic estimate (max output
 * tokens) against the budget, so a call is only started when its estimate fits.
 * `settle()` then swaps that reservation for the call's real cost once it
 * completes. The prompt side of the estimate can be low, so settled spend can
 * end up above the ceiling by the amount one call cost beyond its estimate;
 * every reservation after that is refused.
 */
export class CostTracker {
  private _spent = 0 // settled, real cost of completed calls
  private _reserved = 0 // outstanding reservations for in-flight calls
  private readonly ceiling: number
  private readonly allowUnpriced: boolean

  constructor(ceiling = 2.0, allowUnpriced = false) {
    this.ceiling = ceiling
    this.allowUnpriced = allowUnpriced
  }

  /**
   * Compute the cost of a call from its token counts. Throws UnknownPricingError
   * for a model with no pricing unless `allowUnpriced` was set (then returns 0).
   */
  priceOf(model: string, promptTokens: number, completionTokens: number): number {
    const cfg = MODEL_PRICING[model]
    if (!cfg) {
      if (this.allowUnpriced) return 0
      throw new UnknownPricingError(model)
    }
    const cost =
      (promptTokens / 1_000_000) * cfg.input_cost_per_million +
      (completionTokens / 1_000_000) * cfg.output_cost_per_million
    return round6(cost)
  }

  /**
   * Pessimistically reserve budget for a call before it is made. `maxOut` is the
   * largest number of output tokens the call can produce. Throws CostCeilingError
   * if the reservation would breach the ceiling (the caller must NOT make the
   * call in that case). Returns the reserved amount to hand back to `settle()`.
   */
  reserve(provider: string, model: string, promptTokensEst: number, maxOut: number): number {
    const est = this.priceOf(model, promptTokensEst, maxOut)
    if (round6(this.total + est) > this.ceiling) {
      throw new CostCeilingError(
        `Cost ceiling reached: ${provider}/${model} would need $${est.toFixed(6)} but only ` +
          `$${this.remaining.toFixed(6)} of the $${this.ceiling.toFixed(2)} ceiling remains.`
      )
    }
    this._reserved = round6(this._reserved + est)
    return est
  }

  /** Release a reservation and record the call's real settled cost. */
  settle(reserved: number, actual: number): void {
    this._reserved = round6(Math.max(0, this._reserved - reserved))
    this._spent = round6(this._spent + actual)
  }

  /** Real cost of completed calls. */
  get spent(): number {
    return this._spent
  }

  /** Settled spend plus outstanding reservations — what the ceiling is tested against. */
  get total(): number {
    return round6(this._spent + this._reserved)
  }

  get ceilingUsd(): number {
    return this.ceiling
  }

  get remaining(): number {
    return round6(this.ceiling - this.total)
  }
}
