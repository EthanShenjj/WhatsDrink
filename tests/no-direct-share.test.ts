import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pagesRoot = join(process.cwd(), 'miniprogram', 'pages')

describe('private memory boundary', () => {
  it('does not expose a direct share entry point or a recipient ticket page', () => {
    const app = JSON.parse(readFileSync(join(process.cwd(), 'miniprogram', 'app.json'), 'utf8'))
    expect(app.pages).not.toContain('pages/ticket-share/index')

    for (const page of readdirSync(pagesRoot)) {
      for (const file of readdirSync(join(pagesRoot, page))) {
        if (!/\.(ts|wxml)$/.test(file)) continue
        const source = readFileSync(join(pagesRoot, page, file), 'utf8')
        expect(source, `${page}/${file}`).not.toMatch(/open-type=["']share["']|onShareAppMessage|pages\/ticket-share\/index/)
      }
    }
  })
})
