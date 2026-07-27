import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const optionalRequire = (file: string): Record<string, unknown> =>
  existsSync(resolve(file)) ? require(resolve(file)) : {}

describe('daily drink reminder subscription', () => {
  it('opens the WeChat authorization dialog before making an asynchronous cloud call', async () => {
    const calls: string[] = []
    const previousWx = (globalThis as Record<string, unknown>).wx
    ;(globalThis as Record<string, unknown>).wx = {
      requestSubscribeMessage: ({
        tmplIds,
        success,
      }: {
        tmplIds: string[]
        success(result: Record<string, string>): void
      }) => {
        calls.push('subscribe')
        success({ [tmplIds[0]]: 'accept' })
      },
      cloud: {
        callFunction: async ({
          data,
        }: {
          data: { action: string }
        }) => {
          calls.push(`cloud:${data.action}`)
          return {
            result: {
              ok: true,
              data:
                data.action === 'getConfig'
                  ? {
                      configured: true,
                      templateId: 'template-1',
                      enabled: false,
                      remainingCount: 0,
                      reminderTime: '20:00',
                      lastDecision: '',
                      lastSentDate: '',
                    }
                  : {
                      configured: true,
                      enabled: true,
                      remainingCount: 1,
                      reminderTime: '20:00',
                      lastDecision: 'accept',
                      lastSentDate: '',
                    },
            },
          }
        },
      },
    }

    try {
      const service = await import('../miniprogram/services/subscriptions')
      const subscribe = service.requestDailyReminderSubscription as unknown as (
        templateId: string,
      ) => Promise<unknown>
      await subscribe('template-1')
      expect(calls[0]).toBe('subscribe')
      expect(calls).toEqual(['subscribe', 'cloud:recordDecision'])
    } finally {
      ;(globalThis as Record<string, unknown>).wx = previousWx
    }
  })

  it('builds an experience-version subscription message payload', () => {
    const reminder = optionalRequire('cloudfunctions/sendDrinkReminder/reminder.js')

    expect(typeof reminder.buildSendPayload).toBe('function')
    const buildSendPayload = reminder.buildSendPayload as (input: {
      openid: string
      templateId: string
      page: string
      data: Record<string, { value: string }>
    }) => Record<string, unknown>

    expect(
      buildSendPayload({
        openid: 'openid-1',
        templateId: 'template-1',
        page: 'pages/home/index',
        data: { thing1: { value: '记得记录今天的饮品' } },
      }),
    ).toEqual({
      touser: 'openid-1',
      templateId: 'template-1',
      page: 'pages/home/index',
      lang: 'zh_CN',
      miniprogramState: 'trial',
      data: { thing1: { value: '记得记录今天的饮品' } },
    })
  })

  it('sends only active unused subscriptions that have not run today', () => {
    const reminder = optionalRequire('cloudfunctions/sendDrinkReminder/reminder.js')

    expect(typeof reminder.shouldSendReminder).toBe('function')
    const shouldSendReminder = reminder.shouldSendReminder as (
      subscription: Record<string, unknown>,
      dateKey: string,
    ) => boolean

    expect(
      shouldSendReminder(
        { enabled: true, remainingCount: 1, lastAttemptDate: '2026-07-26' },
        '2026-07-27',
      ),
    ).toBe(true)
    expect(
      shouldSendReminder(
        { enabled: true, remainingCount: 1, lastAttemptDate: '2026-07-27' },
        '2026-07-27',
      ),
    ).toBe(false)
    expect(
      shouldSendReminder(
        { enabled: false, remainingCount: 1, lastAttemptDate: '' },
        '2026-07-27',
      ),
    ).toBe(false)
    expect(
      shouldSendReminder(
        { enabled: true, remainingCount: 0, lastAttemptDate: '' },
        '2026-07-27',
      ),
    ).toBe(false)
  })

  it('records each accepted one-time authorization without trusting client configuration', () => {
    const subscription = optionalRequire(
      'cloudfunctions/subscriptionMutation/subscription.js',
    )

    expect(typeof subscription.applySubscriptionDecision).toBe('function')
    const applySubscriptionDecision = subscription.applySubscriptionDecision as (
      existing: Record<string, unknown> | undefined,
      decision: string,
      config: Record<string, unknown>,
      now: number,
    ) => Record<string, unknown>

    const result = applySubscriptionDecision(
      { remainingCount: 1, createdAt: 100 },
      'accept',
      {
        templateId: 'server-template',
        page: 'pages/home/index',
        data: { thing1: { value: '提醒内容' } },
      },
      200,
    )

    expect(result).toMatchObject({
      enabled: true,
      remainingCount: 2,
      templateId: 'server-template',
      page: 'pages/home/index',
      messageData: { thing1: { value: '提醒内容' } },
      lastDecision: 'accept',
      createdAt: 100,
      updatedAt: 200,
    })
  })

  it('keeps the displayed reminder time aligned with the fixed 20:00 trigger', () => {
    const subscription = optionalRequire(
      'cloudfunctions/subscriptionMutation/subscription.js',
    )

    expect(typeof subscription.readSubscriptionConfig).toBe('function')
    const readSubscriptionConfig = subscription.readSubscriptionConfig as (
      env: Record<string, string>,
    ) => Record<string, unknown>

    expect(
      readSubscriptionConfig({
        SUBSCRIBE_TEMPLATE_ID: 'template-1',
        SUBSCRIBE_TEMPLATE_DATA: '{"thing1":{"value":"提醒内容"}}',
        SUBSCRIBE_REMINDER_TIME: '21:30',
      }).reminderTime,
    ).toBe('20:00')
  })

  it('maps the configured template values to the exact WeChat field keys', () => {
    const subscription = optionalRequire(
      'cloudfunctions/subscriptionMutation/subscription.js',
    )
    const readSubscriptionConfig = subscription.readSubscriptionConfig as (
      env: Record<string, string>,
    ) => Record<string, unknown>

    expect(
      readSubscriptionConfig({
        SUBSCRIBE_TEMPLATE_ID: 'template-1',
        SUBSCRIBE_TEMPLATE_VERSION: '1.0.0',
        SUBSCRIBE_TEMPLATE_CONTENT: '今晚喝了什么？记得来记录一下',
      }),
    ).toMatchObject({
      configured: true,
      data: {
        character_string1: { value: '1.0.0' },
        thing2: { value: '今晚喝了什么？记得来记录一下' },
      },
    })
  })

  it('wires the user-gesture authorization button to cloud persistence', () => {
    const service = existsSync('miniprogram/services/subscriptions.ts')
      ? readFileSync('miniprogram/services/subscriptions.ts', 'utf8')
      : ''
    const page = readFileSync('miniprogram/pages/profile/index.ts', 'utf8')
    const template = readFileSync('miniprogram/pages/profile/index.wxml', 'utf8')

    expect(service).toContain('wx.requestSubscribeMessage')
    expect(service).toContain("'subscriptionMutation'")
    expect(service).toContain("action: 'recordDecision'")
    expect(page).toContain('requestDailyReminderSubscription')
    expect(template).toContain('bindtap="subscribeReminder"')
    expect(template).toContain('订阅今晚提醒')
  })

  it('registers the persistence function and a daily 20:00 timer trigger', () => {
    const config = JSON.parse(readFileSync('cloudbaserc.json', 'utf8')) as {
      functions: Array<{
        name: string
        triggers?: Array<{ name: string; type: string; config: string }>
      }>
    }
    const mutation = config.functions.find(
      (item) => item.name === 'subscriptionMutation',
    )
    const sender = config.functions.find(
      (item) => item.name === 'sendDrinkReminder',
    )

    expect(mutation).toBeTruthy()
    expect(sender?.triggers).toEqual([
      {
        name: 'dailyDrinkReminder',
        type: 'timer',
        config: '0 0 20 * * * *',
      },
    ])

    const permissionFile = 'cloudfunctions/sendDrinkReminder/config.json'
    expect(existsSync(permissionFile)).toBe(true)
    const permissions = JSON.parse(readFileSync(permissionFile, 'utf8')) as {
      permissions: { openapi: string[] }
      triggers?: Array<{ name: string; type: string; config: string }>
    }
    expect(permissions.permissions.openapi).toContain('subscribeMessage.send')
    expect(permissions.triggers).toEqual(sender?.triggers)
  })
})
