import { beforeAll, describe, expect, it, vi } from 'vitest'
const repo = vi.hoisted(() => ({ saveTravelPlan: vi.fn(async (_draft: unknown) => ({})), listFootprints: vi.fn(), listTravelPlans: vi.fn(), deleteTravelPlan: vi.fn() }))
vi.mock('../miniprogram/services/repository', () => repo)
let definition: any
beforeAll(async () => {
  ;(globalThis as any).Page = (value: any) => { definition = value }
  ;(globalThis as any).wx = { showToast: vi.fn(), navigateBack: vi.fn() }
  await import('../miniprogram/pages/travel-plan/index')
})
describe('travel day changes', () => {
  it('rebuilds day plans after reducing days and saves an internally consistent plan', async () => {
    vi.useFakeTimers()
    const p = { ...definition, data: structuredClone(definition.data), setData(patch: any) { Object.assign(this.data, patch) } }
    p.setData({ title: '旅行', city: '杭州', days: 4, selectedIds: ['a', 'b', 'c', 'd'] })
    p.onGenerate()
    p.onDaysInput({ detail: { value: '2' } })
    expect(p.data.dayPlans.map((day: any) => day.day)).toEqual([1, 2])
    await p.onSave()
    expect(repo.saveTravelPlan.mock.calls[0][0]).toMatchObject({ days: 2, dayPlans: [{ day: 1, poiIds: ['a', 'c'] }, { day: 2, poiIds: ['b', 'd'] }] })
    vi.clearAllTimers()
    vi.useRealTimers()
  })
})
