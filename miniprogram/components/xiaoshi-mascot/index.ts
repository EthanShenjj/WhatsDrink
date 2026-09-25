import type { GrowthColorId } from '../../domain/types'

const STATES = new Set<GrowthColorId>(['journey', 'explore', 'discover', 'highlight', 'companion', 'dawn'])

Component({
  properties: {
    state: {
      type: String,
      value: 'journey',
    },
    size: {
      type: Number,
      value: 220,
    },
  },
  data: {
    cropStyle: '',
    imageSrc: '/assets/growth/journey.webp',
  },
  observers: {
    'state,size'() {
      this.applyLayout()
    },
  },
  lifetimes: {
    attached() {
      this.applyLayout()
    },
  },
  methods: {
    applyLayout() {
      const size = Math.max(72, Number(this.data.size) || 220)
      const requested = this.data.state as GrowthColorId
      const state: GrowthColorId = STATES.has(requested) ? requested : 'journey'
      this.setData({
        cropStyle: `width:${size}rpx;height:${size}rpx;`,
        imageSrc: `/assets/growth/${state}.webp`,
      })
    },
  },
})
