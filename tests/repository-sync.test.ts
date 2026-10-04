import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Footprint, FootprintDraft } from '../miniprogram/domain/types'

const keys = { full: 'shiguangji:footprints', pending: 'shiguangji:pending-footprints' }
let storage: Record<string, any>
let online: boolean
let committedTimeout: boolean
let rejectBusiness: boolean
let cloud: Map<string, Footprint>
let calls: Array<{ name: string; data: any }>
const draft = (patch: Partial<FootprintDraft> = {}): FootprintDraft => ({
  status: 'visited', poiName: '测试地点', visitDate: '2026-10-01', photos: [], tags: [], source: 'manual',
  clientRequestId: 'req-stable', ...patch,
})
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))

beforeEach(() => {
  vi.resetModules()
  storage = {}
  cloud = new Map()
  calls = []
  online = true
  committedTimeout = false
  rejectBusiness = false
  ;(globalThis as any).getApp = () => ({ globalData: {} })
  ;(globalThis as any).wx = {
    getStorageSync: (key: string) => clone(storage[key]),
    setStorageSync: (key: string, value: any) => { storage[key] = clone(value) },
    setStorage: ({ key, data, success }: any) => { storage[key] = clone(data); success() },
    removeStorageSync: (key: string) => { delete storage[key] },
    getFileSystemManager: () => ({ unlink: ({ success }: any) => success() }),
    getImageInfo: ({ fail }: any) => fail(new Error('unsupported')),
    cloud: {
      init: vi.fn(),
      uploadFile: vi.fn(async ({ cloudPath }: any) => ({ fileID: `cloud://test/${cloudPath}` })),
      deleteFile: vi.fn(async () => undefined),
      callFunction: vi.fn(async ({ name, data }: any) => {
        calls.push({ name, data: clone(data) })
        if (!online) throw new Error('network offline')
        if (name === 'login') return { result: { ok: true, data: { id: 'cloud-user', nickname: '', avatarUrl: '', createdAt: 1, updatedAt: 1 } } }
        if (name === 'accountMutation') { cloud.clear(); return { result: { ok: true } } }
        if (data.action === 'list') return { result: { ok: true, data: [...cloud.values()].map((fp) => ({ ...fp, isSummary: true })) } }
        if (data.action === 'get') return { result: { ok: Boolean(cloud.get(data.id)), data: cloud.get(data.id) } }
        if (rejectBusiness) return { result: { ok: false, message: '日期不合法' } }
        if (data.action === 'delete') {
          const exists = cloud.delete(data.id)
          return { result: { ok: exists, message: '足迹不存在或无权操作' } }
        }
        if (data.action === 'fulfillWishlist') {
          const wish = cloud.get(data.id)!
          const visit = { ...data.visit, id: `visit-${data.id}`, userId: 'cloud-user', pendingSync: undefined, createdAt: 1, updatedAt: 1 }
          const fulfilled = { ...wish, status: 'fulfilled', fulfilledVisitId: visit.id }
          cloud.set(visit.id, visit)
          cloud.set(wish.id, fulfilled as Footprint)
          return { result: { ok: true, data: { wish: fulfilled, visit } } }
        }
        let fp = { ...data.footprint, userId: 'cloud-user', pendingSync: undefined }
        if (data.action === 'create') fp = [...cloud.values()].find((item) => item.clientRequestId === fp.clientRequestId) || fp
        cloud.set(fp.id, fp)
        if (committedTimeout) { committedTimeout = false; throw new Error('response timeout after commit') }
        return { result: { ok: true, data: clone(fp) } }
      }),
    },
  }
})

describe('footprint durable synchronization', () => {
  it('exposes cloud list failure even when an empty local cache is returned', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    online = false
    expect(await repo.listFootprints()).toEqual([])
    expect(repo.didFootprintCloudLoadFail()).toBe(true)
    online = true
    expect(await repo.listFootprints()).toEqual([])
    expect(repo.didFootprintCloudLoadFail()).toBe(false)
  })
  it('removes a record locally without waiting for an in-flight cloud write', async () => {
    const repo = await import('../miniprogram/services/repository')
    online = false
    const saved = await repo.saveFootprint(draft())
    online = true
    await repo.loginForAccess({ force: true })
    const original = vi.mocked(wx.cloud.callFunction).getMockImplementation()!
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(wx.cloud.callFunction).mockImplementation(async (input: any) => {
      if (input.data?.action === 'create') await gate
      return original(input)
    })
    const sync = repo.syncPendingFootprints()
    await vi.waitFor(() => expect(vi.mocked(wx.cloud.callFunction).mock.calls.some(([input]) => input.data?.action === 'create')).toBe(true))
    await repo.deleteFootprint(saved.id)
    expect((await repo.listFootprints({ maxAgeMs: 60_000 })).some((item) => item.id === saved.id)).toBe(false)
    release()
    await sync
    await vi.waitFor(() => expect(cloud.size).toBe(0))
  })
  it('keeps offline records visible after cloud recovery and uploads them once', async () => {
    const repo = await import('../miniprogram/services/repository')
    online = false
    const local = await repo.saveFootprint(draft())
    expect(local.pendingSync).toBe(true)
    expect(storage[keys.pending]).toHaveLength(1)
    online = true
    await repo.loginForAccess({ force: true })
    const visible = await repo.listFootprints()
    expect(visible.some((fp) => fp.id === local.id)).toBe(true)
    await repo.syncPendingFootprints()
    expect(cloud.size).toBe(1)
    expect(storage[keys.pending]).toEqual([])
    expect((await repo.listFootprints()).map((fp) => fp.id)).toEqual([local.id])
  })

  it('migrates legacy local-user records instead of replacing them with the cloud list', async () => {
    storage[keys.full] = [{ ...draft(), id: 'old-local', clientRequestId: 'old-req', userId: 'local-user', createdAt: 1, updatedAt: 1 }]
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    expect((await repo.listFootprints()).some((fp) => fp.id === 'old-local')).toBe(true)
    await repo.syncPendingFootprints()
    expect(cloud.has('old-local')).toBe(true)
    expect(storage[keys.pending]).toEqual([])
  })

  it('uses stable request identity when a server commit times out', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    committedTimeout = true
    const saved = await repo.saveFootprint(draft())
    await repo.syncPendingFootprints()
    const retried = await repo.saveFootprint(draft())
    expect(retried.id).toBe(saved.id)
    expect(cloud.size).toBe(1)
    expect(calls.filter((call) => call.data.action === 'create').every((call) => call.data.footprint.clientRequestId === 'req-stable')).toBe(true)
  })

  it('does not turn business validation errors into a fake successful local save', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    rejectBusiness = true
    await expect(repo.saveFootprint(draft())).rejects.toThrow('日期不合法')
    expect(storage[keys.pending] || []).toEqual([])
  })

  it('serializes full-detail cache writes for simultaneous saves', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    await Promise.all([repo.saveFootprint(draft()), repo.saveFootprint(draft({ clientRequestId: 'req-second' }))])
    expect(storage[keys.full]).toHaveLength(2)
  })

  it('uploads local photos before syncing an offline record', async () => {
    const repo = await import('../miniprogram/services/repository')
    online = false
    const saved = await repo.saveFootprint(draft({ photos: ['wxfile://local-photo'], photoThumbs: ['wxfile://local-thumb'] }))
    online = true
    await repo.loginForAccess({ force: true })
    await repo.syncPendingFootprints()
    expect(cloud.get(saved.id)?.photos[0]).toContain('/cloud-user/')
    expect(cloud.get(saved.id)?.photoThumbs?.[0]).toContain('/cloud-user/')
    expect(storage[keys.pending]).toEqual([])
  })

  it('preserves the original create identity when an offline record is edited before synchronization', async () => {
    const repo = await import('../miniprogram/services/repository')
    online = false
    const fp = await repo.saveFootprint(draft())
    await repo.saveFootprint(draft({ id: fp.id, clientRequestId: 'new-edit-request', note: '编辑后的短记' }))
    expect(storage[keys.pending][0].footprint.clientRequestId).toBe('req-stable')
    online = true
    await repo.loginForAccess({ force: true })
    await repo.syncPendingFootprints()
    expect(cloud.size).toBe(1)
    expect(cloud.get(fp.id)?.note).toBe('编辑后的短记')
    expect(storage[keys.pending]).toEqual([])
  })

  it('keeps an offline wishlist conversion atomic and removes its temporary visit id', async () => {
    const repo = await import('../miniprogram/services/repository')
    online = false
    const wish = await repo.saveFootprint(draft({ status: 'wishlist', visitDate: undefined }))
    const result = await repo.fulfillWishlistFootprint(wish.id, draft({ clientRequestId: 'visit-request' }))
    online = true
    await repo.loginForAccess({ force: true })
    await repo.syncPendingFootprints()
    expect(storage[keys.pending]).toEqual([])
    expect(cloud.get(wish.id)?.status).toBe('fulfilled')
    expect((await repo.listFootprints()).filter((fp) => fp.status === 'visited')).toHaveLength(1)
    expect(storage[keys.full].some((fp: Footprint) => fp.id === result.visit.id)).toBe(false)
  })

  it('does not resurrect an offline deletion when cloud is restored', async () => {
    const repo = await import('../miniprogram/services/repository')
    await repo.loginForAccess()
    const fp = await repo.saveFootprint(draft())
    online = false
    // Simulate app restart while offline; an existing cloud record remains cached.
    vi.resetModules()
    const offlineRepo = await import('../miniprogram/services/repository')
    await offlineRepo.ensureProfile()
    await offlineRepo.deleteFootprint(fp.id)
    expect(await offlineRepo.listFootprints()).toEqual([])
    online = true
    await offlineRepo.loginForAccess({ force: true })
    await offlineRepo.syncPendingFootprints()
    expect(cloud.size).toBe(0)
    expect(await offlineRepo.listFootprints()).toEqual([])
  })
})
