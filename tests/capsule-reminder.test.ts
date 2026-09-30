import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type CapsuleRow = {
  _id: string
  _openid: string
  title: string
  unlockDate: string
  status: string
  subscriptionId?: string
  reminderAttemptedAt?: number
  reminderSentAt?: number
  reminderFailedAt?: number
  reminderAttempts?: number
  reminderTerminalAt?: number
  [key: string]: unknown
}

const source = readFileSync(
  path.join(process.cwd(), 'cloudfunctions/sendCapsuleReminder/index.js'),
  'utf8',
)

const createHarness = (
  rows: CapsuleRow[],
  templateId = 'template-1',
  extraEnv: Record<string, string> = {},
) => {
  const records = rows.map((row) => ({ ...row }))
  const send = vi.fn(async (_payload: Record<string, unknown>) => ({}))
  const command = {
    lte: (value: string | number) => ({ lte: value }),
    exists: (value: boolean) => ({ exists: value }),
  }
  const matches = (row: CapsuleRow, query: Record<string, unknown>): boolean =>
    Object.entries(query).every(([key, expected]) => {
      const actual = row[key]
      if (expected && typeof expected === 'object' && 'lte' in expected) {
        return String(actual) <= String(expected.lte)
      }
      if (expected && typeof expected === 'object' && 'exists' in expected) {
        return (actual !== undefined) === expected.exists
      }
      return actual === expected
    })
  const collection = {
    where: (query: Record<string, unknown>) => ({
      limit: (count: number) => ({
        get: async () => ({ data: records.filter((row) => matches(row, query)).slice(0, count) }),
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        const selected = records.filter((row) => matches(row, query))
        selected.forEach((row) => Object.assign(row, data))
        return { stats: { updated: selected.length } }
      },
    }),
    doc: (id: string) => ({
      update: async ({ data }: { data: Record<string, unknown> }) => {
        const row = records.find((item) => item._id === id)
        if (row) Object.assign(row, data)
      },
    }),
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test',
    init: () => {},
    database: () => ({ collection: () => collection, command }),
    getWXContext: () => ({}),
    openapi: { subscribeMessage: { send } },
  }
  const exports: { main?: () => Promise<{ ok: boolean; data?: unknown }> } = {}
  runInNewContext(source, {
    require: () => cloud,
    exports,
    process: { env: { CAPSULE_TEMPLATE_ID: templateId, ...extraEnv } },
    console: { warn: () => {} },
    Date,
    Intl,
    Object,
  })
  return { records, send, main: exports.main! }
}

const dueDate = '2020-01-01'

describe('scheduled capsule reminders', () => {
  it('sends once even when opening the app unlocked the capsule first', async () => {
    const harness = createHarness([{
      _id: 'capsule-1', _openid: 'user-1', title: '一封信',
      unlockDate: dueDate, status: 'unlocked', subscriptionId: 'template-1',
    }])

    expect((await harness.main()).data).toMatchObject({ unlocked: 0, notified: 1, failed: 0 })
    expect(harness.send).toHaveBeenCalledTimes(1)
    expect(harness.send.mock.calls[0][0]).toMatchObject({
      touser: 'user-1', templateId: 'template-1', page: 'pages/time-capsule/index',
    })
    expect(harness.records[0].reminderSentAt).toBeTypeOf('number')

    await harness.main()
    expect(harness.send).toHaveBeenCalledTimes(1)
  })

  it('unlocks a due capsule and then sends its accepted reminder', async () => {
    const harness = createHarness([{
      _id: 'capsule-2', _openid: 'user-2', title: '明天见',
      unlockDate: dueDate, status: 'locked', subscriptionId: 'template-1',
    }])

    expect((await harness.main()).data).toMatchObject({ unlocked: 1, notified: 1, failed: 0 })
    expect(harness.records[0].status).toBe('unlocked')
  })

  it('keeps a reminder unattempted while the server template is missing', async () => {
    const harness = createHarness([{
      _id: 'capsule-3', _openid: 'user-3', title: '等等我',
      unlockDate: dueDate, status: 'locked', subscriptionId: 'template-1',
    }], '')

    expect((await harness.main()).data).toMatchObject({ unlocked: 1, notified: 0, failed: 0 })
    expect(harness.records[0].reminderAttemptedAt).toBeUndefined()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('keeps a reminder queued when its accepted template differs from the server template', async () => {
    const harness = createHarness([{
      _id: 'capsule-4', _openid: 'user-4', title: '另一封信',
      unlockDate: dueDate, status: 'unlocked', subscriptionId: 'different-template',
    }])

    expect((await harness.main()).data).toMatchObject({ notified: 0, failed: 0 })
    expect(harness.records[0].reminderAttemptedAt).toBeUndefined()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('retries an old failed attempt once and records delivery', async () => {
    const harness = createHarness([{
      _id: 'capsule-5', _openid: 'user-5', title: '再试一次',
      unlockDate: dueDate, status: 'unlocked', subscriptionId: 'template-1',
      reminderAttemptedAt: Date.now() - 86_400_000,
      reminderFailedAt: Date.now() - 86_400_000,
      reminderAttempts: 1,
    }])

    expect((await harness.main()).data).toMatchObject({ notified: 1, failed: 0 })
    expect(harness.records[0].reminderAttempts).toBe(2)
    expect(harness.records[0].reminderSentAt).toBeTypeOf('number')
    await harness.main()
    expect(harness.send).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed send in the same run and stops after three attempts', async () => {
    const harness = createHarness([{
      _id: 'capsule-6', _openid: 'user-6', title: '稍后再试',
      unlockDate: dueDate, status: 'unlocked', subscriptionId: 'template-1',
    }])
    harness.send.mockRejectedValue(new Error('temporary network error'))

    expect((await harness.main()).data).toMatchObject({ notified: 0, failed: 1 })
    expect(harness.send).toHaveBeenCalledTimes(1)
    expect(harness.records[0].reminderAttempts).toBe(1)

    harness.records[0].reminderAttemptedAt = Date.now() - 86_400_000
    await harness.main()
    expect(harness.records[0].reminderAttempts).toBe(2)

    harness.records[0].reminderAttemptedAt = Date.now() - 86_400_000
    await harness.main()
    expect(harness.records[0].reminderAttempts).toBe(3)

    harness.records[0].reminderAttemptedAt = Date.now() - 86_400_000
    await harness.main()
    expect(harness.records[0].reminderTerminalAt).toBeTypeOf('number')
    expect(harness.send).toHaveBeenCalledTimes(3)
  })

  it('uses the configured fields of the approved template', async () => {
    const harness = createHarness([{
      _id: 'capsule-7', _openid: 'user-7', title: '来信',
      unlockDate: dueDate, status: 'unlocked', subscriptionId: 'template-1',
    }], 'template-1', {
      CAPSULE_TITLE_FIELD: 'thing4',
      CAPSULE_DATE_FIELD: 'time5',
      CAPSULE_NOTE_FIELD: 'thing6',
    })

    await harness.main()
    expect(harness.send.mock.calls[0][0].data).toMatchObject({
      thing4: { value: '来信' },
      time5: { value: '2020年1月1日' },
      thing6: { value: '你的时间胶囊已解锁，快来看看吧' },
    })
  })
})
