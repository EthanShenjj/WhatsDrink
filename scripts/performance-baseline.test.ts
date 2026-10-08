import { describe, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { clusterFootprints } from '../miniprogram/utils/map'
import { budgetMapItems } from '../miniprogram/utils/map-viewport'
import type { Footprint } from '../miniprogram/domain/types'

const records = (count: number, dense = false): Footprint[] => Array.from({ length: count }, (_, index) => ({
  id: `perf_${index}`,
  userId: 'synthetic',
  clientRequestId: `perf_req_${index}`,
  status: 'visited',
  poiName: `地点${index}`,
  lat: dense ? 31.2 + index * 0.000001 : 20 + (index % 50) * 0.2,
  lng: dense ? 121.4 + index * 0.000001 : 100 + Math.floor(index / 50) * 0.2,
  photos: [], tags: [], source: 'manual', createdAt: index, updatedAt: index,
}))

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100
}

const measure = (operation: () => void): { p50Ms: number; p95Ms: number; slowSamples: number } => {
  const samples: number[] = []
  operation() // 预热，不计入样本
  for (let run = 0; run < 20; run += 1) {
    const startedAt = performance.now()
    operation()
    samples.push(performance.now() - startedAt)
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    slowSamples: samples.filter((value) => value >= 50).length,
  }
}

describe('synthetic performance baseline (JS only)', () => {
  it('records 20 repetitions for empty, 100 and 1000 footprints', () => {
    const report: Record<string, unknown> = {
      measuredAt: new Date().toISOString(),
      note: 'Node.js 纯 JS 计算；不代表小程序页面、网络或真机帧率。',
    }
    for (const count of [0, 100, 1000]) {
      const list = records(count)
      report[String(count)] = {
        cluster: measure(() => { clusterFootprints(list, 12) }),
        markerBudget: measure(() => { budgetMapItems(list) }),
      }
    }
    const dense = records(1000, true)
    report.dense1000 = { cluster: measure(() => { clusterFootprints(dense, 12) }) }
    mkdirSync('output', { recursive: true })
    writeFileSync('output/performance-synthetic.json', JSON.stringify(report, null, 2))
    console.info('[perf:baseline]', JSON.stringify(report))
  })
})
