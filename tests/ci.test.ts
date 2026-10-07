import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { version } from '../package.json'

// npm publishes the package.json version whatever the tag says, so the publish
// job in ci.yml has to refuse a tag that names another version.

const root = path.resolve(__dirname, '..')
const STEP = 'Check the tag matches package.json'

/** The publish-npm job, from its key to the next job or the end of the file. */
function publishJob(): string {
  const text = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8').replace(/\r\n/g, '\n')
  const start = text.indexOf('\n  publish-npm:\n')
  if (start < 0) throw new Error('ci.yml has no publish-npm job')
  const next = text.slice(start + 1).search(/\n {2}[\w-]+:\n/)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

/** The `run: |` script of the named step, with the YAML indentation taken off. */
function stepScript(job: string, name: string): string {
  const lines = job.split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  if (at < 0) throw new Error(`publish-npm has no step named "${name}"`)
  const run = lines.findIndex((l, i) => i > at && l.trim() === 'run: |')
  if (run < 0) throw new Error(`step "${name}" has no run block`)
  const indent = lines[run].indexOf('run:') + 2
  const body: string[] = []
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

// The step runs under bash on the runner. Where bash, or node from inside it,
// is missing (a plain Windows shell), the two runs below are skipped.
const canRun = spawnSync('bash', ['-c', 'node -v'], { encoding: 'utf-8' }).status === 0

function runStep(tag: string) {
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', stepScript(publishJob(), STEP)], {
    cwd: root,
    env: { ...process.env, GITHUB_REF_NAME: tag },
    encoding: 'utf-8',
  })
}

describe('ci.yml publish job', () => {
  it('checks the tag against package.json before npm publish', () => {
    const job = publishJob()
    const check = job.indexOf(`- name: ${STEP}`)
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(job.indexOf('- run: npm publish'))
  })

  it.skipIf(!canRun)('fails on a tag that names another version', () => {
    const r = runStep('v0.0.0-other')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`Tag v0.0.0-other does not match the package.json version v${version}.`)
  })

  it.skipIf(!canRun)('passes on the tag for the package.json version', () => {
    const r = runStep(`v${version}`)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })
})
