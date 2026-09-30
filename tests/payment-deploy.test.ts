import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('payment deployment plan', () => {
  it('builds a production dry-run without cloud credentials and selects only the production key', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/deploy-payment.mjs', '--target=production', '--dry-run'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          TCB_ENV_ID: 'test-env',
          VIRTUAL_PAY_OFFER_ID: 'offer-1',
          VIRTUAL_PAY_APP_KEY_PRODUCTION: 'production-key',
          VIRTUAL_PAY_APP_KEY_SANDBOX: 'sandbox-key',
          WECHAT_APP_ID: 'wx-app-id',
          WECHAT_APP_SECRET: 'app-secret',
          PAYMENT_MESSAGE_TOKEN: 'message-token',
        },
      },
    )

    expect(output).toContain('支付目标：现网真机')
    expect(output).toContain('云函数 paymentMutation（5 个环境变量）')
    expect(output).toContain('支付通知 HTTP 路由 /payment-notify')
    expect(output).toContain('dry-run 完成。')
    expect(output).not.toContain('未找到可用凭证')
  })
})
