// 多机型（iPhone / Android / iPad）模拟器适配测试 —— CDP 版。
//
// 背景：微信开发者工具的 cli auto 需要联网拉取 AppID 权限（servicewechat.com 被
// 飞连阻断时不可用），因此本脚本完全绕开 automator，改用两条本地通道：
//   1. 机型切换：退出 IDE → 改写 WeappLocalData/localstorage_*.json 的
//      `device.current`（内置预设列表索引）→ 重启 IDE；
//   2. 控制与截图：IDE 以 --remote-debugging-port=9223 启动，用 Chrome DevTools
//      协议在"小程序逻辑层"执行 wx.navigateTo/switchTab 完成导航，对渲染层
//      webview（__pageframe__/pages/...）执行 Page.captureScreenshot 截图。
//
// 产物：output/multi-device/<key>/NN-页面.png + output/multi-device/report.json
// 用法：node scripts/cdp-device-test.mjs [--only=iphone,android,ipad]
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import WebSocket from 'ws'

const PROJECT_PATH = '/Users/ethanshen/Desktop/LLM/untitled folder/WhatsDrink'
const ELECTRON = '/Applications/wechatwebdevtools.app/Contents/MacOS/Electron'
const CDP_PORT = 9223
const OUT_ROOT = path.join(PROJECT_PATH, 'output/multi-device')
const LOCAL_DATA_DIR =
  '/Users/ethanshen/Library/Application Support/微信开发者工具/d1e8765721a6c23d43b14c95b1843e6b/WeappLocalData'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 内置预设列表索引：1=iPhone 12/13 (Pro) 390×844 dpr3；6=Pixel 9 412×923 dpr2.625；13=iPad (10th)/Air 11 820×1180 dpr2
const DEVICES = [
  { key: 'iphone', name: 'iPhone 12/13 (Pro)', index: 1, expectWidth: 390 },
  { key: 'android', name: 'Pixel 9', index: 6, expectWidth: 412 },
  { key: 'ipad', name: 'iPad (10th)/Air 11', index: 13, expectWidth: 820 },
]

const arg = (f, d) => {
  const m = process.argv.find((a) => a.startsWith(f + '='))
  return m ? m.split('=').slice(1).join('=') : d
}
const devices = (() => {
  const only = arg('--only', '')
  return only ? DEVICES.filter((d) => only.split(',').includes(d.key)) : DEVICES
})()

// 测试页面清单（app.json 全部页面；tab 页用 switchTab，其余 reLaunch）
let fpId = ''
const pages = () =>
  [
    { key: '01-map', url: '/pages/map/index', tab: true, settle: 3500, isMap: true },
    { key: '02-time', url: '/pages/time/index', tab: true, settle: 2200 },
    { key: '03-mine', url: '/pages/mine/index', tab: true, settle: 2200 },
    { key: '04-footprint-form', url: '/pages/footprint-form/index', settle: 2200 },
    fpId ? { key: '05-footprint-detail', url: `/pages/footprint-detail/index?id=${fpId}`, settle: 2600 } : null,
    { key: '06-settings', url: '/pages/settings/index', settle: 1800 },
    { key: '07-personal-settings', url: '/pages/personal-settings/index', settle: 1800 },
    { key: '08-mine-edit', url: '/pages/mine-edit/index', settle: 2200 },
    { key: '10-privacy', url: '/pages/privacy/index', settle: 1800 },
    { key: '11-travel-plan', url: '/pages/travel-plan/index', settle: 2200 },
    { key: '12-time-capsule', url: '/pages/time-capsule/index', settle: 2200 },
    { key: '13-growth', url: '/pages/growth/index', settle: 2200 },
    { key: '14-membership', url: '/pages/membership/index', settle: 2200 },
    { key: '15-guide', url: '/pages/guide/index', settle: 1800 },
  ].filter(Boolean)

// ---------- CDP 小客户端 ----------
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false })
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    this.ws.on('message', (m) => {
      const msg = JSON.parse(m.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        this.handlers.forEach((h) => h(msg))
      }
    })
    this.ws.on('error', (e) => console.error('[cdp error]', e.message))
  }
  static async connect(wsUrl) {
    const c = new Cdp(wsUrl)
    await new Promise((res, rej) => {
      c.ws.once('open', res)
      c.ws.once('error', rej)
      setTimeout(() => rej(new Error('cdp connect timeout')), 8000)
    })
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`cdp timeout: ${method}`))
        }
      }, 30000)
    })
  }
  onEvent(fn) {
    this.handlers.push(fn)
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || '').slice(0, 200))
    return r.result?.value
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  return res.json()
}

// ---------- IDE 生命周期 ----------
function quitIde() {
  spawnSync('osascript', ['-e', 'quit app "wechatwebdevtools"'], { timeout: 20000 })
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const { status } = spawnSync('pgrep', ['-f', 'wechatwebdevtools'])
    if (status !== 0) break
    spawnSync('sleep', ['1'])
  }
  spawnSync('pkill', ['-f', 'wechatwebdevtools'])
  spawnSync('sleep', ['3'])
}
function sleepSync(s) {
  spawnSync('sleep', [String(s)])
}

function setDevice(index) {
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
    if (index >= data.device.list.length) continue
    data.device.current = index
    data.deviceInfo = data.device.list[index].info
    if ('rotated' in data) data.rotated = false
    writeFileSync(p, JSON.stringify(data))
    touched++
  }
  console.log(`[device] 已改写 ${touched} 个存储文件 → index=${index}`)
  return touched
}

async function httpGetOk(url) {
  try {
    const r = await fetch(url)
    return r.ok
  } catch {
    return false
  }
}

async function startIde() {
  const child = spawn(ELECTRON, [`--remote-debugging-port=${CDP_PORT}`], {
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  // 等 CDP 与服务端口就绪
  const dl = Date.now() + 90000
  while (Date.now() < dl) {
    if ((await httpGetOk(`http://127.0.0.1:${CDP_PORT}/json/version`)) && (await httpGetOk('http://127.0.0.1:21174/v2/islogin'))) return
    await sleep(1500)
  }
  throw new Error('IDE 启动超时(CDP/服务端口未就绪)')
}

async function openProjectWindow() {
  const P = encodeURIComponent(PROJECT_PATH)
  const r = await fetch(`http://127.0.0.1:21174/v2/open?project=${P}`)
  const body = await r.text()
  console.log('[ide] /v2/open →', body.trim())
  if (!body.includes('s0') && !body.includes('winId')) throw new Error('项目窗口打开失败: ' + body)
}

// ---------- 单机型测试 ----------
async function testDevice(dev) {
  const outDir = path.join(OUT_ROOT, dev.key)
  mkdirSync(outDir, { recursive: true })
  const report = { device: dev.name, key: dev.key, pages: {}, console: [], exceptions: [] }

  console.log(`\n========== [${dev.key}] ${dev.name} ==========`)
  quitIde()
  if (!setDevice(dev.index)) throw new Error('未找到可改写的机型存储')

  await startIde()
  await openProjectWindow()

  // 等渲染层出现 + 逻辑层可用（冷启动首次编译可能超过 2 分钟）
  let logic = null
  const dl = Date.now() + 240000
  while (Date.now() < dl) {
    const ts = await cdpTargets()
    const logicT = ts.find((t) => t.url.includes('/appservice/'))
    const renderT = ts.find((t) => t.type === 'webview' && t.url.includes('/__pageframe__/pages/'))
    if (logicT && renderT) {
      logic = await Cdp.connect(logicT.webSocketDebuggerUrl)
      try {
        if ((await logic.eval('typeof wx === "object" && typeof wx.getSystemInfoSync === "function" && typeof wx.switchTab === "function"')) === true) break
      } catch {}
      logic.close()
      logic = null
    }
    await sleep(2000)
  }
  if (!logic) throw new Error('模拟器逻辑层未就绪')
  logic.onEvent((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
      report.console.push(String(msg.params.args?.map((a) => a.value ?? a.description).join(' ')).slice(0, 300))
    if (msg.method === 'Runtime.exceptionThrown')
      report.exceptions.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 300))
  })
  console.log('[sim] 逻辑层就绪')

  report.systemInfo = await (async () => {
    for (let i = 0; i < 8; i++) {
      try {
        return await logic.eval('wx.getSystemInfoSync()')
      } catch {
        logic.close()
        logic = null
        await sleep(2500)
        const ts = await cdpTargets()
        const logicT = ts.find((t) => t.url.includes('/appservice/'))
        if (logicT) logic = await Cdp.connect(logicT.webSocketDebuggerUrl)
      }
    }
    throw new Error('getSystemInfoSync 重试后仍不可用')
  })()
  console.log('[sys]', JSON.stringify({
    platform: report.systemInfo.platform,
    windowWidth: report.systemInfo.windowWidth,
    windowHeight: report.systemInfo.windowHeight,
    pixelRatio: report.systemInfo.pixelRatio,
    safeArea: report.systemInfo.safeArea,
  }))
  report.widthMatch = report.systemInfo.windowWidth === dev.expectWidth
  if (!report.widthMatch) console.warn(`[warn] windowWidth=${report.systemInfo.windowWidth} ≠ 期望 ${dev.expectWidth}`)

  const list = pages()
  // 逻辑层上下文可能在导航中被重建(appservice 重载),每页导航前做健康检查并按需重连
  const ensureLogic = async () => {
    for (let i = 0; i < 10; i++) {
      if (logic) {
        try {
          if ((await logic.eval('typeof wx === "object" && typeof wx.switchTab === "function"')) === true) return
        } catch {}
        logic.close()
        logic = null
      }
      await sleep(2500)
      const ts = await cdpTargets()
      const logicT = ts.find((t) => t.url.includes('/appservice/'))
      if (logicT) {
        logic = await Cdp.connect(logicT.webSocketDebuggerUrl)
        logic.onEvent((msg) => {
          if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error')
            report.console.push(String(msg.params.args?.map((a) => a.value ?? a.description).join(' ')).slice(0, 300))
          if (msg.method === 'Runtime.exceptionThrown')
            report.exceptions.push(String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text).slice(0, 300))
        })
      }
    }
    throw new Error('逻辑层持续不可用')
  }

  for (let li = 0; li < list.length; li++) {
    const p = list[li]
    const errTag = report.console.length
    try {
      await ensureLogic()
      // 导航（在逻辑层执行）
      await logic.eval(`new Promise((res) => {
        const o = { url: '${p.url}', complete: () => res(true) };
        ${p.tab ? 'wx.switchTab(o)' : 'wx.reLaunch(o)'};
        setTimeout(() => res(false), 9000);
      })`)
      // 等渲染层 URL 切到目标页
      const want = '/__pageframe__' + p.url.split('?')[0]
      const dl2 = Date.now() + 15000
      let rendered = false
      while (Date.now() < dl2) {
        const ts = await cdpTargets()
        if (ts.some((t) => t.type === 'webview' && t.url.includes(want))) {
          rendered = true
          break
        }
        await sleep(600)
      }
      if (!rendered) console.warn(`[warn] ${p.key} 渲染层未出现: ${want}`)
      await sleep(p.settle)

      // 从地图页拿一条足迹 id 供详情页使用，并动态插入详情页任务
      if (p.isMap && !fpId) {
        try {
          fpId = (await logic.eval(
            `(() => {
              const page = getCurrentPages().find(pg => pg.route === 'pages/map/index');
              return page?.data?.selectedFootprint?.id
                || page?.data?.todayDrop?.footprint?.id
                || page?.data?.unplacedFootprints?.[0]?.id
                || getApp().globalData?.footprints?.[0]?.id
                || '';
            })()`,
          )) || ''
          if (fpId) {
            console.log('[data] 足迹 id =', fpId)
            list.splice(li + 1, 0, { key: '05-footprint-detail', url: `/pages/footprint-detail/index?id=${fpId}`, settle: 2600 })
          }
        } catch {}
      }

      // 截图：渲染层 webview（页面目标可能在过渡期消失/更换，给慢机型更长恢复窗口）
      let shotOk = false
      for (let attempt = 0; attempt < 6 && !shotOk; attempt++) {
        const ts = await cdpTargets()
        const renderT = ts.find((t) => t.type === 'webview' && t.url.includes(want))
        if (!renderT) {
          await sleep(2000)
          continue
        }
        const rc = await Cdp.connect(renderT.webSocketDebuggerUrl)
        try {
          const { data } = await rc.send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(path.join(outDir, `${p.key}.png`), Buffer.from(data, 'base64'))
          shotOk = true
        } catch {
          await sleep(2000)
        } finally {
          rc.close()
        }
      }
      report.pages[p.key] = {
        shot: shotOk ? path.join(outDir, `${p.key}.png`) : null,
        errors: report.console.slice(errTag).length,
      }
      console.log(`[shot] ${dev.key}/${p.key}.png${shotOk ? '' : ' (截图失败)'}`)
    } catch (e) {
      report.pages[p.key] = { error: String(e?.message || e).slice(0, 200) }
      console.warn(`[fail] ${p.key}:`, e?.message)
    }
  }

  logic.close()
  quitIde()
  return report
}

// ---------- 主流程 ----------
mkdirSync(OUT_ROOT, { recursive: true })
let all = {}
try {
  all = JSON.parse(readFileSync(path.join(OUT_ROOT, 'report.json'), 'utf8'))
} catch {}
for (const dev of devices) {
  try {
    all[dev.key] = await testDevice(dev)
  } catch (e) {
    console.error(`[${dev.key}] 失败:`, e?.message)
    all[dev.key] = { fatal: String(e?.message || e) }
    quitIde()
  }
}
writeFileSync(path.join(OUT_ROOT, 'report.json'), JSON.stringify(all, null, 2))
console.log('\n[done] 报告 → output/multi-device/report.json')
for (const [k, r] of Object.entries(all)) {
  if (r.fatal) console.log(`  ${k}: FATAL ${r.fatal}`)
  else
    console.log(
      `  ${k}: ${r.systemInfo?.platform} ${r.systemInfo?.windowWidth}x${r.systemInfo?.windowHeight} dpr=${r.systemInfo?.pixelRatio} 宽度匹配=${r.widthMatch} 截图=${Object.values(r.pages).filter((p) => p.shot).length}/${Object.keys(r.pages).length} 控制台错误=${r.console.length} JS异常=${r.exceptions.length}`,
    )
}
