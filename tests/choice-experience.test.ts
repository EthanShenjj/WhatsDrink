import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const template = readFileSync('miniprogram/pages/choice/index.wxml', 'utf8')
const styles = readFileSync('miniprogram/pages/choice/index.wxss', 'utf8')
const behavior = readFileSync('miniprogram/pages/choice/index.ts', 'utf8')
const tabBarStyles = readFileSync('miniprogram/custom-tab-bar/index.wxss', 'utf8')

describe('Choice One experience', () => {
  it('keeps the motion preference available in both decision modes', () => {
    expect(template).toContain('bindtap="toggleReducedMotion"')
    expect(template).not.toContain('wx:if="{{choiceMode === \'wheel\'}}"\n        class="motion-toggle"')
    expect(template).not.toContain('class="motion-toggle" aria-label="抓娃娃机从完整品牌池随机抓取"')
  })

  it('turns the visible primary controls into result actions without adding a below-fold panel', () => {
    expect(template).toContain('bindtap="handleWheelPrimaryAction"')
    expect(template).toContain('bindtap="handleClawPrimaryAction"')
    expect(template).toContain("'就喝 ' + result.label + ' 并记录'")
    expect(template).not.toContain('class="result-panel"')
    expect(behavior).toContain('handleWheelPrimaryAction()')
    expect(behavior).toContain('handleClawPrimaryAction()')
  })

  it('keeps the machine chute clear by placing its controls outside the machine stage', () => {
    const machineStart = template.indexOf('class="claw-machine-stage')
    const machineClose = template.indexOf('</view>', template.indexOf('class="claw-output-prize"'))
    const controlsStart = template.indexOf('class="claw-controls"')

    expect(machineStart).toBeGreaterThan(-1)
    expect(machineClose).toBeGreaterThan(machineStart)
    expect(controlsStart).toBeGreaterThan(machineClose)
  })

  it('treats the repeated pool cups as decorative and announces the changing result once', () => {
    expect(template).toMatch(/class="claw-prize-pool"\s+aria-hidden="true"/)
    expect(template).not.toContain('role="listitem"')
    expect(template).toContain('aria-live="polite"')
    expect(template).toContain('{{clawStatusText}}')
    expect(behavior).toContain('clawStatusText')
  })

  it('keeps carried cups unbranded and reveals the brand at the output', () => {
    expect(template).not.toContain('class="claw-carried-label"')
    expect(template).toContain('class="claw-output-label"')
  })

  it('allows the five-candidate summary to wrap instead of truncating the last brand', () => {
    expect(styles).toMatch(/\.candidate-summary\s*\{[^}]*white-space:\s*normal;/s)
    expect(styles).toMatch(/\.candidate-summary\s*\{[^}]*-webkit-line-clamp:\s*2;/s)
  })

  it('keeps the wheel above the fixed tab bar on short phone screens', () => {
    expect(styles).toMatch(
      /@media\s*\(max-height:\s*760px\)[\s\S]*?\.wheel-stage\s*\{[^}]*height:\s*540rpx;/,
    )
    expect(styles).toMatch(
      /@media\s*\(max-height:\s*760px\)[\s\S]*?\.wheel-canvas\s*\{[^}]*width:\s*480rpx;[^}]*height:\s*480rpx;/,
    )
    expect(tabBarStyles).toMatch(/\.tab-bar\s*\{[^}]*background:\s*#fdfcfb;/s)
  })

  it('measures the mounted responsive canvas before drawing the wheel', () => {
    expect(behavior).toContain('drawWheelWhenReady()')
    expect(behavior).toContain(".select('#wheelCanvas')")
    expect(behavior).toContain('.boundingClientRect(')
    expect(behavior).toContain('this.drawWheel(undefined, false, rect.width)')
  })

  it('uses compact claw assets and shows a visible fallback if an image fails', () => {
    expect(template).toContain('src="/assets/claw-machine-empty.webp"')
    expect(template).toContain('binderror="handleClawAssetError"')
    expect(template).toContain('wx:if="{{clawAssetFailed}}"')
    expect(template).toContain('class="claw-machine-fallback"')
    expect(template).not.toContain('src="/assets/claw-machine-empty.png"')
    expect(behavior).toContain('handleClawAssetError()')
  })
})
