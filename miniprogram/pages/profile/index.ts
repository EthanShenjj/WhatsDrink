import type { DrinkRecord, UserProfile } from '../../domain/types'
import {
  clearAllRecords,
  deleteAccount,
  ensureProfile,
  listRecords,
} from '../../services/repository'
import { dateKey, getWeekDays, summarizeRecords } from '../../utils/date'

Page({
  data: {
    profile: null as UserProfile | null,
    weekDays: [] as Array<ReturnType<typeof getWeekDays>[number] & { count: number }>,
    weekCount: 0,
    weekCalories: 0,
    weekUnknownCalories: 0,
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
  editProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/index' })
  },
  openCalendar() {
    wx.switchTab({ url: '/pages/calendar/index' })
  },
  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },
  clearRecords() {
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
  removeAccount() {
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
