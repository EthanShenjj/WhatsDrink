#!/usr/bin/env node
// 一键部署支付订阅栈：集合 + 索引 + 四个云函数及其环境变量。
//
// 用法：
//   npm run deploy:payment -- --target=production [--dry-run]
//   npm run deploy:payment -- --target=sandbox [--dry-run]
//
// 密钥来源（二选一）：
//   1. .env.payment（推荐，已被 .gitignore 忽略），参考 .env.payment.example
//   2. 之前执行 `cloudbase login` 留下的本机授权登录态
//
// HTTP 网关路由、小程序后台消息推送与虚拟支付商品无法用 API 完成，
// 脚本结束后会打印剩余的手动步骤清单。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const targetArg = process.argv.find((arg) => arg.startsWith('--target='))
const paymentTarget = targetArg ? targetArg.slice('--target='.length).trim() : ''
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
const paymentNotifyRoute = (cloudbaserc.gateway?.routes || [])
  .find((route) => route.target === 'function:paymentNotify')?.path || '/payment-notify'

const FUNCTIONS = [
  {
    name: 'accountMutation',
    envKeys: [],
    requiredEnvKeys: [],
    invokeRule: 'auth != null',
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
    invokeRule: 'auth != null',
  },
  {
    name: 'paymentNotify',
    envKeys: ['PAYMENT_MESSAGE_TOKEN'],
    requiredEnvKeys: ['PAYMENT_MESSAGE_TOKEN'],
    invokeRule: false,
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
    invokeRule: false,
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

let paymentEnvCache
const paymentRuntimeEnv = () => {
  if (paymentEnvCache) return paymentEnvCache
  if (paymentTarget !== 'production' && paymentTarget !== 'sandbox') {
    fail('请显式选择支付目标：--target=production（真机现网）或 --target=sandbox（仅开发者工具）')
  }
  const appKeyEnvName = paymentTarget === 'production'
    ? 'VIRTUAL_PAY_APP_KEY_PRODUCTION'
    : 'VIRTUAL_PAY_APP_KEY_SANDBOX'
  const expectedLegacyEnv = paymentTarget === 'production' ? '0' : '1'
  const legacyAppKey = env('VIRTUAL_PAY_APP_KEY')
  const legacyEnv = env('VIRTUAL_PAY_ENV')
  const appKey = env(appKeyEnvName)
    || (legacyAppKey && legacyEnv === expectedLegacyEnv ? legacyAppKey : '')
  if (!appKey) {
    fail(`${paymentTarget === 'production' ? '现网' : '沙箱'}部署缺少 ${appKeyEnvName}`)
  }
  if (!env(appKeyEnvName)) {
    log(`  ↳ 兼容旧配置 VIRTUAL_PAY_APP_KEY + VIRTUAL_PAY_ENV=${expectedLegacyEnv}；建议迁移到 ${appKeyEnvName}`)
  }
  paymentEnvCache = {
    VIRTUAL_PAY_ENV: paymentTarget === 'production' ? '0' : '1',
    VIRTUAL_PAY_APP_KEY: appKey,
  }
  return paymentEnvCache
}

const cloudBaseCliCredential = () => {
  const authPath = path.join(os.homedir(), '.config', '.cloudbase', 'auth.json')
  if (!fs.existsSync(authPath)) return null
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    const credential = auth?.credential || {}
    const rawExpiresAt = Number(credential.tmpExpired || credential.expired || 0)
    const expiresAt = rawExpiresAt > 0 && rawExpiresAt < 1e12 ? rawExpiresAt * 1000 : rawExpiresAt
    if (
      !credential.tmpSecretId
      || !credential.tmpSecretKey
      || !credential.tmpToken
      || (expiresAt && expiresAt <= Date.now() + 60000)
    ) return null
    return {
      secretId: credential.tmpSecretId,
      secretKey: credential.tmpSecretKey,
      token: credential.tmpToken,
    }
  } catch {
    return null
  }
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
  const cliCredential = cloudBaseCliCredential()
  if (cliCredential) {
    log('· 使用 CloudBase CLI 3 本机授权登录态')
    return cliCredential
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
    if (spec.name === 'paymentMutation' && (key === 'VIRTUAL_PAY_ENV' || key === 'VIRTUAL_PAY_APP_KEY')) {
      continue
    }
    const value = env(key)
    if (value) values[key] = value
  }
  if (spec.name === 'paymentMutation') Object.assign(values, paymentRuntimeEnv())
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// updateFunctionCode 后函数会短暂处于 Updating 状态，期间改配置会报错，等它空闲后重试
const updateConfigWithRetry = async (manager, func) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await manager.functions.updateFunctionConfig(func)
      return
    } catch (error) {
      if (attempt >= 6 || !String(error?.message || error).includes('Updating')) throw error
      log(`  ↳ 函数处于 Updating 状态，5 秒后重试（${attempt}/5）`)
      await wait(5000)
    }
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
    await updateConfigWithRetry(manager, func)
  } else {
    await manager.functions.createFunction({ func, functionRootPath, force: true })
  }
  if (config.triggers?.length) {
    await manager.functions.createFunctionTriggers(spec.name, config.triggers)
  }
}

const ensureFunctionPermissions = async (manager, specs) => {
  log('· 云函数调用权限')
  if (dryRun) {
    for (const spec of specs) {
      log(`  ↳ ${spec.name}: ${spec.invokeRule === false ? '禁止客户端调用' : spec.invokeRule}`)
    }
    return
  }
  const current = await manager.permission.describeResourcePermission({ resourceType: 'function' })
  const serialized = current.Data?.PermissionList?.[0]?.SecurityRule || '{}'
  let rules
  try {
    rules = JSON.parse(serialized)
  } catch {
    rules = {}
  }
  if (!rules['*']) rules['*'] = { invoke: false }
  for (const spec of specs) rules[spec.name] = { invoke: spec.invokeRule }
  await manager.permission.modifyResourcePermission({
    resourceType: 'function',
    permission: 'CUSTOM',
    securityRule: JSON.stringify(rules),
  })
  for (const spec of specs) {
    log(`  ↳ ${spec.name}: ${spec.invokeRule === false ? '禁止客户端调用' : spec.invokeRule}`)
  }
}

const ensurePaymentNotifyAccess = async (manager) => {
  log(`· 支付通知 HTTP 路由 ${paymentNotifyRoute}`)
  if (dryRun) return
  const existing = await manager.access.getAccessList({ path: paymentNotifyRoute })
  const route = (existing.APISet || []).find((item) => item.Path === paymentNotifyRoute)
  if (!route) {
    await manager.access.createAccess({
      path: paymentNotifyRoute,
      name: 'paymentNotify',
      type: 1,
      auth: false,
    })
  } else if (route.EnableAuth) {
    await manager.access.switchPathAuth({ apiIds: [route.APIId], auth: false })
  }
  if (!existing.EnableService) await manager.access.switchAuth(true)
  const domains = await manager.access.getDomainList()
  if (domains.DefaultDomain) {
    log(`  ↳ 微信消息推送 URL：https://${domains.DefaultDomain}${paymentNotifyRoute}`)
  }
}

const printManualSteps = () => {
  log(`
剩余手动步骤（API 无法完成）：
  1. 小程序后台「支付与交易 → 虚拟支付 → 道具管理」创建并发布三个道具（见 docs/virtual-payment-setup.md）。
  2. 小程序后台「开发管理 → 消息推送」配置 URL/Token：URL 使用上方输出的 paymentNotify 地址，
     Token 与 PAYMENT_MESSAGE_TOKEN 一致，消息加密方式选择明文模式。
  3. 若使用到期提醒：在「订阅消息」申领会员到期提醒模板，把模板 ID 同步到 .env.payment 的
     MEMBERSHIP_TEMPLATE_ID，然后重跑本脚本；客户端会自动从服务端读取该模板 ID。
  4. 发布小程序版本后，用最低金额真实支付一次，核对订单、权益到账与微信侧结算。`)
}

const main = async () => {
  const specs = FUNCTIONS.filter((spec) => !onlyFunctions || onlyFunctions.includes(spec.name))
  if (onlyFunctions) {
    const unknown = onlyFunctions.filter((name) => !FUNCTIONS.some((spec) => spec.name === name))
    if (unknown.length) fail(`未知的云函数：${unknown.join('、')}（可选：${FUNCTIONS.map((spec) => spec.name).join('、')}）`)
  }
  if (specs.some((spec) => spec.name === 'paymentMutation')) paymentRuntimeEnv()
  if (dryRun) log('（dry-run 模式：只打印计划，不做任何修改）')
  log(`目标环境：${envId}`)
  if (specs.some((spec) => spec.name === 'paymentMutation')) {
    log(`支付目标：${paymentTarget === 'production' ? '现网真机' : '沙箱开发者工具'}`)
  }
  if (dryRun) {
    await ensureCollections(null)
    for (const spec of specs) await deployFunction(null, spec)
    await ensureFunctionPermissions(null, specs)
    if (specs.some((spec) => spec.name === 'paymentNotify')) {
      await ensurePaymentNotifyAccess(null)
    }
    printManualSteps()
    log('dry-run 完成。')
    return
  }
  const credential = await resolveCredential()
  const { default: CloudBase } = await import('@cloudbase/manager-node')
  const manager = CloudBase.init({ ...credential, envId })
  await ensureCollections(manager)
  if (onlyFunctions) {
    log(`仅部署：${specs.map((spec) => spec.name).join('、')}`)
  }
  for (const spec of specs) {
    await deployFunction(manager, spec)
  }
  await ensureFunctionPermissions(manager, specs)
  if (specs.some((spec) => spec.name === 'paymentNotify')) {
    await ensurePaymentNotifyAccess(manager)
  }
  printManualSteps()
  log('支付订阅栈部署完成。')
}

main().catch((error) => fail(error.message || error))
