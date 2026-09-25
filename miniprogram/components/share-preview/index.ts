import type { Footprint, ShareCardConfig } from '../../domain/types'
import { moodEmoji, moodLabel } from '../../data/options'
import { formatVisitDate } from '../../utils/date'

Component({
  properties: {
    footprint: { type: Object, value: {} as Footprint },
    config: {
      type: Object,
      value: {
        type: 'place',
        hideAddress: true,
        hideDate: false,
        hideNote: false,
      } as ShareCardConfig,
    },
  },
  data: {
    photoUrls: [] as string[],
    addressText: '',
    dateText: '',
    moodText: '',
    moodIcon: '',
    noteText: '',
  },
  observers: {
    'footprint, config'(footprint: Footprint | null, config: ShareCardConfig) {
      if (!footprint?.id) return
      const safeLocation = [footprint.city, footprint.poiName].filter(Boolean).join(' · ')
      this.setData({
        photoUrls: (footprint.photos || []).slice(0, 3),
        addressText: config.hideAddress ? safeLocation : footprint.address || safeLocation,
        dateText: config.hideDate ? '' : formatVisitDate(footprint.visitDate),
        moodText: moodLabel(footprint.mood),
        moodIcon: moodEmoji(footprint.mood),
        noteText: config.hideNote ? '' : footprint.note || '',
      })
    },
  },
})
