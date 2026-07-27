import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('release error handling', () => {
  it('reports calendar loading failures instead of leaving an unhandled rejection', () => {
    const source = readFileSync('miniprogram/pages/calendar/index.ts', 'utf8')
    const loadDataStart = source.indexOf('async loadData()')
    const loadDataSource = source.slice(loadDataStart, loadDataStart + 520)

    expect(loadDataStart).toBeGreaterThan(-1)
    expect(loadDataSource).toContain('try {')
    expect(loadDataSource).toContain('catch')
    expect(loadDataSource).toContain('wx.showToast')
  })

  it('guards wheel mutations and gives feedback when cloud operations fail', () => {
    const source = readFileSync('miniprogram/pages/wheel-edit/index.ts', 'utf8')

    expect(source).toContain('operationBusy')
    expect(source).toContain("title: '保存失败，请重试'")
    expect(source).toContain("title: '复制失败，请重试'")
    expect(source).toContain("title: '删除失败，请重试'")
  })

  it('guards destructive profile operations and reports failures', () => {
    const source = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')

    expect(source).toContain('operationBusy')
    expect(source).toContain('清除失败，请检查网络后重试')
    expect(source).toContain('注销失败，请检查网络后重试')
  })
})
