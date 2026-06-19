import { defineConfig } from 'tsup'

export default defineConfig({
  // Object form names the outputs explicitly so the library lands at a FLAT
  // dist/index.{js,mjs,d.ts} (matching package.json main/module/types/exports)
  // while the CLI stays at dist/bin/cli.{js,mjs} (matching the `bin` field).
  entry: {
    index: 'src/index.ts',
    'bin/cli': 'bin/cli.ts',
  },
  format: ['cjs', 'esm'],
  clean: true,
  dts: true,
  sourcemap: false,
  // Bundle our own src/* into the CLI so dist/bin/cli.js has no relative ../src
  // import to resolve at runtime.
  noExternal: [/^\.\.?\//],
})
