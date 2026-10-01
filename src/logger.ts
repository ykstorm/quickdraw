import * as fs from 'fs'
import * as path from 'path'
import { APICallLogEntry } from './types'
import { redactSecrets } from './providers/http-error'

/**
 * Resolve the JSONL log path. Honors QUICKDRAW_LOG_FILE, otherwise writes
 * `api_calls.jsonl` in the current working directory. Computed lazily so this
 * module is safe to import under both CJS and ESM (no `__dirname` at top level).
 */
function logFilePath(): string {
  return process.env.QUICKDRAW_LOG_FILE || path.join(process.cwd(), 'api_calls.jsonl')
}

export interface APICallLoggerOptions {
  /** Target file; defaults to QUICKDRAW_LOG_FILE or ./api_calls.jsonl. */
  file?: string
  /** Clear any existing file on construction so a run starts fresh. */
  truncate?: boolean
}

export class APICallLogger {
  private _count = 0
  private readonly file: string

  constructor(opts: APICallLoggerOptions = {}) {
    this.file = opts.file ?? logFilePath()
    if (opts.truncate && fs.existsSync(this.file)) fs.unlinkSync(this.file)
  }

  log(entry: APICallLogEntry): void {
    this._count++
    // Redact any secret that reached a field (e.g. a key echoed in an error)
    // before it is written to the on-disk ledger.
    const line = redactSecrets(JSON.stringify(entry)) + '\n'
    fs.appendFileSync(this.file, line, 'utf-8')
  }

  get count(): number {
    return this._count
  }

  get path(): string {
    return this.file
  }
}
