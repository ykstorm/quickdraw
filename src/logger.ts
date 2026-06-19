import * as fs from 'fs'
import * as path from 'path'
import { APICallLogEntry } from './types'

/**
 * Resolve the JSONL log path. Honors QUICKDRAW_LOG_FILE, otherwise writes
 * `api_calls.jsonl` in the current working directory. Computed lazily so this
 * module is safe to import under both CJS and ESM (no `__dirname` at top level).
 */
function logFilePath(): string {
  return process.env.QUICKDRAW_LOG_FILE || path.join(process.cwd(), 'api_calls.jsonl')
}

export class APICallLogger {
  private _count = 0
  private readonly file: string

  constructor(file: string = logFilePath()) {
    this.file = file
  }

  log(entry: APICallLogEntry): void {
    this._count++
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(this.file, line, 'utf-8')
  }

  get count(): number {
    return this._count
  }

  get path(): string {
    return this.file
  }
}

// Singleton logger for the benchmark run
let _logger: APICallLogger | null = null

export function getLogger(): APICallLogger {
  if (!_logger) {
    const file = logFilePath()
    _logger = new APICallLogger(file)
    // Clear previous log so each benchmark run starts fresh.
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
  return _logger
}

/** Test/utility hook to reset the singleton. */
export function resetLogger(): void {
  _logger = null
}
