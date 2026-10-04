import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  uploadPhoto: vi.fn(), deletePhotos: vi.fn(async () => undefined), saveTimeCapsule: vi.fn(),
  listTimeCapsules: vi.fn(async () => []), listFootprints: vi.fn(async () => []),
  ensureProfile: vi.fn(async () => ({})), unlockTimeCapsule: vi.fn(), deleteTimeCapsule: vi.fn(),
}))
vi.mock('../miniprogram/services/repository', () => repo)
let definition: any
const page = () => ({ ...definition, data: structuredClone(definition.data), setData(patch: any) { Object.assign(this.data, patch) } })
beforeAll(async () => {
  ;(globalThis as any).Page = (value: any) => { definition = value }
  ;(globalThis as any).wx = { showToast: vi.fn(), chooseMedia: vi.fn(), showModal: vi.fn() }
  await import('../miniprogram/pages/time-capsule/index')
})
beforeEach(() => { repo.uploadPhoto.mockReset(); repo.saveTimeCapsule.mockReset(); repo.deletePhotos.mockClear() })

describe('capsule uploads and locked management', () => {
  it('blocks save until all selected photos are finished', async () => {
    const p = page()
    let finish!: (value: string) => void
    repo.uploadPhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    p.setData({ title: '测试胶囊', text: '给未来', formVisible: true })
    const uploading = p.uploadPhotos(['temp-photo'])
    await p.onSave()
    expect(repo.saveTimeCapsule).not.toHaveBeenCalled()
    finish('cloud://uploaded')
    await uploading
    await p.onSave()
    expect(repo.saveTimeCapsule.mock.calls[0][0].photos).toEqual(['cloud://uploaded'])
  })

  it('keeps successful photos and only retries failed photos', async () => {
    const p = page()
    repo.uploadPhoto.mockImplementation(async (path: string) => {
      if (path === 'failed') throw new Error('network')
      return `cloud://${path}`
    })
    await p.uploadPhotos(['good', 'failed'])
    expect(p.data.photos).toEqual(['cloud://good'])
    expect(p.data.failedPhotos).toEqual(['failed'])
    repo.uploadPhoto.mockResolvedValue('cloud://retried')
    await p.uploadPhotos(p.data.failedPhotos)
    expect(p.data.photos).toEqual(['cloud://good', 'cloud://retried'])
    expect(p.data.failedPhotos).toEqual([])
  })

  it('does not attach uploads to an already-cancelled form', async () => {
    const p = page()
    let finish!: (value: string) => void
    repo.uploadPhoto.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    p.setData({ formVisible: true })
    const uploading = p.uploadPhotos(['temp-photo'])
    p.onCancel()
    finish('cloud://abandoned')
    await uploading
    expect(p.data.photos).toEqual([])
    expect(repo.deletePhotos).toHaveBeenCalledWith(['cloud://abandoned'])
  })

  it('opens management for a locked capsule without exposing its sealed content', () => {
    const p = page()
    p.setData({ capsules: [{ id: 'locked', status: 'locked', title: '测试', unlockDate: '2099-01-01', text: '秘密', photos: ['secret-photo'] }] })
    p.onCapsuleTap({ currentTarget: { dataset: { id: 'locked' } } })
    expect(p.data.selectedCapsule.id).toBe('locked')
    expect(p.data.selectedCapsule.text).toBeUndefined()
    expect(p.data.selectedCapsule.photos).toEqual([])
  })
})
