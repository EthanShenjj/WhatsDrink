import { describe, expect, it } from 'vitest'
import { fitImageWithin } from '../miniprogram/utils/image'

describe('fitImageWithin', () => {
  it('keeps small images unchanged', () => {
    expect(fitImageWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('scales landscape images without distortion', () => {
    expect(fitImageWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales portrait images without distortion', () => {
    expect(fitImageWithin(3000, 4000, 480)).toEqual({ width: 360, height: 480 })
  })
})
