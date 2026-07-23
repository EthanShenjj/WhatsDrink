import type { DaySummary, DrinkRecord, WeekDayView } from '../domain/types'

const pad = (value: number): string => String(value).padStart(2, '0')

export const dateKey = (value: number | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const timeText = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const homeDateText = (date = new Date()): string => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${date.getMonth() + 1}月${date.getDate()}日，${weekdays[date.getDay()]}`
}

export const summarizeRecords = (records: DrinkRecord[]): DaySummary =>
  records.reduce<DaySummary>(
    (summary, record) => {
      summary.count += 1
      if (typeof record.calorieKcal === 'number') {
        summary.knownCalories += record.calorieKcal
      } else {
        summary.unknownCaloriesCount += 1
      }
      return summary
    },
    { count: 0, knownCalories: 0, unknownCaloriesCount: 0 },
  )

export const getWeekDays = (anchor = new Date()): WeekDayView[] => {
  const current = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
  const offset = current.getDay() === 0 ? -6 : 1 - current.getDay()
  const monday = new Date(current)
  monday.setDate(current.getDate() + offset)
  const labels = ['一', '二', '三', '四', '五', '六', '日']
  return labels.map((weekday, index) => {
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

export interface MonthCell {
  key: string
  day: number
  date: Date
  inMonth: boolean
  isToday: boolean
}

export const buildMonthGrid = (year: number, month: number, today = new Date()): MonthCell[] => {
  const first = new Date(year, month, 1)
  const mondayOffset = first.getDay() === 0 ? 6 : first.getDay() - 1
  const start = new Date(year, month, 1 - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return {
      key: dateKey(date),
      day: date.getDate(),
      date,
      inMonth: date.getMonth() === month,
      isToday: dateKey(date) === dateKey(today),
    }
  })
}

export const timestampFromDateAndTime = (dateValue: string, timeValue: string): number => {
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hour, minute] = timeValue.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}
