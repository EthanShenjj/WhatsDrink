import type {
  ReminderSubscriptionDecision,
  ReminderSubscriptionStatus,
} from '../domain/types'
import { USE_CLOUD } from './config'

interface ReminderSubscriptionConfig extends ReminderSubscriptionStatus {
  templateId: string
}

interface SubscriptionCloudResult<T> {
  ok: boolean
  data?: T
  message?: string
}

const callSubscriptionCloud = async <T>(
  data: Record<string, unknown>,
): Promise<T> => {
  const response = await wx.cloud.callFunction({
    name: 'subscriptionMutation',
    data,
  })
  const result = response.result as SubscriptionCloudResult<T>
  if (!result?.ok) {
    throw new Error(result?.message || '订阅提醒操作失败')
  }
  return result.data as T
}

const unavailableStatus = (): ReminderSubscriptionStatus => ({
  configured: false,
  enabled: false,
  remainingCount: 0,
  reminderTime: '20:00',
  lastDecision: '',
  lastSentDate: '',
})

export const getDailyReminderStatus =
  async (): Promise<ReminderSubscriptionStatus> => {
    if (!USE_CLOUD || !wx.cloud) return unavailableStatus()
    return callSubscriptionCloud<ReminderSubscriptionStatus>({
      action: 'getStatus',
    })
  }

export const getDailyReminderConfig =
  async (): Promise<ReminderSubscriptionConfig> => {
    if (!USE_CLOUD || !wx.cloud) {
      return { ...unavailableStatus(), templateId: '' }
    }
    return callSubscriptionCloud<ReminderSubscriptionConfig>({
      action: 'getConfig',
    })
  }

const requestSubscribeMessage = (
  templateId: string,
): Promise<ReminderSubscriptionDecision> =>
  new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        const decision = result[templateId]
        if (
          decision === 'accept' ||
          decision === 'reject' ||
          decision === 'ban' ||
          decision === 'filter'
        ) {
          resolve(decision)
          return
        }
        reject(new Error('微信未返回有效的订阅结果'))
      },
      fail: (error) => {
        reject(new Error(error.errMsg || '无法调起微信订阅授权'))
      },
    })
  })

export const requestDailyReminderSubscription = async (
  templateId: string,
): Promise<{
  decision: ReminderSubscriptionDecision
  status: ReminderSubscriptionStatus
}> => {
  if (!USE_CLOUD || !wx.cloud) {
    throw new Error('订阅提醒需要连接微信云开发环境')
  }
  if (!templateId) {
    throw new Error('订阅消息模板尚未配置')
  }

  const decision = await requestSubscribeMessage(templateId)
  const status = await callSubscriptionCloud<ReminderSubscriptionStatus>({
    action: 'recordDecision',
    decision,
  })
  return { decision, status }
}
