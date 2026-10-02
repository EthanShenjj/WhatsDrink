import type { GrowthColorId } from '../../domain/types'

const STATES = new Set<GrowthColorId>(['journey', 'explore', 'discover', 'highlight', 'companion', 'dawn'])
const EXPRESSIONS = new Set(['default', 'happy', 'think', 'thinking', 'depart', 'explore', 'collect', 'record', 'companion', 'reunion'])
const MOTIONS = new Set(['none', 'float', 'pop'])
// 必须保留为静态字面量，微信开发者工具才能在“忽略未使用文件”开启时
// 正确识别并打包每一张成长形象图片。
const STATE_IMAGES: Record<GrowthColorId, string> = {
  journey: '/assets/growth/journey.png',
  explore: '/assets/growth/explore.png',
  discover: '/assets/growth/discover.png',
  highlight: '/assets/growth/highlight.png',
  companion: '/assets/growth/companion.png',
  dawn: '/assets/growth/dawn.png',
}
const EXPRESSION_ACCESSORIES: Record<string, string> = {
  think: '/assets/growth/acc-thinking.png',
  thinking: '/assets/growth/acc-thinking.png',
  depart: '/assets/growth/acc-depart.png',
  explore: '/assets/growth/acc-explore.png',
  collect: '/assets/growth/acc-collect.png',
  record: '/assets/growth/acc-record.png',
  companion: '/assets/growth/acc-companion.png',
  reunion: '/assets/growth/acc-reunion.png',
}
const POSE_IMAGES: Record<string, string> = {
  dawn: '/assets/growth/pose-dawn.png',
  seasons: '/assets/growth/pose-seasons.png',
  distance: '/assets/growth/pose-distance.png',
  hometown: '/assets/growth/pose-hometown.png',
  reunion: '/assets/growth/pose-reunion.png',
  annual: '/assets/growth/pose-annual.png',
}
// 每个成长状态的签名姿势：调用方不指定 expression（即 default）时自动套用，
// 让同一素材在不同状态下姿态可辨；显式传入的 expression 优先。
const STATE_POSES: Record<GrowthColorId, string> = {
  journey: 'depart',
  explore: 'explore',
  discover: 'happy',
  highlight: 'collect',
  companion: 'companion',
  dawn: 'reunion',
}
const lastStateKeys = new WeakMap<object, string>()

Component({
  properties: {
    state: { type: String, value: 'journey' },
    expression: { type: String, value: 'default' },
    pose: { type: String, value: '' },
    size: { type: String, value: '220rpx' },
    motion: { type: String, value: 'none' },
    label: { type: String, value: 'Lumi' },
  },
  data: {
    imageSrc: STATE_IMAGES.journey,
    accessorySrc: '',
    normalizedExpression: 'default',
    normalizedMotion: 'none',
  },
  observers: {
    'state,expression,pose,motion'() {
      this.applyState()
    },
  },
  methods: {
    applyState() {
      const requested = this.data.state as GrowthColorId
      const state: GrowthColorId = STATES.has(requested) ? requested : 'journey'
      const requestedExpression = this.data.expression
      const expression = EXPRESSIONS.has(requestedExpression) && requestedExpression !== 'default'
        ? requestedExpression
        : STATE_POSES[state]
      const poseImage = POSE_IMAGES[this.data.pose] || ''
      const motion = MOTIONS.has(this.data.motion) ? this.data.motion : 'none'
      const stateKey = `${state}|${expression}|${this.data.pose}|${motion}`
      if (stateKey === lastStateKeys.get(this)) return
      lastStateKeys.set(this, stateKey)
      this.setData({
        imageSrc: poseImage || STATE_IMAGES[state],
        accessorySrc: poseImage ? '' : (EXPRESSION_ACCESSORIES[expression] || ''),
        normalizedExpression: poseImage ? 'default' : expression,
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
