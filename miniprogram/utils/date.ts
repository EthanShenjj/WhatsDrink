import type { MonthCell, Footprint } from '../domain/types'

const pad = (value: number): string => String(value).padStart(2, '0')

export const dateKey = (value: number | Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const todayKey = (): string => dateKey(new Date())

export const formatVisitDate = (dateStr?: string): string => {
  if (!dateStr) return '今天'
  const date = new Date(dateStr)
  const now = new Date()
  if (dateKey(date) === dateKey(now)) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dateKey(date) === dateKey(yesterday)) return '昨天'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export const formatMonthLabel = (year: number, month: number): string =>
  `${year}年${month + 1}月`

export const weekdays = ['一', '二', '三', '四', '五', '六', '日']

export const buildMonthGrid = (
  year: number,
  month: number,
  footprints: Footprint[] = [],
  today = new Date(),
): MonthCell[] => {
  const footprintMap = new Map<string, Footprint[]>()
  for (const fp of footprints) {
    if (!fp.visitDate) continue
    const key = dateKey(fp.visitDate)
    const list = footprintMap.get(key) || []
    list.push(fp)
    footprintMap.set(key, list)
  }

  const first = new Date(year, month, 1)
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
  const start = new Date(year, month, 1 - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = dateKey(date)
    const dayFootprints = footprintMap.get(key) || []
    const photoFootprint = dayFootprints.find((fp) => fp.photos.length > 0)
    return {
      key,
      day: date.getDate(),
      date,
      inMonth: date.getMonth() === month,
      isToday: key === dateKey(today),
      footprintCount: dayFootprints.length,
      previewPhoto: photoFootprint?.photos[0],
      previewMood: dayFootprints[0]?.mood,
    }
  })
}

export const getWeekDays = (anchor = new Date()): import('../domain/types').WeekDayView[] => {
  const current = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const offset = current.getDay() === 0 ? -6 : 1 - current.getDay()
  const monday = new Date(current)
  monday.setDate(current.getDate() + offset)
  return weekdays.map((weekday, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return {
      date,
      key: dateKey(date),
      weekday,
      day: date.getDate(),
      isToday: dateKey(date) === dateKey(anchor),
    }
  })
}

export const relativeTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}周前`
  return dateKey(timestamp)
}

export const daysUntil = (dateStr: string): number => {
  const target = new Date(dateStr)
  const now = new Date()
  target.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

export const addDays = (dateStr: string, days: number): string => {
  const date = new Date(dateStr)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}
