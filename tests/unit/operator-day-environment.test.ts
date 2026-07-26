import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('loads the operator-day module in the Node runtime', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx/esm',
      '--input-type=module',
      '-e',
      "await import('./src/features/home/operator-day.ts')",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    },
  )

  expect(result.status, result.stderr || result.stdout).toBe(0)
})
