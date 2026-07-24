import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('record mutation authorization', () => {
  it('rejects create when a client-supplied id belongs to another user', () => {
    const result = spawnSync(
      process.execPath,
      ['tests/fixtures/record-mutation-auth.cjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    expect(result.status, result.stderr).toBe(0)
  })
})
