import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { citiesOfProvince } from '../miniprogram/data/regions'
const read = (path: string) => readFileSync(`${process.cwd()}/miniprogram/${path}`, 'utf8')

describe('audited presentation regressions', () => {
  it('keeps cities found in records available even outside the built-in popular-city list', () => {
    expect(citiesOfProvince('浙江', { 浙江: ['衢州'] })).toContain('衢州')
  })
  it('puts mood and note before the advanced-settings collapse', () => {
    const form = read('pages/footprint-form/index.wxml')
    expect(form.indexOf('<mood-picker')).toBeLessThan(form.indexOf('更多设置'))
    expect(form.indexOf('bindinput="onNoteInput"')).toBeLessThan(form.indexOf('更多设置'))
    expect(form.match(/<mood-picker/g)).toHaveLength(1)
  })
  it('only expands decorative albums when photos exist and the user expands them', () => {
    expect(read('pages/time/index.wxml')).toContain('wx:if="{{monthPreviewPhotos.length && albumExpanded}}" class="album-hero"')
  })
  it('does not describe the intermediate check-in step as a completed confirmation', () => {
    const map = read('pages/map/index.wxml')
    expect(map).toContain('继续记录这次到访')
    expect(map).not.toContain('确认在此打卡')
  })
  it('uses the same guide page title as its entry and content', () => {
    expect(JSON.parse(read('pages/guide/index.json')).navigationBarTitleText).toBe('想去与计划')
  })
  it('provides a persistent map reload control and a filtered-empty recovery action', () => {
    expect(read('pages/map/index.wxml')).toContain('bind:reload="retryMapLoad"')
    expect(read('pages/map/index.wxml')).toContain("activeFilterCount ? '清除筛选'")
  })
})
