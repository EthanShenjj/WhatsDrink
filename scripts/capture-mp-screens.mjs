// 用 miniprogram-automator 驱动微信开发者工具,自动截取"地理位置接口申请"用的产品截图。
// 产物输出到 /Users/ethanshen/Downloads/mp-screens/。
// 用法:node scripts/capture-mp-screens.mjs
import automator from 'miniprogram-automator'
import { mkdirSync } from 'node:fs'

const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const PROJECT_PATH = '/Users/ethanshen/Desktop/LLM/untitled folder/WhatsDrink'
const OUT_DIR = '/Users/ethanshen/Downloads/mp-screens'

// 成都天府广场附近,作为模拟定位坐标
const MOCK_LOCATION = {
  latitude: 30.657,
  longitude: 104.0655,
  speed: 0,
  accuracy: 30,
  altitude: 0,
  verticalAccuracy: 0,
  horizontalAccuracy: 30,
  errMsg: 'getLocation:ok',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

mkdirSync(OUT_DIR, { recursive: true })

console.log('[auto] 正在拉起微信开发者工具(首次编译可能需要 1-2 分钟)…')
const miniProgram = await automator.launch({
  cliPath: CLI_PATH,
  projectPath: PROJECT_PATH,
  timeout: 180000,
})
console.log('[auto] 自动化连接成功')

const shot = async (name) => {
  const path = `${OUT_DIR}/${name}.png`
  await miniProgram.screenshot({ path })
  console.log(`[shot] ${path}`)
}

const waitUntil = async (fn, timeout = 20000, step = 1000, label = '') => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await fn()) return true
    } catch {}
    await sleep(step)
  }
  console.warn(`[warn] 等待超时:${label}`)
  return false
}

try {
  // ① 等地图页就绪、足迹数据加载完成
  let page = await miniProgram.currentPage()
  await waitUntil(
    async () => (await miniProgram.currentPage()).path === 'pages/map/index',
    30000,
    2000,
    '地图页',
  )
  page = await miniProgram.currentPage()
  const dataReady = await waitUntil(
    async () => ((await page.data()).footprints || []).length > 0,
    20000,
    1500,
    '足迹数据',
  )
  await sleep(1500)
  await shot('01-map-overview')
  if (!dataReady) console.warn('[warn] 地图无足迹数据,截图可能偏空')

  // ③ 定位后的地图:mock wx.getLocation 绕过授权弹窗(弹窗那张需真机截)
  await miniProgram.mockWxMethod('getLocation', MOCK_LOCATION)
  await page.callMethod('onLocate')
  await sleep(2500)
  await shot('03-map-located')
  await miniProgram.restoreWxMethod('getLocation')

  // ⑤ 新增足迹表单:已标记地址条状态
  page = await miniProgram.navigateTo('/pages/footprint-form/index')
  await page.waitFor(1500)
  await page.setData({
    poiName: '天府广场',
    address: '四川省成都市青羊区人民中路一段',
    lat: MOCK_LOCATION.latitude,
    lng: MOCK_LOCATION.longitude,
    visitDate: new Date().toISOString().slice(0, 10),
  })
  await page.callMethod('updateFormState')
  await sleep(800)
  await shot('05-form-address')

  // ⑥ 保存后地图点亮闭环(会写入一条标记为"截图测试"的足迹,事后可删)
  await page.callMethod('onSave')
  await sleep(5000)
  await page.callMethod('onSuccessClose')
  await waitUntil(
    async () => (await miniProgram.currentPage()).path === 'pages/map/index',
    15000,
    1500,
    '返回地图页',
  )
  await sleep(3000)
  await shot('06-map-after-save')

  // ⑧ 我的页
  page = await miniProgram.switchTab('/pages/mine/index')
  await sleep(1800)
  await shot('08-mine')

  // ④ 微信原生选点页(放最后:原生页面无法通过自动化返回)
  page = await miniProgram.switchTab('/pages/map/index')
  await sleep(1200)
  await page.callMethod('onSearch')
  await waitUntil(async () => (await miniProgram.currentPage()) === null, 10000, 1500, '原生选点页')
  await sleep(3500)
  await shot('04-choose-location-native')

  console.log('[auto] 全部截图完成')
} catch (err) {
  console.error('[auto] 失败:', err && err.message)
  process.exitCode = 1
} finally {
  await miniProgram.disconnect().catch(() => {})
}
