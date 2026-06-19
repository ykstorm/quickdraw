export interface CostConfig {
  model: string
  input_cost_per_million: number  // USD
  output_cost_per_million: number  // USD
}

/**
 * Per-provider pricing, USD per 1,000,000 tokens.
 *
 * Anthropic Haiku is `claude-haiku-4-5` at $1.00 / $5.00 per M (current model).
 * OpenAI default benchmark model is gpt-4o-mini at $0.15 / $0.60 per M.
 */
export const PROVIDER_COSTS: Record<string, CostConfig> = {
  anthropic: { model: 'claude-haiku-4-5', input_cost_per_million: 1.0, output_cost_per_million: 5.0 },
  openai:    { model: 'gpt-4o-mini',      input_cost_per_million: 0.15, output_cost_per_million: 0.6 },
}

export class CostTracker {
  private _totalCost = 0
  private readonly ceiling: number

  constructor(ceiling = 2.00) {
    this.ceiling = ceiling
  }

  computeCost(provider: string, promptTokens: number, completionTokens: number): number {
    const cfg = PROVIDER_COSTS[provider]
    if (!cfg) return 0
    const cost = (promptTokens / 1_000_000) * cfg.input_cost_per_million
                + (completionTokens / 1_000_000) * cfg.output_cost_per_million
    return parseFloat(cost.toFixed(6))
  }

  checkCeiling(provider: string, promptTokens: number, completionTokens: number): void {
    const cost = this.computeCost(provider, promptTokens, completionTokens)
    if (this._totalCost + cost > this.ceiling) {
      throw new Error(
        `Cost ceiling exceeded: $${this._totalCost.toFixed(3)} + $${cost.toFixed(6)} > $${this.ceiling.toFixed(2)}`
      )
    }
  }

  addCost(cost: number): void {
    this._totalCost = parseFloat((this._totalCost + cost).toFixed(6))
  }

  get total(): number {
    return this._totalCost
  }

  get remaining(): number {
    return parseFloat((this.ceiling - this._totalCost).toFixed(6))
  }
}