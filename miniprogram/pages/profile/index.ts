import type { DrinkRecord, UserProfile } from '../../domain/types'
import {
  clearAllRecords,
  deleteAccount,
  ensureProfile,
  listRecords,
} from '../../services/repository'
import {
  getDailyReminderConfig,
  requestDailyReminderSubscription,
} from '../../services/subscriptions'
import { dateKey, getWeekDays, summarizeRecords } from '../../utils/date'
import type { ReminderSubscriptionStatus } from '../../domain/types'

Page({
  data: {
    profile: null as UserProfile | null,
    weekDays: [] as Array<ReturnType<typeof getWeekDays>[number] & { count: number }>,
    weekCount: 0,
    weekCalories: 0,
    weekUnknownCalories: 0,
    operationBusy: false,
    reminderBusy: false,
    reminderStatus: null as ReminderSubscriptionStatus | null,
    reminderTemplateId: '',
  },
  onShow() {
    this.getTabBar?.()?.setData({ selected: 3 })
    this.loadData()
    this.loadReminderStatus()
  },
  async loadData() {
    try {
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
    } catch {
      wx.showToast({ title: '个人数据加载失败，请重试', icon: 'none' })
    }
  },
  async loadReminderStatus() {
    try {
      const reminderConfig = await getDailyReminderConfig()
      this.setData({
        reminderStatus: reminderConfig,
        reminderTemplateId: reminderConfig.templateId,
      })
    } catch {
      this.setData({ reminderStatus: null, reminderTemplateId: '' })
    }
  },
  async subscribeReminder() {
    if (this.data.reminderBusy) return
    if (!this.data.reminderTemplateId) {
      wx.showToast({ title: '订阅消息模板尚未配置', icon: 'none' })
      return
    }
    const subscriptionPromise = requestDailyReminderSubscription(
      this.data.reminderTemplateId,
    )
    this.setData({ reminderBusy: true })
    try {
      const { decision, status } = await subscriptionPromise
      this.setData({ reminderStatus: status })
      const title =
        decision === 'accept'
          ? '已订阅今晚提醒'
          : decision === 'ban'
            ? '该模板暂不可订阅'
            : '未获得订阅授权'
      wx.showToast({ title, icon: decision === 'accept' ? 'success' : 'none' })
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '订阅失败，请重试',
        icon: 'none',
      })
    } finally {
      this.setData({ reminderBusy: false })
    }
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
    if (this.data.operationBusy) return
    wx.showModal({
      title: '清除全部记录？',
      content: '这会删除所有饮品记录和照片，但保留转盘与个人资料。此操作无法恢复。',
      confirmText: '全部清除',
      confirmColor: '#A54B3F',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ operationBusy: true })
        try {
          await clearAllRecords()
          wx.showToast({ title: '记录已清除', icon: 'success' })
          await this.loadData()
        } catch {
          wx.showToast({ title: '清除失败，请检查网络后重试', icon: 'none' })
        } finally {
          this.setData({ operationBusy: false })
        }
      },
    })
  },
  removeAccount() {
    if (this.data.operationBusy) return
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
            this.setData({ operationBusy: true })
            try {
              await deleteAccount()
              this.setData({
                profile: null,
                weekDays: [],
                weekCount: 0,
                weekCalories: 0,
                weekUnknownCalories: 0,
              })
              wx.showToast({ title: '账号已注销', icon: 'success' })
              wx.switchTab({ url: '/pages/home/index' })
            } catch {
              wx.showToast({ title: '注销失败，请检查网络后重试', icon: 'none' })
            } finally {
              this.setData({ operationBusy: false })
            }
          },
        })
      },
    })
  },
})
