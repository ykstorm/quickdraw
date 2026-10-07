import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll } from 'vitest'

// Tests that run the benchmark without their own logger write the default
// ledger. Give each worker its own file in the temp folder, so test files
// running in parallel never delete or append to the same api_calls.jsonl.
const file = path.join(os.tmpdir(), `quickdraw-test-${process.pid}-${process.env.VITEST_WORKER_ID ?? 0}.jsonl`)
process.env.QUICKDRAW_LOG_FILE = file

afterAll(() => {
  fs.rmSync(file, { force: true })
})
