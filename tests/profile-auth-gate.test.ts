import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('profile access and optional identity', () => {
  it('does not gate navigation behind profile collection', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')

    expect(pageSource).toContain("wx.navigateTo({ url: '/pages/profile-edit/index' })")
    expect(pageSource).toContain("wx.switchTab({ url: '/pages/calendar/index' })")
    expect(pageSource).toContain("wx.navigateTo({ url: '/pages/privacy/index' })")
    expect(pageSource).not.toContain('await requireProfileLogin(this)')
  })

  it('keeps avatar and nickname optional through the profile editor', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')
    const templateSource = readFileSync('miniprogram/pages/profile/index.wxml', 'utf8')

    expect(templateSource).toContain('<privacy-popup />')
    expect(pageSource).not.toContain('requireProfileLogin')
    expect(pageSource).not.toContain('loginSheetVisible')
  })

  it('does not recreate the profile immediately after account deletion', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')

    const deletionStart = pageSource.indexOf('await deleteAccount()')
    expect(deletionStart).toBeGreaterThan(-1)
    expect(pageSource.slice(deletionStart, deletionStart + 220)).not.toContain(
      'await ensureProfile()',
    )
  })

  it('shows profile avatars with a consistent editable circular treatment', () => {
    const profileTemplate = readFileSync('miniprogram/pages/profile/index.wxml', 'utf8')
    const profileStyle = readFileSync('miniprogram/pages/profile/index.wxss', 'utf8')
    const editTemplate = readFileSync('miniprogram/pages/profile-edit/index.wxml', 'utf8')
    const editStyle = readFileSync('miniprogram/pages/profile-edit/index.wxss', 'utf8')
    const editConfig = readFileSync('miniprogram/pages/profile-edit/index.json', 'utf8')

    expect(profileTemplate).toContain('class="avatar-frame"')
    expect(profileTemplate).toContain('catchtap="editProfile"')
    expect(profileTemplate).toContain('class="avatar-camera-badge"')
    expect(profileStyle).toContain('.avatar-frame')
    expect(editTemplate).toContain('class="avatar-edit-placeholder"')
    expect(editTemplate).toContain('class="avatar-edit-badge"')
    expect(editStyle).toContain('.avatar-edit-badge')
    expect(editConfig).toContain('"wd-icon": "/components/local-icon/index"')
  })
})
