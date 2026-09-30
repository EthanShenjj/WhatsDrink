import type { GrowthColorId } from '../../domain/types'

const STATES = new Set<GrowthColorId>(['journey', 'explore', 'discover', 'highlight', 'companion', 'dawn'])
const EXPRESSIONS = new Set(['default', 'happy', 'think', 'thinking', 'depart', 'explore', 'collect', 'record', 'companion'])
const MOTIONS = new Set(['none', 'float', 'pop'])
const lastStateKeys = new WeakMap<object, string>()

Component({
  properties: {
    state: { type: String, value: 'journey' },
    expression: { type: String, value: 'default' },
    size: { type: String, value: '220rpx' },
    motion: { type: String, value: 'none' },
    label: { type: String, value: '小拾' },
  },
  data: {
    imageSrc: '/assets/growth/journey.webp',
    normalizedExpression: 'default',
    normalizedMotion: 'none',
  },
  observers: {
    'state,expression,motion'() {
      this.applyState()
    },
  },
  methods: {
    applyState() {
      const requested = this.data.state as GrowthColorId
      const state: GrowthColorId = STATES.has(requested) ? requested : 'journey'
      const expression = EXPRESSIONS.has(this.data.expression) ? this.data.expression : 'default'
      const motion = MOTIONS.has(this.data.motion) ? this.data.motion : 'none'
      const stateKey = `${state}|${expression}|${motion}`
      if (stateKey === lastStateKeys.get(this)) return
      lastStateKeys.set(this, stateKey)
      this.setData({
        imageSrc: `/assets/growth/${state}.webp`,
        normalizedExpression: expression,
        normalizedMotion: motion,
      })
    },
  },
  lifetimes: {
    attached() {
      this.applyState()
    },
    detached() {
      lastStateKeys.delete(this)
    },
  },
})
