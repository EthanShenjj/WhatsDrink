#!/usr/bin/env node
// 一键部署支付订阅栈：集合 + 索引 + 四个云函数及其环境变量。
//
// 用法：
//   npm run deploy:payment [-- --dry-run]
//
// 密钥来源（二选一）：
//   1. .env.payment（推荐，已被 .gitignore 忽略），参考 .env.payment.example
//   2. 之前执行 `cloudbase login` 留下的本机授权登录态
//
// HTTP 网关路由、小程序后台消息推送与虚拟支付商品无法用 API 完成，
// 脚本结束后会打印剩余的手动步骤清单。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
// --only=name1,name2：只部署指定云函数（集合与索引始终执行），用于密钥未配齐时先上其余部分
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='))
const onlyFunctions = onlyArg ? onlyArg.slice('--only='.length).split(',').map((name) => name.trim()) : null

const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {}
  const values = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) values[key] = value
  }
  return values
}

const fileEnv = readEnvFile(path.join(projectRoot, '.env.payment'))
const env = (key) => {
  const value = fileEnv[key] ?? process.env[key] ?? ''
  return typeof value === 'string' ? value.trim() : String(value)
}

const cloudbaserc = JSON.parse(fs.readFileSync(path.join(projectRoot, 'cloudbaserc.json'), 'utf8'))
const envId = env('TCB_ENV_ID') || cloudbaserc.envId
const functionRootPath = cloudbaserc.functionRoot || 'cloudfunctions'
const functionConfig = Object.fromEntries(
  (cloudbaserc.functions || []).map((fn) => [fn.name, fn]),
)

const FUNCTIONS = [
  {
    name: 'accountMutation',
    envKeys: [],
    requiredEnvKeys: [],
  },
  {
    name: 'paymentMutation',
    envKeys: [
      'VIRTUAL_PAY_OFFER_ID',
      'VIRTUAL_PAY_APP_KEY',
      'VIRTUAL_PAY_ENV',
      'WECHAT_APP_ID',
      'WECHAT_APP_SECRET',
      'VIRTUAL_PAY_PRODUCT_PLUS_31D',
      'VIRTUAL_PAY_PRODUCT_PLUS_372D',
      'VIRTUAL_PAY_PRODUCT_PRO_372D',
      'MEMBERSHIP_TEMPLATE_ID',
    ],
    requiredEnvKeys: ['VIRTUAL_PAY_OFFER_ID', 'VIRTUAL_PAY_APP_KEY', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET'],
  },
  {
    name: 'paymentNotify',
    envKeys: ['PAYMENT_MESSAGE_TOKEN'],
    requiredEnvKeys: ['PAYMENT_MESSAGE_TOKEN'],
  },
  {
    name: 'sendMembershipReminder',
    envKeys: [
      'MEMBERSHIP_TEMPLATE_ID',
      'MEMBERSHIP_REMIND_DAYS',
      'MEMBERSHIP_TITLE_FIELD',
      'MEMBERSHIP_DATE_FIELD',
      'MEMBERSHIP_NOTE_FIELD',
      'MEMBERSHIP_PAGE',
      'MEMBERSHIP_MINIPROGRAM_STATE',
    ],
    // 模板未配置时函数会自动跳过发送，因此 MEMBERSHIP_TEMPLATE_ID 不是硬性要求
    requiredEnvKeys: [],
  },
]

const INDEXES = [
  {
    collection: 'payment_orders',
    indexes: [
      { name: 'openid_createdAt_idx', unique: false, keys: [{ Name: '_openid', Direction: '1' }, { Name: 'createdAt', Direction: '-1' }] },
      { name: 'outTradeNo_unique', unique: true, keys: [{ Name: 'outTradeNo', Direction: '1' }] },
      // wxOrderId 不能建唯一索引：MongoDB 会把缺失字段都视为 null，第二笔待支付订单就会冲突。
      // 发货幂等由事务内的 status 检查保证，这里只做查询加速。
      { name: 'wxOrderId_idx', unique: false, keys: [{ Name: 'wxOrderId', Direction: '1' }] },
    ],
  },
  {
    collection: 'user_entitlements',
    indexes: [
      { name: 'openid_expiresAt_idx', unique: false, keys: [{ Name: '_openid', Direction: '1' }, { Name: 'expiresAt', Direction: '-1' }] },
      { name: 'sourceOrderId_unique', unique: true, keys: [{ Name: 'sourceOrderId', Direction: '1' }] },
    ],
  },
  {
    collection: 'reminder_subscriptions',
    indexes: [
      { name: 'openid_template_idx', unique: false, keys: [{ Name: '_openid', Direction: '1' }, { Name: 'templateId', Direction: '1' }] },
    ],
  },
]

const log = (message) => console.log(message)
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const resolveCredential = async () => {
  if (env('TENCENTCLOUD_SECRETID') && env('TENCENTCLOUD_SECRETKEY')) {
    log('· 使用 .env.payment / 环境变量中的 CAM 密钥')
    return {
      secretId: env('TENCENTCLOUD_SECRETID'),
      secretKey: env('TENCENTCLOUD_SECRETKEY'),
      token: env('TENCENTCLOUD_SESSIONTOKEN') || undefined,
    }
  }
  const { checkAndGetCredential } = await import('@cloudbase/toolbox')
  const credential = await checkAndGetCredential()
  if (!credential || !credential.secretId) {
    fail('未找到可用凭证：请填写 .env.payment（参考 .env.payment.example），或先执行 `npx @cloudbase/cli@latest login`')
  }
  log('· 使用 CloudBase CLI 本机授权登录态')
  return credential
}

const buildFunctionEnv = (spec) => {
  const values = {}
  for (const key of spec.envKeys) {
    const value = env(key)
    if (value) values[key] = value
  }
  const missing = spec.requiredEnvKeys.filter((key) => !values[key])
  if (missing.length) {
    fail(`${spec.name} 缺少必需的环境变量：${missing.join('、')}（请在 .env.payment 中填写）`)
  }
  return values
}

const ensureCollections = async (manager) => {
  for (const { collection, indexes } of INDEXES) {
    log(`· 集合 ${collection}`)
    if (dryRun) continue
    await manager.database.createCollectionIfNotExists(collection)
    const existing = await manager.database.describeCollection(collection)
    const existingNames = new Set((existing.Indexes || []).map((index) => index.Name))
    const toCreate = indexes.filter((index) => !existingNames.has(index.name))
    if (!toCreate.length) continue
    await manager.database.updateCollection(collection, {
      CreateIndexes: toCreate.map((index) => ({
        IndexName: index.name,
        MgoKeySchema: {
          MgoIndexKeys: index.keys.map(({ Name, Direction }) => ({ Name, Direction })),
          MgoIsUnique: index.unique,
        },
      })),
    })
    log(`  ↳ 新建索引 ${toCreate.map((index) => index.name).join('、')}`)
  }
}

const deployFunction = async (manager, spec) => {
  const config = functionConfig[spec.name]
  if (!config) fail(`cloudbaserc.json 中找不到 ${spec.name} 的配置`)
  const envVariables = buildFunctionEnv(spec)
  const func = {
    name: spec.name,
    timeout: config.timeout || 10,
    memorySize: config.memorySize || 256,
    runtime: config.runtime,
    handler: config.handler || 'index.main',
    installDependency: Boolean(config.installDependency),
    envVariables,
    isWaitInstall: Boolean(config.installDependency),
    ignore: ['node_modules/**', 'package-lock.json'],
  }
  log(`· 云函数 ${spec.name}（${Object.keys(envVariables).length} 个环境变量）`)
  if (dryRun) return

  let exists = false
  try {
    await manager.functions.getFunctionDetail(spec.name)
    exists = true
  } catch {
    exists = false
  }
  if (exists) {
    await manager.functions.updateFunctionCode({ func: { name: spec.name }, functionRootPath })
    await manager.functions.updateFunctionConfig(func)
  } else {
    await manager.functions.createFunction({ func, functionRootPath, force: true })
  }
  if (config.triggers?.length) {
    await manager.functions.createFunctionTriggers(spec.name, config.triggers)
  }
}

const printManualSteps = () => {
  log(`
剩余手动步骤（API 无法完成）：
  1. 小程序后台「支付与交易 → 虚拟支付 → 道具管理」创建并发布三个道具（见 docs/virtual-payment-setup.md）。
  2. 小程序后台「开发管理 → 消息推送」配置 URL/Token：URL 填 paymentNotify 的 HTTP 访问地址，
     Token 与 PAYMENT_MESSAGE_TOKEN 一致，明文模式。如尚未创建 paymentNotify 的 HTTP 网关路由，先在
     云开发控制台「云函数 → paymentNotify → HTTP 访问服务」开启，并把云函数调用权限设为 false。
  3. 若使用到期提醒：在「订阅消息」申领会员到期提醒模板，把模板 ID 同步到 .env.payment 的
     MEMBERSHIP_TEMPLATE_ID 与 miniprogram/services/config.ts，然后重跑本脚本。
  4. 发布小程序版本后，用最低金额真实支付一次，核对订单、权益到账与微信侧结算。`)
}

const main = async () => {
  if (dryRun) log('（dry-run 模式：只打印计划，不做任何修改）')
  log(`目标环境：${envId}`)
  const credential = await resolveCredential()
  const { default: CloudBase } = await import('@cloudbase/manager-node')
  const manager = CloudBase.init({ ...credential, envId })
  await ensureCollections(manager)
  const specs = FUNCTIONS.filter((spec) => !onlyFunctions || onlyFunctions.includes(spec.name))
  if (onlyFunctions) {
    const unknown = onlyFunctions.filter((name) => !FUNCTIONS.some((spec) => spec.name === name))
    if (unknown.length) fail(`未知的云函数：${unknown.join('、')}（可选：${FUNCTIONS.map((spec) => spec.name).join('、')}）`)
    log(`仅部署：${specs.map((spec) => spec.name).join('、')}`)
  }
  for (const spec of specs) {
    await deployFunction(manager, spec)
  }
  printManualSteps()
  log(dryRun ? 'dry-run 完成。' : '支付订阅栈部署完成。')
}

main().catch((error) => fail(error.message || error))
