// 多机型（iPhone / Android / iPad）模拟器适配测试。
// 原理：微信开发者工具的模拟器机型存在 WeappLocalData/localstorage_*.json 的
// `device`/`deviceInfo` key 里（current 为列表索引）。每轮测试：
//   退出 IDE → 改写机型状态 → automator 拉起 → 逐页截图 + 记录 systemInfo/console → 汇总。
// 产物：output/multi-device/<device>/NN-页面.png 与 output/multi-device/report.json
// 用法：node scripts/multi-device-test.mjs [--only=iphone,android,ipad] [--pages=map,time]
import automator from 'miniprogram-automator'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const PROJECT_PATH = '/Users/ethanshen/Desktop/LLM/untitled folder/WhatsDrink'
const OUT_ROOT = path.join(PROJECT_PATH, 'output/multi-device')
const LOCAL_DATA_DIR =
  '/Users/ethanshen/Library/Application Support/微信开发者工具/d1e8765721a6c23d43b14c95b1843e6b/WeappLocalData'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 机型列表索引来自工具内置预设：6=Pixel 9(安卓) 13=iPad(10th)/Air 11 1=iPhone 12/13 (Pro)
const DEVICES = [
  { key: 'iphone', name: 'iPhone 12/13 (Pro)', index: 1, expectWidth: 390 },
  { key: 'android', name: 'Pixel 9', index: 6, expectWidth: 412 },
  { key: 'ipad', name: 'iPad (10th)/Air 11', index: 13, expectWidth: 820 },
]

const arg = (flag, def) => {
  const m = process.argv.find((a) => a.startsWith(flag + '='))
  return m ? m.split('=').slice(1).join('=') : def
}
const only = arg('--only', '')
const devices = only ? DEVICES.filter((d) => only.split(',').includes(d.key)) : DEVICES

// ---- 测试页面清单（按 app.json 顺序的子集）----
let fpId = '' // 运行时从地图页数据里取
const PAGES = (fpId) => [
  { key: '01-map', url: '/pages/map/index', tab: true, settle: 2500, waitFootprints: true },
  { key: '02-time', url: '/pages/time/index', tab: true, settle: 1800 },
  { key: '03-mine', url: '/pages/mine/index', tab: true, settle: 1800 },
  { key: '04-footprint-form', url: '/pages/footprint-form/index', settle: 1800 },
  fpId
    ? { key: '05-footprint-detail', url: `/pages/footprint-detail/index?id=${fpId}`, settle: 2200 }
    : null,
  { key: '06-settings', url: '/pages/settings/index', settle: 1500 },
  { key: '07-personal-settings', url: '/pages/personal-settings/index', settle: 1500 },
  { key: '08-mine-edit', url: '/pages/mine-edit/index', settle: 1800 },
  { key: '09-ai-assistant', url: '/pages/ai-assistant/index', settle: 1800 },
  { key: '10-privacy', url: '/pages/privacy/index', settle: 1500 },
  { key: '11-travel-plan', url: '/pages/travel-plan/index', settle: 1800 },
  { key: '12-time-capsule', url: '/pages/time-capsule/index', settle: 1800 },
  { key: '13-growth', url: '/pages/growth/index', settle: 1800 },
  { key: '14-membership', url: '/pages/membership/index', settle: 1800 },
  { key: '15-guide', url: '/pages/guide/index', settle: 1500 },
].filter(Boolean)

// ---- IDE 退出与机型改写 ----
function quitIde() {
  spawnSync('osascript', ['-e', 'quit app "wechatwebdevtools"'], { timeout: 20000 })
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const { status } = spawnSync('pgrep', ['-f', 'wechatwebdevtools'])
    if (status !== 0) return true
    sleepSync(1000)
  }
  console.warn('[warn] IDE 未在 25s 内退出，尝试强制结束')
  spawnSync('pkill', ['-f', 'wechatwebdevtools'])
  sleepSync(3000)
  return false
}
function sleepSync(ms) {
  spawnSync('sleep', [String(ms / 1000)])
}

function setDevice(index) {
  // 同步改写所有包含 device key 的 localstorage 存储（工具会在退出时落盘，此处无进程运行）
  const files = readdirSync(LOCAL_DATA_DIR).filter((f) => f.startsWith('localstorage_'))
  let touched = 0
  for (const f of files) {
    const p = path.join(LOCAL_DATA_DIR, f)
    let data
    try {
      data = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      continue
    }
    if (!data || typeof data.device !== 'object' || !Array.isArray(data.device?.list)) continue
    const dev = data.device
    if (index >= dev.list.length) continue
    dev.current = index
    data.deviceInfo = dev.list[index].info
    if ('rotated' in data) data.rotated = false
    writeFileSync(p, JSON.stringify(data))
    touched++
  }
  console.log(`[device] 已改写 ${touched} 个存储文件 → index=${index}`)
  return touched
}

// ---- 单机型测试 ----
async function testDevice(dev) {
  const outDir = path.join(OUT_ROOT, dev.key)
  mkdirSync(outDir, { recursive: true })
  const report = { device: dev.name, key: dev.key, pages: {}, exceptions: [], console: [] }

  console.log(`\n========== [${dev.key}] ${dev.name} ==========`)
  quitIde()
  const touched = setDevice(dev.index)
  if (!touched) throw new Error('未能改写任何机型存储文件')

  console.log('[auto] 拉起开发者工具…')
  const miniProgram = await automator.launch({
    cliPath: CLI_PATH,
    projectPath: PROJECT_PATH,
    timeout: 240000,
    trustProject: true,
  })
  console.log('[auto] 自动化连接成功')

  miniProgram.on('console', (msg) => {
    const text = (msg.args || []).map((a) => a?.toString?.() ?? String(a)).join(' ')
    if (msg.type === 'error' || msg.type === 'warn')
      report.console.push({ type: msg.type, text: text.slice(0, 300) })
  })
  miniProgram.on('exception', (err) => {
    report.exceptions.push(String(err?.message || err).slice(0, 300))
  })

  try {
    // 等待首页编译完成
    const deadline = Date.now() + 90000
    while (Date.now() < deadline) {
      try {
        if ((await miniProgram.currentPage())?.path === 'pages/map/index') break
      } catch {}
      await sleep(1500)
    }

    const sys = await miniProgram.systemInfo()
    report.systemInfo = {
      platform: sys.platform,
      windowWidth: sys.windowWidth,
      windowHeight: sys.windowHeight,
      screenWidth: sys.screenWidth,
      screenHeight: sys.screenHeight,
      pixelRatio: sys.pixelRatio,
      safeArea: sys.safeArea,
      statusBarHeight: sys.statusBarHeight,
    }
    console.log('[sys]', JSON.stringify(report.systemInfo))
    report.widthMatch = sys.windowWidth === dev.expectWidth
    if (!report.widthMatch)
      console.warn(`[warn] windowWidth=${sys.windowWidth} 期望 ${dev.expectWidth}，机型切换可能未生效`)

    const pages = PAGES(fpId)
    for (const p of pages) {
      const tagStart = report.console.length
      try {
        let page
        if (p.tab) page = await miniProgram.switchTab(p.url)
        else page = await miniProgram.reLaunch(p.url)
        if (!page) {
          await sleep(1500)
          page = await miniProgram.currentPage()
        }
        if (p.waitFootprints) {
          // 地图页：等足迹数据（取一条 id 供详情页用），最多 15s
          const dl = Date.now() + 15000
          while (Date.now() < dl) {
            const data = await page.data().catch(() => ({}))
            const fps = data.footprints || []
            if (fps.length > 0) {
              if (!fpId) fpId = fps[0].id
              break
            }
            await sleep(1200)
          }
        }
        await sleep(p.settle)
        const shotPath = path.join(outDir, `${p.key}.png`)
        await miniProgram.screenshot({ path: shotPath })
        report.pages[p.key] = {
          shot: shotPath,
          errors: report.console.slice(tagStart).filter((c) => c.type === 'error').length,
        }
        console.log(`[shot] ${dev.key}/${p.key}.png`)
      } catch (e) {
        report.pages[p.key] = { error: String(e?.message || e).slice(0, 200) }
        console.warn(`[fail] ${p.key}:`, e?.message)
      }
    }
  } finally {
    await miniProgram.disconnect().catch(() => {})
  }
  quitIde()
  return report
}

// ---- 主流程 ----
mkdirSync(OUT_ROOT, { recursive: true })
const all = {}
for (const dev of devices) {
  try {
    all[dev.key] = await testDevice(dev)
  } catch (e) {
    console.error(`[${dev.key}] 失败:`, e?.message)
    all[dev.key] = { fatal: String(e?.message || e) }
  }
}
writeFileSync(path.join(OUT_ROOT, 'report.json'), JSON.stringify(all, null, 2))
console.log('\n[done] 报告已写入 output/multi-device/report.json')
for (const [k, r] of Object.entries(all)) {
  if (r.fatal) console.log(`  ${k}: FATAL ${r.fatal}`)
  else {
    const errs = Object.values(r.pages).filter((p) => p.error).length
    const pageErrs = Object.values(r.pages).filter((p) => p.errors > 0).length
    console.log(
      `  ${k}: 平台=${r.systemInfo?.platform} ${r.systemInfo?.windowWidth}x${r.systemInfo?.windowHeight} dpr=${r.systemInfo?.pixelRatio} 宽度匹配=${r.widthMatch} 页面异常=${errs} 控制台错误页数=${pageErrs} 全局异常=${r.exceptions.length}`,
    )
  }
}
