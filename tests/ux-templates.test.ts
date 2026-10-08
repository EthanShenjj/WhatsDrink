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
  it('unmounts the native quick check-in overlay while any map sheet is open', () => {
    const map = read('pages/map/index.wxml')
    const tab = read('custom-tab-bar/index.ts')
    expect(map).toContain('!recordSheetVisible && !checkinVisible && !checkinClosing && !detailVisible && !detailClosing && !filterVisible')
    expect(tab).toContain('this.syncMapRecordSheet(true)')
    expect(tab).toContain('this.syncMapRecordSheet(false)')
  })
  it('shows immediate progress for quick check-in and keeps common action buttons compact', () => {
    const map = read('pages/map/index.wxml')
    const appStyles = read('app.wxss')
    const tabStyles = read('custom-tab-bar/index.wxss')
    expect(map).toContain("isLocating ? '正在定位' : '快捷打卡'")
    expect(appStyles).toMatch(/\.primary-button\s*\{[\s\S]*?min-height:\s*88rpx/)
    expect(appStyles).not.toMatch(/\.primary-button\s*\{[\s\S]*?min-height:\s*96rpx/)
    expect(tabStyles).toMatch(/\.tab-sheet-option\s*\{[\s\S]*?min-height:\s*88rpx/)
  })
  it('uses the same guide page title as its entry and content', () => {
    expect(JSON.parse(read('pages/guide/index.json')).navigationBarTitleText).toBe('想去与计划')
  })
  it('provides a persistent map reload control and a filtered-empty recovery action', () => {
    expect(read('pages/map/index.wxml')).toContain('bind:reload="retryMapLoad"')
    expect(read('pages/map/index.wxml')).toContain("activeFilterCount ? '清除筛选'")
  })
  it('shows membership status before Lumi growth and keeps tier selection explicit', () => {
    const mine = read('pages/mine/index.wxml')
    const membership = read('pages/membership/index.wxml')
    expect(mine.indexOf('membership-card')).toBeLessThan(mine.indexOf('growth-card'))
    expect(membership).toContain('全部等级对比')
    expect(membership).toContain('data-tier="plus"')
    expect(membership).toContain('data-tier="pro"')
    expect(membership).toContain('31 天卡与 372 天卡权益完全相同')
    expect(membership).not.toContain('scroll-x')
    expect(membership).toContain("membershipLevel.level === 'plus' && selectedTier === 'pro'")
    expect(membership).toContain('class="tier-card-rail"')
    expect(membership).toContain('class="member-pass pass-level-{{previewLevelIndex}}"')
    expect(membership).toContain('class="benefit-icon-grid"')
    expect(membership).not.toContain('class="level-dot"')
    expect(membership).toContain('同步支付结果')
    expect(membership).toContain('bindtap="onOrdersTap"')
  })
  it('paginates order history and describes swipe removal as hiding, not deletion', () => {
    const orders = read('pages/payment-orders/index.wxml')
    expect(orders).toContain('每次显示 10 条')
    expect(orders).toContain('左滑记录可隐藏')
    expect(orders).toContain('隐藏不会删除支付订单')
    expect(orders).toContain('bindtouchend="onOrderTouchEnd"')
  })
  it('falls back to the default profile mark when a remote avatar cannot load', () => {
    const mine = read('pages/mine/index.wxml')
    expect(mine).toContain('!avatarLoadFailed')
    expect(mine).toContain('binderror="onAvatarError"')
  })
  it('exposes Plus historical reports and Pro annual reports from the growth page', () => {
    const growth = read('pages/growth/index.wxml')
    expect(growth).toContain('bindtap="onHistoricalReportTap"')
    expect(growth).toContain('bindtap="onAnnualReportTap"')
    expect(growth).toContain('相邻两年都有记录时，增加跨年对比')
    expect(growth).toContain("membershipLevel.level === 'trial' ? 'Plus 体验权益已生效'")
    expect(growth).toContain("profile.growth.trialStartedAt ? '查看 Plus 方案' : '体验 Plus 权益'")
  })
})
