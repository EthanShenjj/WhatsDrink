import { describe, expect, it } from 'vitest'
import Module from 'node:module'

type Saved = Record<string, unknown>
type Result = { ok: boolean; data?: Saved; message?: string }

function loadMutation() {
  const cjsModule = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
  }
  const cjsRequire = require as unknown as {
    (path: string): unknown
    resolve: (path: string) => string
    cache: Record<string, unknown>
  }
  const documents = new Map<string, Saved>()
  const collection = {
    where(query: Saved) {
      return {
        limit() { return this },
        async get() {
          return { data: [...documents].filter(([id, data]) =>
            Object.entries(query).every(([key, value]) => (key === '_id' ? id : data[key]) === value),
          ).map(([id, data]) => ({ ...data, _id: id })) }
        },
      }
    },
    doc(id: string) {
      return {
        async set({ data }: { data: Saved }) { documents.set(id, data) },
        async get() {
          const data = documents.get(id)
          if (!data) throw new Error('not found')
          return { data: { ...data, _id: id } }
        },
      }
    },
  }
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test', init() {},
    database() { return { collection() { return collection } } },
    getWXContext() { return { OPENID: 'owner-1' } },
  }
  const originalLoad = cjsModule._load
  cjsModule._load = function (request: string, parent: NodeModule | null, isMain: boolean) {
    return request === 'wx-server-sdk' ? sdk : originalLoad.call(this, request, parent, isMain)
  }
  try {
    const path = cjsRequire.resolve('../cloudfunctions/footprintMutation/index.js')
    delete cjsRequire.cache[path]
    const mutation = cjsRequire(path) as { main: (event: Saved) => Promise<Result> }
    return { main: mutation.main, documents }
  } finally {
    cjsModule._load = originalLoad
  }
}

const city = (requestId: string, patch: Saved = {}) => ({
  action: 'create',
  footprint: {
    status: 'visited', recordLevel: 'city', poiName: '成都', country: '中国',
    province: '四川', city: '成都', photos: [], tags: [], source: 'manual',
    clientRequestId: requestId, ...patch,
  },
})

describe('cloud city creation', () => {
  it('keeps a city unique across distinct requests and leaves date and coordinates empty', async () => {
    const { main, documents } = loadMutation()
    const first = await main(city('first'))
    const repeated = await main(city('second'))
    expect(first.ok).toBe(true)
    expect(repeated.ok).toBe(true)
    expect(repeated.data?.id).toBe(first.data?.id)
    expect(documents.size).toBe(1)
    expect(first.data?.visitDate).toBeUndefined()
    expect(first.data?.lat).toBeUndefined()
    expect(first.data?.lng).toBeUndefined()
  })

  it('rejects invalid data even when its city or request identity matches an existing record', async () => {
    const { main, documents } = loadMutation()
    expect((await main(city('first'))).ok).toBe(true)
    expect((await main(city('second', { country: '日本' }))).ok).toBe(false)
    expect((await main(city('first', { note: 'private' }))).ok).toBe(false)
    expect(documents.size).toBe(1)
  })
})
