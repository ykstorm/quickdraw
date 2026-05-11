import * as fs from 'fs'
import * as path from 'path'
import { APICallLogEntry } from './types'

const LOG_FILE = path.join(__dirname, '..', 'api_calls.jsonl')

export class APICallLogger {
  private _count = 0

  log(entry: APICallLogEntry): void {
    this._count++
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(LOG_FILE, line, 'utf-8')
  }

  get count(): number {
    return this._count
  }
}

// Singleton logger for the benchmark run
let _logger: APICallLogger | null = null

export function getLogger(): APICallLogger {
  if (!_logger) {
    _logger = new APICallLogger()
    // Clear previous log
    const logPath = path.join(__dirname, '..', 'api_calls.jsonl')
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath)
  }
  return _logger
}