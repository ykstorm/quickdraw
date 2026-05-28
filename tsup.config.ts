import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'bin/cli.ts'],
  format: ['cjs', 'esm'],
  clean: true,
  dts: false,
})