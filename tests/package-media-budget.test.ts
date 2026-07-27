import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mediaExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp3',
  '.wav',
  '.aac',
  '.m4a',
  '.ogg',
])

const collectMediaBytes = (directory: string): number =>
  readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return total + collectMediaBytes(file)
    if (!mediaExtensions.has(path.extname(entry.name).toLowerCase())) return total
    return total + statSync(file).size
  }, 0)

describe('packaged media budget', () => {
  it('keeps the aggregate image and audio payload within 200 KiB', () => {
    expect(collectMediaBytes('miniprogram')).toBeLessThanOrEqual(200 * 1024)
  })
})
