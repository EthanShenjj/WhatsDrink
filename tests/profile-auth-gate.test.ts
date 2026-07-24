import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('profile authentication gate', () => {
  it('requires login before every interactive profile action', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')
    const templateSource = readFileSync('miniprogram/pages/profile/index.wxml', 'utf8')
    const handlers = Array.from(
      templateSource.matchAll(/bindtap="([^"]+)"/g),
      (match) => match[1],
    )

    expect(handlers).toEqual([
      'editProfile',
      'openCalendar',
      'openPrivacy',
      'clearRecords',
      'removeAccount',
    ])
    expect(pageSource).toContain('loginForRecordAccess')

    handlers.forEach((handler) => {
      expect(pageSource).toMatch(
        new RegExp(
          `async ${handler}\\(\\) \\{\\s+if \\(!\\(await requireProfileLogin\\(this\\)\\)\\) return`,
        ),
      )
    })
  })

  it('collects and saves the selected WeChat avatar and nickname in a bottom sheet', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')
    const templateSource = readFileSync('miniprogram/pages/profile/index.wxml', 'utf8')

    expect(templateSource).toContain('wx:if="{{loginSheetVisible}}"')
    expect(templateSource).toContain('open-type="chooseAvatar"')
    expect(templateSource).toContain('bindchooseavatar="chooseLoginAvatar"')
    expect(templateSource).toContain('type="nickname"')
    expect(templateSource).toContain('bindsubmit="confirmProfileLogin"')
    expect(templateSource).toContain('<privacy-popup />')
    expect(pageSource).toContain('await uploadRecordPhoto(loginAvatarUrl)')
    expect(pageSource).toContain('await saveProfile({ nickname, avatarUrl })')
    expect(pageSource).not.toContain("title: '登录后继续'")
  })

  it('still requests profile setup when wx.login succeeded but avatar and nickname are missing', () => {
    const pageSource = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')

    expect(pageSource).toContain('host.data.profile')
    expect(pageSource).toContain("profile.nickname !== '饮品记录者'")
    expect(pageSource).toContain('if (hasRecordAccess() && profileReady)')
  })
})
