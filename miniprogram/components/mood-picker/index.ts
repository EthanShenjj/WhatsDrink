import { MOOD_OPTIONS } from '../../data/options'

interface MoodItem {
  value: string
  label: string
  emoji: string
}

Component({
  properties: {
    value: {
      type: String,
      value: '',
    },
    moods: {
      type: Array,
      value: [] as string[],
    },
  },
  data: {
    moodList: MOOD_OPTIONS as MoodItem[],
  },
  observers: {
    moods(moods: string[]) {
      const list =
        moods && moods.length
          ? MOOD_OPTIONS.filter((m) => moods.includes(m.value))
          : (MOOD_OPTIONS as MoodItem[])
      this.setData({ moodList: list })
    },
  },
  methods: {
    onPick(e: WechatMiniprogram.TouchEvent) {
      const value = String(e.currentTarget.dataset.value)
      this.triggerEvent('change', { value })
    },
  },
})
