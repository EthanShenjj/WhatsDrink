import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

let definition: Record<string, any>
let page: Record<string, any>

beforeAll(async () => {
  ;(globalThis as any).Page = (value: Record<string, any>) => { definition = value }
  await import('../miniprogram/pages/ticket-share/index')
})

beforeEach(() => {
  page = {
    ...definition,
    data: { ...definition.data },
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch) },
  }
})

describe('shared memory ticket', () => {
  it('opens a self-contained ticket without loading its owner’s private record', () => {
    const payload = { name: '西湖', date: '2026-10-01', location: '杭州', code: 'SGJ-01-ABCDE', note: '私人短记' }
    page.onLoad({ ticket: encodeURIComponent(JSON.stringify(payload)) })
    expect(page.data.ticket).toEqual({ name: '西湖', date: '2026-10-01', location: '杭州', code: 'SGJ-01-ABCDE' })
    expect(page.onShareAppMessage().path).not.toContain('私人短记')
  })

  it('shows an expired state for invalid links', () => {
    page.onLoad({ ticket: 'invalid' })
    expect(page.data.ticket).toBeNull()
  })
})
