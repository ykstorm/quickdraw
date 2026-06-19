import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { BenchmarkConfig, BenchmarkResult, ProviderName } from './types'
import { runBenchmark } from './benchmark'
import { missingKeys } from './preflight'
import { formatBenchTable } from './report'
import { diffRuns, formatDiff, parseRunFile } from './diff'

const VALID_PROVIDERS: ProviderName[] = ['openai', 'anthropic']

export interface CliDeps {
  /** Injected for testability; defaults to the real benchmark. */
  runBenchmark?: typeof runBenchmark
  out?: (msg: string) => void
  err?: (msg: string) => void
  env?: NodeJS.ProcessEnv
  /** Read a file as utf-8. Injected for testability. */
  readFile?: (path: string) => string
  writeFile?: (path: string, data: string) => void
}

function parseProviders(raw: string): ProviderName[] {
  const names = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const bad = names.filter((n) => !VALID_PROVIDERS.includes(n as ProviderName))
  if (bad.length > 0) {
    throw new Error(`Unknown provider(s): ${bad.join(', ')}. Valid: ${VALID_PROVIDERS.join(', ')}`)
  }
  return names as ProviderName[]
}

/**
 * Run the CLI. Returns the intended process exit code (0 success, non-zero on
 * error / regression) instead of calling process.exit, so it is fully testable.
 */
export async function run(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.out ?? ((m: string) => console.log(m))
  const err = deps.err ?? ((m: string) => console.error(m))
  const env = deps.env ?? process.env
  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf-8'))
  const writeFile = deps.writeFile ?? ((p: string, d: string) => fs.writeFileSync(p, d, 'utf-8'))
  const bench = deps.runBenchmark ?? runBenchmark

  const program = new Command()
  program
    .name('quickdraw')
    .description('Benchmark LLM streaming — TTFT, TPS, $/1K tokens, with a hard cost cap.')
    .exitOverride() // throw instead of calling process.exit, so we control codes
    .configureOutput({
      writeOut: (s) => out(s.replace(/\n$/, '')),
      writeErr: (s) => err(s.replace(/\n$/, '')),
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
    .option('--json <path>', 'Write full results JSON to this path')
    .action(async (opts) => {
      const providers = parseProviders(opts.providers)
      const runs = parseInt(opts.runs, 10)
      const costCap = parseFloat(opts.costCap)
      if (!Number.isFinite(runs) || runs < 1) throw new Error(`--runs must be a positive integer (got ${opts.runs})`)
      if (!Number.isFinite(costCap) || costCap <= 0) throw new Error(`--cost-cap must be a positive number (got ${opts.costCap})`)

      let prompt: string | undefined
      if (opts.promptFile) {
        prompt = readFile(opts.promptFile).trim()
        if (!prompt) throw new Error(`Prompt file is empty: ${opts.promptFile}`)
      }

      const dryRun = env.DRY_RUN === 'true'

      // Preflight: bail cleanly if required keys are missing (skipped in DRY_RUN).
      const missing = missingKeys(providers, env)
      if (missing.length > 0) {
        for (const k of missing) err(`Set ${k}`)
        exitCode = 1
        return
      }

      if (dryRun) {
        out('[quickdraw] DRY_RUN=true — no network calls will be made.')
        out(`[quickdraw] Would benchmark: providers=${providers.join(',')} runs=${runs} cost-cap=$${costCap}`)
        if (opts.model) out(`[quickdraw] Model override: ${opts.model}`)
        out(`[quickdraw] Prompt source: ${opts.promptFile ? opts.promptFile : 'built-in prompt rotation'}`)
        out(`[quickdraw] Total planned calls: ${providers.length * runs}`)
        return
      }

      const config: BenchmarkConfig = {
        providers,
        runs,
        guardrails: false,
        costCap,
        prompt,
        model: opts.model,
      }

      out(`Running benchmark: providers=${providers.join(',')} runs=${runs} cost-cap=$${costCap}`)
      const results = await bench(config)
      out('')
      out(formatBenchTable(results))

      if (opts.json) {
        const dir = path.dirname(opts.json)
        if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        writeFile(opts.json, JSON.stringify({ results }, null, 2))
        out(`\nResults written to ${opts.json}`)
      }

      if (results.some((r: BenchmarkResult) => !r.success)) exitCode = 1
    })

  program
    .command('diff')
    .description('Regression-diff two saved benchmark run JSON files')
    .argument('<run1>', 'First (baseline) run JSON file')
    .argument('<run2>', 'Second (candidate) run JSON file')
    .option('-t, --threshold <pct>', 'Regression threshold percent', '10')
    .action((run1Path, run2Path, opts) => {
      const threshold = parseFloat(opts.threshold)
      const r1 = parseRunFile(readFile(run1Path))
      const r2 = parseRunFile(readFile(run2Path))
      const d = diffRuns(r1, r2, Number.isFinite(threshold) ? threshold : 10)
      out(formatDiff(d))
      if (d.regressed) exitCode = 2
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (e) {
    const ce = e as { code?: string; exitCode?: number; message?: string }
    // commander uses these codes for --help / --version (not real errors)
    if (ce.code === 'commander.helpDisplayed' || ce.code === 'commander.help' || ce.code === 'commander.version') {
      return 0
    }
    if (ce.code === 'commander.missingArgument' || ce.code === 'commander.unknownCommand' || ce.code === 'commander.missingMandatoryOptionValue') {
      // commander already printed the message
      return 1
    }
    err(`Error: ${ce.message ?? String(e)}`)
    return 1
  }

  return exitCode
}
