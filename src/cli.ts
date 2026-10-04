import { Command, CommanderError } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { BenchmarkConfig, BenchmarkResult, ProviderName } from './types'
import { runBenchmark, resolveModel } from './benchmark'
import { APICallLogger } from './logger'
import { pricingFor } from './cost-tracker'
import { redactSecrets } from './providers/http-error'
import { missingKeys, isTruthy } from './preflight'
import { formatBenchTable } from './report'
import { diffRuns, formatDiff, parseRunFile } from './diff'

const VALID_PROVIDERS: ProviderName[] = ['openai', 'anthropic']
/** Prompt files larger than this are rejected unless --max-prompt-bytes raises it. */
const DEFAULT_MAX_PROMPT_BYTES = 1024 * 1024

export interface CliDeps {
  /** Injected for testability; defaults to the real benchmark. */
  runBenchmark?: typeof runBenchmark
  out?: (msg: string) => void
  err?: (msg: string) => void
  env?: NodeJS.ProcessEnv
  /** Read a file as utf-8. Injected for testability. */
  readFile?: (path: string) => string
  writeFile?: (path: string, data: string) => void
  /** Stat a file (isFile + byte size). Injected for testability. */
  statFile?: (path: string) => { isFile: boolean; size: number }
}

/** Resolved CLI context with all IO defaults applied. */
interface Ctx {
  out: (msg: string) => void
  err: (msg: string) => void
  env: NodeJS.ProcessEnv
  readFile: (path: string) => string
  writeFile: (path: string, data: string) => void
  statFile: (path: string) => { isFile: boolean; size: number }
  bench: typeof runBenchmark
}

function parseProviders(raw: string): ProviderName[] {
  const names = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const bad = names.filter((n) => !VALID_PROVIDERS.includes(n as ProviderName))
  if (bad.length > 0) {
    throw new Error(`Unknown provider(s): ${bad.join(', ')}. Valid: ${VALID_PROVIDERS.join(', ')}`)
  }
  return names as ProviderName[]
}

type BenchOpts = Record<string, string | boolean>

function positiveInt(raw: unknown, flag: string): number {
  const n = parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1) throw new Error(`${flag} must be a positive integer (got ${raw})`)
  return n
}

/** Reads the prompt file, rejecting anything that is not a file, too big, or empty. */
function readPrompt(file: string, maxBytes: number, ctx: Ctx): string {
  const stat = ctx.statFile(file)
  if (!stat.isFile) throw new Error(`Prompt path is not a file: ${file}`)
  if (stat.size > maxBytes) throw new Error(`Prompt file is ${stat.size} bytes, over the ${maxBytes}-byte limit: ${file}`)
  const prompt = ctx.readFile(file).trim()
  if (!prompt) throw new Error(`Prompt file is empty: ${file}`)
  return prompt
}

/** Turns the raw `bench` flags into a config, throwing on the first bad value. */
function benchConfig(opts: BenchOpts, ctx: Ctx): BenchmarkConfig {
  const providers = parseProviders(String(opts.providers))
  const runs = positiveInt(opts.runs, '--runs')
  const costCap = parseFloat(String(opts.costCap))
  if (!Number.isFinite(costCap) || costCap <= 0) throw new Error(`--cost-cap must be a positive number (got ${opts.costCap})`)
  const maxPromptBytes = positiveInt(opts.maxPromptBytes, '--max-prompt-bytes')
  const prompt = opts.promptFile ? readPrompt(String(opts.promptFile), maxPromptBytes, ctx) : undefined
  const allowUnpriced = Boolean(opts.allowUnpriced)
  const model = opts.model as string | undefined

  // Validate pricing for every model BEFORE any network call, unless the caller
  // opted into unpriced runs.
  if (!allowUnpriced) {
    const unpriced = [...new Set(providers.map((p) => resolveModel(p, model)))].filter((m) => !pricingFor(m))
    if (unpriced.length > 0) {
      throw new Error(`No pricing on file for model(s): ${unpriced.join(', ')}. Add them to MODEL_PRICING or pass --allow-unpriced.`)
    }
  }
  return { providers, runs, costCap, prompt, model, allowUnpriced }
}

function printDryRun(config: BenchmarkConfig, promptFile: unknown, ctx: Ctx): void {
  const { providers, runs, costCap, model } = config
  ctx.out('[quickdraw] DRY_RUN=true — no network calls will be made.')
  ctx.out(`[quickdraw] Would benchmark: providers=${providers.join(',')} runs=${runs} cost-cap=$${costCap}`)
  if (model) ctx.out(`[quickdraw] Model override: ${model}`)
  ctx.out(`[quickdraw] Prompt source: ${promptFile ? promptFile : 'built-in prompt rotation'}`)
  ctx.out(`[quickdraw] Total planned calls: ${providers.length * runs}`)
}

/** The `bench` subcommand. Returns the intended exit code. */
async function benchAction(opts: BenchOpts, ctx: Ctx): Promise<number> {
  const config = benchConfig(opts, ctx)
  const { providers, runs, costCap } = config

  if (isTruthy(ctx.env.DRY_RUN)) {
    printDryRun(config, opts.promptFile, ctx)
    return 0
  }

  // Preflight: bail cleanly if required keys are missing.
  const missing = missingKeys(providers, ctx.env)
  if (missing.length > 0) {
    for (const k of missing) ctx.err(`Set ${k}`)
    return 1
  }

  ctx.out(`Running benchmark: providers=${providers.join(',')} runs=${runs} cost-cap=$${costCap}`)
  const results = await ctx.bench(config, {
    logger: new APICallLogger({ truncate: true }),
    onProgress: ctx.out,
  })
  ctx.out('')
  ctx.out(formatBenchTable(results))

  if (opts.json) {
    // Redact any secret that reached a result field before writing to disk.
    ctx.writeFile(String(opts.json), redactSecrets(JSON.stringify({ results }, null, 2)))
    ctx.out(`\nResults written to ${opts.json}`)
  }

  return results.some((r: BenchmarkResult) => !r.success) ? 1 : 0
}

/** The `diff` subcommand. Returns the intended exit code. */
function diffAction(run1Path: string, run2Path: string, opts: Record<string, string>, ctx: Ctx): number {
  const threshold = parseFloat(opts.threshold)
  if (!Number.isFinite(threshold)) throw new Error(`--threshold must be a number (got ${opts.threshold})`)
  const r1 = parseRunFile(ctx.readFile(run1Path))
  const r2 = parseRunFile(ctx.readFile(run2Path))
  const d = diffRuns(r1, r2, threshold)
  ctx.out(formatDiff(d))
  return d.regressed ? 2 : 0
}

/**
 * Run the CLI. Returns the intended process exit code (0 success, non-zero on
 * error / regression) instead of calling process.exit, so it is fully testable.
 */
export async function run(argv: string[], deps: CliDeps = {}): Promise<number> {
  const ctx: Ctx = {
    out: deps.out ?? ((m: string) => console.log(m)),
    err: deps.err ?? ((m: string) => console.error(m)),
    env: deps.env ?? process.env,
    readFile: deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf-8')),
    writeFile:
      deps.writeFile ??
      ((p: string, d: string) => {
        const dir = path.dirname(p)
        if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(p, d, 'utf-8')
      }),
    statFile:
      deps.statFile ??
      ((p: string) => {
        const s = fs.statSync(p)
        return { isFile: s.isFile(), size: s.size }
      }),
    bench: deps.runBenchmark ?? runBenchmark,
  }

  const program = new Command()
  program
    .name('quickdraw')
    .description('Benchmark LLM streaming: TTFT, TPS, p50/p95/p99, and cost, with a hard cost cap.')
    .exitOverride() // throw instead of calling process.exit, so we control codes
    .configureOutput({
      writeOut: (s) => ctx.out(s.replace(/\n$/, '')),
      writeErr: (s) => ctx.err(s.replace(/\n$/, '')),
    })

  let exitCode = 0

  program
    .command('bench')
    .description('Run a streaming benchmark across providers')
    .option('-p, --providers <names>', 'Comma-separated providers (openai,anthropic)', 'openai,anthropic')
    .option('-r, --runs <n>', 'Runs per provider', '3')
    .option('-c, --cost-cap <usd>', 'Hard cost ceiling in USD', '2')
    .option('-m, --model <id>', 'Override model id for every provider')
    .option('-f, --prompt-file <path>', 'File whose contents are used as the prompt')
    .option('--max-prompt-bytes <n>', 'Reject a prompt file larger than this', String(DEFAULT_MAX_PROMPT_BYTES))
    .option('--allow-unpriced', 'Run models with no pricing on file (cost reported as $0, not capped)')
    .option('--json <path>', 'Write full results JSON to this path')
    .action(async (opts) => {
      exitCode = await benchAction(opts, ctx)
    })

  program
    .command('diff')
    .description('Regression-diff two saved benchmark run JSON files')
    .argument('<run1>', 'First (baseline) run JSON file')
    .argument('<run2>', 'Second (candidate) run JSON file')
    .option('-t, --threshold <pct>', 'Regression threshold percent', '10')
    .action((run1Path, run2Path, opts) => {
      exitCode = diffAction(run1Path, run2Path, opts, ctx)
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (e) {
    if (e instanceof CommanderError) {
      // --help / --version are not real errors.
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.help' || e.code === 'commander.version') {
        return 0
      }
      // missingArgument / unknownCommand / missingMandatoryOptionValue: commander
      // has already printed the message.
      return 1
    }
    ctx.err(`Error: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  return exitCode
}
