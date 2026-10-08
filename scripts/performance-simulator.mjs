// 微信开发者工具模拟器基线：只改页面内存态，结束后重新打开地图恢复真实数据。
// 运行：node scripts/performance-simulator.mjs。需要开发者工具 CLI 和自动化端口可用。
import automator from 'miniprogram-automator'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const projectPath = process.cwd()
const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const report = {
  measuredAt: new Date().toISOString(),
  note: '模拟器页面方法调用至 wx.nextTick；不含真实触摸、云请求或原生地图最终绘制。',
  scenarios: {},
}
const percentile = (values, p) => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(values.length * p) - 1]
}

let mini
try {
  mini = process.env.WX_AUTO_ENDPOINT
    ? await automator.connect({ wsEndpoint: process.env.WX_AUTO_ENDPOINT })
    : await automator.launch({
      cliPath, projectPath, timeout: 120000, trustProject: true,
      args: process.env.WX_CLI_PORT ? ['--port', process.env.WX_CLI_PORT] : [],
    })
  for (const [route, method] of [
    ['map', 'applyFootprints'],
    ['time', 'applyFootprints'],
    ['mine', 'applyProfileAndStats'],
  ]) {
    await mini.reLaunch(`/pages/${route}/index`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    report.scenarios[route] = {}
    for (const count of [0, 100, 1000]) {
      const samples = await mini.evaluate(async (size, pageMethod) => {
        const page = getCurrentPages()[getCurrentPages().length - 1]
        if (!page || typeof page[pageMethod] !== 'function') throw new Error('页面方法不可用')
        if (pageMethod === 'applyFootprints' && page.route === 'pages/map/index') page.mapReady = true
        const list = Array.from({ length: size }, (_, index) => ({
          id: `perf_${index}`, userId: 'synthetic', clientRequestId: `perf_req_${index}`,
          status: 'visited', poiName: `地点${index}`,
          lat: 20 + (index % 50) * 0.2, lng: 100 + Math.floor(index / 50) * 0.2,
          country: '中国', province: '江苏省', city: `城市${index % 50}`,
          visitDate: '2026-10-01', photos: [], tags: [], source: 'manual',
          createdAt: index + 1, updatedAt: index + 1,
        }))
        const profile = { id: 'synthetic', nickname: '', avatarUrl: '', createdAt: 1, updatedAt: 1 }
        const results = []
        for (let run = 0; run < 20; run += 1) {
          const startedAt = Date.now()
          if (pageMethod === 'applyProfileAndStats') page.applyProfileAndStats({ ...profile }, [...list])
          else page.applyFootprints([...list])
          await new Promise((resolve) => wx.nextTick(resolve))
          results.push(Date.now() - startedAt)
        }
        return results
      }, count, method)
      if (!Array.isArray(samples) || samples.length !== 20) throw new Error(`${route}/${count} 样本数量异常`)
      report.scenarios[route][count] = {
        p50Ms: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        slowSamples: samples.filter((value) => value >= 50).length,
      }
    }
  }
} catch (error) {
  report.error = String(error?.message || error)
  process.exitCode = 1
} finally {
  if (mini) {
    await mini.reLaunch('/pages/map/index').catch(() => undefined)
    await mini.disconnect().catch(() => undefined)
  }
  mkdirSync(path.join(projectPath, 'output'), { recursive: true })
  const reportPath = path.join(projectPath, 'output/performance-simulator.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ reportPath, ...report }, null, 2))
}
