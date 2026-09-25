import type { Footprint } from '../../domain/types'
import { formatVisitDate } from '../../utils/date'
import { moodLabel, moodEmoji, categoryLabel, categoryEmoji } from '../../data/options'

interface FootprintCardDerived {
  photo: string
  dateLabel: string
  moodLabel: string
  moodEmoji: string
  categoryLabel: string
  categoryEmoji: string
  notePreview: string
  locationLabel: string
  statusLabel: string
}

const emptyDerived: FootprintCardDerived = {
  photo: '',
  dateLabel: '',
  moodLabel: '',
  moodEmoji: '',
  categoryLabel: '',
  categoryEmoji: '',
  notePreview: '',
  locationLabel: '',
  statusLabel: '',
}

Component({
  properties: {
    footprint: {
      type: Object,
      value: {} as Footprint,
    },
    compact: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    derived: emptyDerived,
  },
  observers: {
    footprint(fp: Footprint | null) {
      if (!fp) {
        this.setData({ derived: emptyDerived })
        return
      }
      const photo = fp.photos && fp.photos.length > 0 ? fp.photos[0] : ''
      const notePreview = fp.note
        ? fp.note.length > 48
          ? fp.note.slice(0, 48) + '…'
          : fp.note
        : ''
      const locationLabel = [fp.province, fp.city]
        .filter(Boolean)
        .join(' · ')
      this.setData({
        derived: {
          photo,
          dateLabel: formatVisitDate(fp.visitDate),
          moodLabel: moodLabel(fp.mood),
          moodEmoji: moodEmoji(fp.mood),
          categoryLabel: categoryLabel(fp.category),
          categoryEmoji: categoryEmoji(fp.category),
          notePreview,
          locationLabel,
          statusLabel: fp.status === 'wishlist' ? '心愿种子' : fp.status === 'fulfilled' ? '愿望开花' : '已到访',
        },
      })
    },
  },
  methods: {
    onTap() {
      const fp = this.properties.footprint as Footprint | undefined
      if (!fp?.id) return
      this.triggerEvent('tap', { id: fp.id, footprint: fp })
    },
  },
})
