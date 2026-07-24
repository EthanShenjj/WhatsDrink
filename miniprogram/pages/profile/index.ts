import type { DrinkRecord, UserProfile } from '../../domain/types'
import {
  clearAllRecords,
  deleteAccount,
  ensureProfile,
  hasRecordAccess,
  listRecords,
  loginForRecordAccess,
  saveProfile,
  uploadRecordPhoto,
} from '../../services/repository'
import { dateKey, getWeekDays, summarizeRecords } from '../../utils/date'

let profileLoginPromise: Promise<boolean> | null = null
let resolveProfileLogin: ((authenticated: boolean) => void) | null = null

interface ProfileLoginHost {
  data: {
    profile: UserProfile | null
  }
  setData(data: Record<string, unknown>): void
}

const requireProfileLogin = (host: ProfileLoginHost): Promise<boolean> => {
  const profile = host.data.profile
  const profileReady = Boolean(
    profile?.avatarUrl &&
      profile.nickname.trim() &&
      profile.nickname !== '饮品记录者',
  )
  if (hasRecordAccess() && profileReady) return Promise.resolve(true)
  if (profileLoginPromise) return Promise.resolve(false)

  host.setData({
    loginSheetVisible: true,
    loginAvatarUrl: '',
    loginNickname: '',
  })
  profileLoginPromise = new Promise((resolve) => {
    resolveProfileLogin = resolve
  })
  return profileLoginPromise
}

const settleProfileLogin = (host: ProfileLoginHost, authenticated: boolean): void => {
  host.setData({ loginSheetVisible: false, loginSaving: false })
  resolveProfileLogin?.(authenticated)
  resolveProfileLogin = null
  profileLoginPromise = null
}

Page({
  data: {
    profile: null as UserProfile | null,
    weekDays: [] as Array<ReturnType<typeof getWeekDays>[number] & { count: number }>,
    weekCount: 0,
    weekCalories: 0,
    weekUnknownCalories: 0,
    loginSheetVisible: false,
    loginAvatarUrl: '',
    loginNickname: '',
    loginSaving: false,
  },
  onShow() {
    this.getTabBar?.()?.setData({ selected: 3 })
    this.loadData()
  },
  async loadData() {
    const [profile, records] = await Promise.all([ensureProfile(), listRecords()])
    const week = getWeekDays()
    const keys = new Set(week.map((day) => day.key))
    const weekRecords = records.filter((record) => keys.has(dateKey(record.consumedAt)))
    const byKey = weekRecords.reduce<Record<string, DrinkRecord[]>>((result, record) => {
      const key = dateKey(record.consumedAt)
      result[key] = result[key] || []
      result[key].push(record)
      return result
    }, {})
    const summary = summarizeRecords(weekRecords)
    this.setData({
      profile,
      weekDays: week.map((day) => ({ ...day, count: byKey[day.key]?.length || 0 })),
      weekCount: summary.count,
      weekCalories: summary.knownCalories,
      weekUnknownCalories: summary.unknownCaloriesCount,
    })
  },
  chooseLoginAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ loginAvatarUrl: event.detail.avatarUrl })
  },
  updateLoginNickname(event: WechatMiniprogram.Input) {
    this.setData({ loginNickname: event.detail.value })
  },
  async confirmProfileLogin(event: WechatMiniprogram.FormSubmit) {
    if (this.data.loginSaving) return
    const nickname = String(event.detail.value.nickname || this.data.loginNickname).trim()
    const loginAvatarUrl = this.data.loginAvatarUrl
    if (!loginAvatarUrl) {
      wx.showToast({ title: '请选择微信头像', icon: 'none' })
      return
    }
    if (!nickname) {
      wx.showToast({ title: '请填写微信昵称', icon: 'none' })
      return
    }

    this.setData({ loginSaving: true })
    try {
      await loginForRecordAccess()
      const avatarUrl = await uploadRecordPhoto(loginAvatarUrl)
      const profile = await saveProfile({ nickname, avatarUrl })
      this.setData({ profile })
      settleProfileLogin(this, true)
    } catch {
      this.setData({ loginSaving: false })
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    }
  },
  cancelProfileLogin() {
    if (this.data.loginSaving) return
    settleProfileLogin(this, false)
  },
  preventLoginSheetClose() {},
  onUnload() {
    if (profileLoginPromise) settleProfileLogin(this, false)
  },
  async editProfile() {
    if (!(await requireProfileLogin(this))) return
    wx.navigateTo({ url: '/pages/profile-edit/index' })
  },
  async openCalendar() {
    if (!(await requireProfileLogin(this))) return
    wx.switchTab({ url: '/pages/calendar/index' })
  },
  async openPrivacy() {
    if (!(await requireProfileLogin(this))) return
    wx.navigateTo({ url: '/pages/privacy/index' })
  },
  async clearRecords() {
    if (!(await requireProfileLogin(this))) return
    wx.showModal({
      title: '清除全部记录？',
      content: '这会删除所有饮品记录和照片，但保留转盘与个人资料。此操作无法恢复。',
      confirmText: '全部清除',
      confirmColor: '#A54B3F',
      success: async (result) => {
        if (!result.confirm) return
        await clearAllRecords()
        wx.showToast({ title: '记录已清除', icon: 'success' })
        this.loadData()
      },
    })
  },
  async removeAccount() {
    if (!(await requireProfileLogin(this))) return
    wx.showModal({
      title: '注销 WhatsDrink 账号？',
      content: '个人资料、饮品记录、照片和自定义转盘都会被永久删除。',
      confirmText: '继续注销',
      confirmColor: '#A54B3F',
      success: (first) => {
        if (!first.confirm) return
        wx.showModal({
          title: '最后确认',
          content: '注销后数据无法恢复。确定继续吗？',
          confirmText: '确认注销',
          confirmColor: '#A54B3F',
          success: async (second) => {
            if (!second.confirm) return
            await deleteAccount()
            wx.showToast({ title: '账号已注销', icon: 'success' })
            await ensureProfile()
            wx.switchTab({ url: '/pages/home/index' })
          },
        })
      },
    })
  },
})
