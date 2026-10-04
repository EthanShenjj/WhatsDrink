import { describe, expect, it, vi } from 'vitest'
const repo = vi.hoisted(() => ({ listFootprints: vi.fn(), getFootprint: vi.fn(), listTravelPlans: vi.fn(async () => []), listTimeCapsules: vi.fn(async () => []) }))
vi.mock('../miniprogram/services/repository', () => repo)
import { buildDataExport, exportableCapsule } from '../miniprogram/services/export'
describe('personal data export', () => {
  it('exports full records instead of a one-photo list summary', async () => {
    repo.listFootprints.mockResolvedValue([{ id: 'a', isSummary: true, photos: ['one'] }])
    repo.getFootprint.mockResolvedValue({ id: 'a', photos: ['one', 'two'], note: '完整短记' })
    const result = JSON.parse(await buildDataExport())
    expect(result.footprints[0].photos).toEqual(['one', 'two'])
    expect(result.schemaVersion).toBe(1)
  })
  it('reports incomplete details instead of silently exporting partial data', async () => {
    repo.listFootprints.mockResolvedValue([{ id: 'a', isSummary: true }])
    repo.getFootprint.mockResolvedValue({ id: 'a', isSummary: true })
    await expect(buildDataExport()).rejects.toThrow('部分记录详情未加载')
  })
  it('never bypasses a locked capsule through local export', () => {
    const capsule: any = { id: 'a', title: '封存', status: 'locked', unlockDate: '2099-01-01', text: '秘密', photos: ['secret'] }
    expect(exportableCapsule(capsule)).toMatchObject({ title: '封存', photos: [] })
    expect(exportableCapsule(capsule).text).toBeUndefined()
    expect(capsule.text).toBe('秘密')
  })
})
