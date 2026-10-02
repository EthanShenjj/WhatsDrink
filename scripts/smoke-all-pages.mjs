// 全页面冒烟:cli auto 起自动化端口 -> automator.connect -> 逐页 reLaunch -> 收集异常
import automator from 'miniprogram-automator'
import { spawn } from 'node:child_process'

const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const PROJECT = '/Users/ethanshen/Desktop/LLM/untitled folder/WhatsDrink'
const PORT = 9421
// 无参数依赖的页面(footprint-form/footprint-detail 需要 id,单独处理)
const PAGES = [
  'pages/map/index',
  'pages/time/index',
  'pages/guide/index',
  'pages/mine/index',
  'pages/growth/index',
  'pages/membership/index',
  'pages/settings/index',
  'pages/personal-settings/index',
  'pages/mine-edit/index',
  'pages/privacy/index',
  'pages/travel-plan/index',
  'pages/time-capsule/index',
]

const errors = []
const results = []

const cli = spawn(CLI, ['auto', '--project', PROJECT, '--auto-port', String(PORT)], { stdio: 'pipe' })
cli.stdout.on('data', (d) => process.stdout.write('[cli] ' + d))
cli.stderr.on('data', (d) => process.stdout.write('[cli!] ' + d))

// 重试连接(cli auto 就绪需要几秒)
let mini = null
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  try {
    mini = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` })
    break
  } catch (e) {
    if (i === 29) { console.error('CONNECT_FAIL: ' + e.message); cli.kill('SIGKILL'); process.exit(1) }
  }
}

mini.on('exception', (err) => {
  errors.push(`exception @${err.page?.path || '?'}: ${err.message}`)
})
mini.on('console', (msg) => {
  if (msg.type === 'error') errors.push(`console.error @${msg.args?.[0]?.__page_path || '?'}: ${JSON.stringify(msg.args).slice(0, 200)}`)
})

for (const p of PAGES) {
  try {
    const page = await mini.reLaunch('/' + p)
    await new Promise((r) => setTimeout(r, 1200))
    const cur = await mini.currentPage()
    const ok = cur && cur.path === p
    results.push(`${ok ? 'OK ' : 'NAV_FAIL'} ${p}${ok ? '' : ` (at ${cur ? cur.path : 'null'})`}`)
  } catch (e) {
    results.push(`ERROR ${p}: ${e.message}`)
  }
}

console.log('\n===== SMOKE RESULTS =====')
results.forEach((r) => console.log(r))
console.log('===== COLLECTED ERRORS =====')
console.log(errors.length ? errors.join('\n') : '(none)')

await mini.disconnect()
cli.kill('SIGKILL')
process.exit(0)
