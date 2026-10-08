import type {
  AnnualMemoryReport,
  Footprint,
  GrowthColorId,
  GrowthColorView,
  GrowthExpressionView,
  GrowthHiddenStateView,
  GrowthPreferences,
  GrowthOverview,
  GrowthSnapshot,
  HistoricalMonthReport,
  UserProfile,
} from '../domain/types'
import { placeKey } from './footprint'

const DAY = 86_400_000

// 同一份足迹与档案在一天内的快照不会变化；地图、时光、我的、成长页共用，
// 记忆化避免各页 onShow 重复执行内部的 O(n²) 最大距离等计算。
const snapshotMemo = new WeakMap<
  Footprint[],
  { profile: UserProfile | null | undefined; day: number; result: GrowthSnapshot }
>()
const overviewMemo = new WeakMap<
  Footprint[],
  { profile: UserProfile | null | undefined; day: number; result: GrowthOverview }
>()

const COLORS: Array<Omit<GrowthColorView, 'unlocked'>> = [
  { id: 'journey', name: '启程蓝紫', shortName: '启程', description: '最常见的陪伴状态' },
  { id: 'explore', name: '探索橙粉', shortName: '探索', description: '最近 7 天新增 3 条足迹' },
  { id: 'discover', name: '发现青蓝', shortName: '发现', description: '走进一座新城市或新地点类型' },
  { id: 'highlight', name: '高光金黄', shortName: '高光', description: '实现一个想去或达成阶段里程碑' },
  { id: 'companion', name: '陪伴粉', shortName: '陪伴', description: '连续 3 周都有生活记录' },
  { id: 'dawn', name: '晨曦', shortName: '晨曦', description: '当过去和现在再次相遇', hidden: true },
]

const visitTime = (item: Footprint): number => {
  if (item.visitDate) {
    const parsed = new Date(`${item.visitDate}T12:00:00`).getTime()
    if (Number.isFinite(parsed)) return parsed
  }
  return item.createdAt
}

const monthKeyOf = (time: number): string => {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const weekKeyOf = (time: number): string => {
  const date = new Date(time)
  const day = (date.getDay() + 6) % 7
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

const weekStartOf = (time: number): number => {
  const date = new Date(time)
  const day = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day).getTime()
}

const longestWeeklyStreak = (visits: Footprint[]): number => {
  const weeks = [...new Set(visits.map((item) => weekStartOf(visitTime(item))))].sort((a, b) => a - b)
  let longest = 0
  let current = 0
  let previous = 0
  weeks.forEach((week) => {
    current = previous && Math.round((week - previous) / (7 * DAY)) === 1 ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = week
  })
  return longest
}

const distanceKm = (a: Footprint, b: Footprint): number => {
  if ([a.lat, a.lng, b.lat, b.lng].some((value) => typeof value !== 'number')) return 0
  const toRad = (value: number) => value * Math.PI / 180
  const lat1 = toRad(a.lat as number)
  const lat2 = toRad(b.lat as number)
  const dLat = lat2 - lat1
  const dLng = toRad((b.lng as number) - (a.lng as number))
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const longestPlaceGap = (visits: Footprint[]): number => {
  const byPlace = new Map<string, number[]>()
  visits.forEach((item) => {
    const key = placeKey(item)
    byPlace.set(key, [...(byPlace.get(key) || []), visitTime(item)])
  })
  let longest = 0
  byPlace.forEach((times) => {
    const sorted = times.sort((a, b) => a - b)
    for (let index = 1; index < sorted.length; index += 1) {
      longest = Math.max(longest, (sorted[index] - sorted[index - 1]) / DAY)
    }
  })
  return longest
}

const maxPlaceVisits = (visits: Footprint[]): number => {
  const counts = new Map<string, number>()
  visits.forEach((item) => counts.set(placeKey(item), (counts.get(placeKey(item)) || 0) + 1))
  return Math.max(0, ...counts.values())
}

const hasNewDimension = (recent: Footprint[], older: Footprint[]): boolean => {
  const olderCities = new Set(older.map((item) => item.city).filter(Boolean))
  const olderCategories = new Set(older.map((item) => item.category).filter(Boolean))
  return recent.some((item) =>
    Boolean((item.city && !olderCities.has(item.city))
      || (item.category && !olderCategories.has(item.category))))
}

const selectState = (params: {
  visitCount: number
  hasNew: boolean
  hasFulfilled: boolean
  activeWeeks: number
}): GrowthColorId => {
  if (params.hasFulfilled) return 'highlight'
  if (params.hasNew && params.visitCount > 0) return 'discover'
  if (params.visitCount >= 3) return 'explore'
  if (params.activeWeeks >= 3) return 'companion'
  return 'journey'
}

export const isGrowthPlusActive = (preferences?: GrowthPreferences, now = Date.now()): boolean =>
  Boolean(
    (preferences?.plusUntil && preferences.plusUntil > now)
    || (preferences?.proUntil && preferences.proUntil > now),
  )

export const isGrowthProActive = (preferences?: GrowthPreferences, now = Date.now()): boolean =>
  Boolean(preferences?.proUntil && preferences.proUntil > now)

const fulfilledTime = (item: Footprint): number =>
  item.fulfilledAt || item.updatedAt || item.createdAt

const reportVisits = (footprints: Footprint[]): Footprint[] =>
  footprints.filter((item) => item.status === 'visited' && item.recordLevel !== 'city')

const reportFulfilled = (footprints: Footprint[]): Footprint[] => [
  ...footprints.filter((item) => item.status === 'fulfilled'),
  ...footprints.filter((item) => item.status === 'visited' && item.convertedFromWishlist && !item.wishId),
]

const topCityOf = (visits: Footprint[]): string | undefined => {
  const counts = new Map<string, number>()
  visits.forEach((item) => {
    if (item.city) counts.set(item.city, (counts.get(item.city) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** Plus 历史月份回顾：只返回当前月份之前且有足迹的月份，不保存报告副本。 */
export const buildHistoricalMonthReports = (
  footprints: Footprint[],
  now = Date.now(),
): HistoricalMonthReport[] => {
  const currentMonth = monthKeyOf(now)
  const visits = reportVisits(footprints)
  const fulfilled = reportFulfilled(footprints)
  const groups = new Map<string, Footprint[]>()
  visits.forEach((item) => {
    const key = monthKeyOf(visitTime(item))
    if (key >= currentMonth) return
    groups.set(key, [...(groups.get(key) || []), item])
  })
  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, monthVisits]) => {
      const year = Number(key.slice(0, 4))
      const month = Number(key.slice(5, 7))
      const topCity = topCityOf(monthVisits)
      const fulfilledCount = fulfilled.filter((item) => monthKeyOf(fulfilledTime(item)) === key).length
      return {
        key,
        year,
        month,
        label: `${year} 年 ${month} 月`,
        title: `${month} 月回顾`,
        summary: `留下 ${monthVisits.length} 段足迹${topCity ? `，最常走进 ${topCity}` : ''}${fulfilledCount ? `，实现 ${fulfilledCount} 个想去` : ''}。`,
        visitCount: monthVisits.length,
        cityCount: new Set(monthVisits.map((item) => item.city).filter(Boolean)).size,
        fulfilledCount,
      }
    })
}

/** Pro 年度回顾：按现有足迹实时计算；只有上一年也有记录时才生成跨年对比。 */
export const buildAnnualMemoryReports = (
  footprints: Footprint[],
  now = Date.now(),
): AnnualMemoryReport[] => {
  const currentYear = new Date(now).getFullYear()
  const visits = reportVisits(footprints)
  const fulfilled = reportFulfilled(footprints)
  const groups = new Map<number, Footprint[]>()
  visits.forEach((item) => {
    const year = new Date(visitTime(item)).getFullYear()
    groups.set(year, [...(groups.get(year) || []), item])
  })
  const ascending = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, yearVisits]) => {
      const topCity = topCityOf(yearVisits)
      const fulfilledCount = fulfilled.filter((item) => new Date(fulfilledTime(item)).getFullYear() === year).length
      return {
        year,
        label: year === currentYear ? `${year} 年至今` : `${year} 年`,
        title: year === currentYear ? `${year} 年至今回顾` : `${year} 年度回顾`,
        summary: `这一年留下 ${yearVisits.length} 段足迹${topCity ? `，在 ${topCity} 记录得最多` : ''}${fulfilledCount ? `，实现 ${fulfilledCount} 个想去` : ''}。`,
        visitCount: yearVisits.length,
        cityCount: new Set(yearVisits.map((item) => item.city).filter(Boolean)).size,
        photoCount: yearVisits.reduce((total, item) => total + (item.photoCount ?? item.photos.length), 0),
        fulfilledCount,
      }
    })
  return ascending.map((report, index) => {
    const previous = ascending[index - 1]
    if (!previous || previous.year !== report.year - 1) return report
    const delta = report.visitCount - previous.visitCount
    const comparisonText = delta === 0
      ? `与 ${previous.year} 年记录数量相同`
      : delta > 0
        ? `比 ${previous.year} 年多记录 ${delta} 段足迹`
        : `比 ${previous.year} 年少记录 ${Math.abs(delta)} 段足迹`
    return { ...report, comparisonText }
  }).reverse()
}

export const computeGrowthOverview = (
  footprints: Footprint[],
  profile?: UserProfile | null,
  now?: number,
): GrowthOverview => {
  const memoizable = now === undefined
  const effectiveNow = now ?? Date.now()
  const day = Math.floor(effectiveNow / DAY)
  if (memoizable) {
    const cached = overviewMemo.get(footprints)
    if (cached && cached.day === day && cached.profile === profile) return cached.result
  }

  const visits = footprints.filter((item) => item.status === 'visited' && item.recordLevel !== 'city')
  const fulfilled = footprints.filter((item) => item.status === 'fulfilled')
  const recentStart = effectiveNow - 7 * DAY
  const recent = visits.filter((item) => {
    const time = visitTime(item)
    return time >= recentStart && time <= effectiveNow
  })
  const older = visits.filter((item) => visitTime(item) < recentStart)
  const fulfilledCount = fulfilled.length
    + visits.filter((item) => item.convertedFromWishlist && !item.wishId).length
  const recentFulfilled = fulfilled.some(
    (item) => (item.fulfilledAt || item.updatedAt || item.createdAt) >= recentStart,
  )
  const activeWeeks = longestWeeklyStreak(visits)
  const recentActiveWeeks = new Set(
    visits
      .filter((item) => visitTime(item) >= effectiveNow - 21 * DAY)
      .map((item) => weekKeyOf(visitTime(item))),
  ).size
  const uniqueCities = new Set(visits.map((item) => item.city).filter(Boolean))
  const uniqueCategories = new Set(visits.map((item) => item.category).filter(Boolean))
  const weeklyColorId = selectState({
    visitCount: recent.length,
    hasNew: hasNewDimension(recent, older),
    hasFulfilled: recentFulfilled,
    activeWeeks: recentActiveWeeks,
  })
  const unlockedColorIds = new Set<GrowthColorId>(['journey'])
  if (visits.length >= 3) unlockedColorIds.add('explore')
  if (uniqueCities.size >= 2 || uniqueCategories.size >= 2) unlockedColorIds.add('discover')
  if (fulfilledCount > 0 || visits.length >= 10) unlockedColorIds.add('highlight')
  if (activeWeeks >= 3) unlockedColorIds.add('companion')
  if (longestPlaceGap(visits) >= 180) unlockedColorIds.add('dawn')
  const isPlus = isGrowthPlusActive(profile?.growth, effectiveNow)
  const isPro = isGrowthProActive(profile?.growth, effectiveNow)
  const lockedColor = profile?.growth?.lockedColorId
  const fixedColorId = lockedColor && unlockedColorIds.has(lockedColor) ? lockedColor : undefined
  const colorMode = fixedColorId ? 'fixed' : 'auto'
  const activeColorId = fixedColorId || weeklyColorId
  const plusDaysLeft = isPlus
    ? Math.max(1, Math.ceil(((profile?.growth?.plusUntil || effectiveNow) - effectiveNow) / DAY))
    : 0
  const proDaysLeft = isPro
    ? Math.max(1, Math.ceil(((profile?.growth?.proUntil || effectiveNow) - effectiveNow) / DAY))
    : 0
  const nextGoal = recent.length < 3
    ? { text: `再记录 ${3 - recent.length} 个地方，点亮探索橙`, progress: recent.length, target: 3 }
    : uniqueCities.size < 2
      ? { text: '再走进 1 座新城市，点亮发现青蓝', progress: uniqueCities.size, target: 2 }
      : activeWeeks < 3
        ? { text: `再坚持 ${3 - activeWeeks} 周，点亮陪伴粉`, progress: activeWeeks, target: 3 }
        : { text: '去实现一个想去，让 Lumi 迎来高光', progress: fulfilledCount > 0 ? 1 : 0, target: 1 }
  const weeklyColor = COLORS.find((item) => item.id === weeklyColorId) || COLORS[0]
  const activeColor = COLORS.find((item) => item.id === activeColorId) || COLORS[0]
  const result: GrowthOverview = {
    weeklyColorId,
    activeColorId,
    colorMode,
    displayTitle: `${colorMode === 'fixed' ? '固定展示' : '自动调整'} · ${activeColor.name}`,
    weeklyTitle: `本周状态 · ${weeklyColor.name}`,
    weeklyMessage: weeklyColorId === 'journey'
      ? 'Lumi 正在等你一起出发。'
      : weeklyColorId === 'highlight'
        ? '这一周，你把一个想去变成了去过。'
        : weeklyColorId === 'discover'
          ? '这一周，你走进了新的地方。'
          : weeklyColorId === 'explore'
            ? '这一周，你一直在往新的地方走。'
            : '稳定的记录，让生活慢慢有了形状。',
    nextGoalText: nextGoal.text,
    nextGoalProgress: nextGoal.progress,
    nextGoalTarget: nextGoal.target,
    isPlus,
    plusDaysLeft,
    isPro,
    proDaysLeft,
  }
  if (memoizable) overviewMemo.set(footprints, { profile, day, result })
  return result
}

export const computeGrowthSnapshot = (
  footprints: Footprint[],
  profile?: UserProfile | null,
  now?: number,
  options: { skipDistance?: boolean } = {},
): GrowthSnapshot => {
  // 显式传入 now 的调用（测试、回溯视图）不走记忆化
  const memoizable = now === undefined
  const effectiveNow = now ?? Date.now()
  const day = Math.floor(effectiveNow / DAY)
  if (memoizable) {
    const cached = snapshotMemo.get(footprints)
    if (cached && cached.day === day && cached.profile === profile) return cached.result
  }
  const visits = footprints
    .filter((item) => item.status === 'visited' && item.recordLevel !== 'city')
    .sort((a, b) => visitTime(a) - visitTime(b))
  const wishes = footprints.filter((item) => item.status === 'wishlist')
  const fulfilled = footprints.filter((item) => item.status === 'fulfilled')
  const legacyFulfilled = visits.filter((item) => item.convertedFromWishlist && !item.wishId)
  const fulfilledCount = fulfilled.length + legacyFulfilled.length
  const recentStart = effectiveNow - 7 * DAY
  const currentMonth = monthKeyOf(effectiveNow)
  const recent = visits.filter((item) => visitTime(item) >= recentStart && visitTime(item) <= effectiveNow)
  const older = visits.filter((item) => visitTime(item) < recentStart)
  const monthVisits = visits.filter((item) => monthKeyOf(visitTime(item)) === currentMonth)
  const beforeMonth = visits.filter((item) => monthKeyOf(visitTime(item)) < currentMonth)
  const fulfilledTimes = fulfilled.map((item) => item.fulfilledAt || item.updatedAt || item.createdAt)
  const recentFulfilled = fulfilledTimes.some((time) => time >= recentStart)
  const monthFulfilled = fulfilledTimes.some((time) => monthKeyOf(time) === currentMonth)
  const activeWeeks = longestWeeklyStreak(visits)
  const recentActiveWeeks = new Set(
    visits.filter((item) => visitTime(item) >= effectiveNow - 21 * DAY).map((item) => weekKeyOf(visitTime(item))),
  ).size

  const weeklyColorId = selectState({
    visitCount: recent.length,
    hasNew: hasNewDimension(recent, older),
    hasFulfilled: recentFulfilled,
    activeWeeks: recentActiveWeeks,
  })
  const monthlyColorId = selectState({
    visitCount: monthVisits.length,
    hasNew: hasNewDimension(monthVisits, beforeMonth),
    hasFulfilled: monthFulfilled,
    activeWeeks: new Set(monthVisits.map((item) => weekKeyOf(visitTime(item)))).size,
  })

  const uniqueCities = new Set(visits.map((item) => item.city).filter(Boolean))
  const uniqueCategories = new Set(visits.map((item) => item.category).filter(Boolean))
  const placeVisitPeak = maxPlaceVisits(visits)
  const dawnUnlocked = longestPlaceGap(visits) >= 180
  const monthViewed = profile?.growth?.viewedMonthlyReports?.includes(currentMonth) || false
  const isPlus = isGrowthPlusActive(profile?.growth, effectiveNow)
  const isPro = isGrowthProActive(profile?.growth, effectiveNow)
  const lockedColor = profile?.growth?.lockedColorId
  const plusDaysLeft = isPlus
    ? Math.max(1, Math.ceil(((profile?.growth?.plusUntil || effectiveNow) - effectiveNow) / DAY))
    : 0
  const proDaysLeft = isPro
    ? Math.max(1, Math.ceil(((profile?.growth?.proUntil || effectiveNow) - effectiveNow) / DAY))
    : 0

  const unlockedColorIds = new Set<GrowthColorId>(['journey'])
  if (visits.length >= 3) unlockedColorIds.add('explore')
  if (uniqueCities.size >= 2 || uniqueCategories.size >= 2) unlockedColorIds.add('discover')
  if (fulfilledCount > 0 || visits.length >= 10) unlockedColorIds.add('highlight')
  if (activeWeeks >= 3) unlockedColorIds.add('companion')
  if (dawnUnlocked) unlockedColorIds.add('dawn')
  const fixedColorId = lockedColor && unlockedColorIds.has(lockedColor) ? lockedColor : undefined
  const colorMode = fixedColorId ? 'fixed' : 'auto'
  const activeColorId = fixedColorId || weeklyColorId

  const colors = COLORS.map((color) => ({ ...color, unlocked: unlockedColorIds.has(color.id) }))
  const expressions: GrowthExpressionView[] = [
    { id: 'default', name: '默认', description: '陪在你身边', unlocked: true, mascotState: 'journey' },
    { id: 'happy', name: '开心', description: '留下第一段回忆', unlocked: visits.length >= 1, mascotState: 'journey' },
    { id: 'thinking', name: '思考', description: '添加一个想去', unlocked: wishes.length >= 1, mascotState: 'discover' },
    { id: 'depart', name: '出发', description: '记录 3 个地点', unlocked: visits.length >= 3, mascotState: 'explore' },
    { id: 'explore', name: '探索', description: '走进 2 座城市', unlocked: uniqueCities.size >= 2, mascotState: 'discover' },
    { id: 'record', name: '记录', description: '保存一张照片', unlocked: visits.some((item) => (item.photoCount ?? item.photos.length) > 0), mascotState: 'highlight' },
    { id: 'companion', name: '陪伴', description: '连续 3 周记录', unlocked: activeWeeks >= 3, mascotState: 'companion' },
    { id: 'reunion', name: '又见面', description: '第五次回到同一地点', unlocked: placeVisitPeak >= 5, mascotState: 'dawn' },
  ]

  let maxDistance = 0
  if (!options.skipDistance) {
    distanceScan: for (let i = 0; i < visits.length; i += 1) {
      for (let j = i + 1; j < visits.length; j += 1) {
        maxDistance = Math.max(maxDistance, distanceKm(visits[i], visits[j]))
        // 成就只关心是否达到 1000km；达到后不再扫描剩余组合。
        if (maxDistance >= 1000) break distanceScan
      }
    }
  }
  const cityCounts = new Map<string, number>()
  visits.forEach((item) => {
    if (item.city) cityCounts.set(item.city, (cityCounts.get(item.city) || 0) + 1)
  })
  const months = new Set(visits.map((item) => new Date(visitTime(item)).getMonth()))
  const seasons = [
    [2, 3, 4],
    [5, 6, 7],
    [8, 9, 10],
    [11, 0, 1],
  ].every((season) => season.some((month) => months.has(month)))
  const firstRecordAt = visits[0] ? visitTime(visits[0]) : profile?.createdAt || effectiveNow
  const hiddenStates: GrowthHiddenStateView[] = [
    { id: 'dawn', name: '晨曦', hint: '当过去和现在再次相遇时，也许会出现。', unlocked: dawnUnlocked, mascotState: 'dawn', expression: 'happy' },
    { id: 'seasons', name: '四季', hint: '让春夏秋冬都留下一段记录。', unlocked: seasons, mascotState: 'companion', expression: 'companion' },
    { id: 'distance', name: '远方', hint: '让足迹跨越一段很远的距离。', unlocked: maxDistance >= 1000, mascotState: 'journey', expression: 'depart' },
    { id: 'hometown', name: '故乡', hint: '在同一座城市留下 30 段生活。', unlocked: Math.max(0, ...cityCounts.values()) >= 30, mascotState: 'highlight', expression: 'collect' },
    { id: 'reunion', name: '重逢', hint: '多次回到一个熟悉的地方。', unlocked: placeVisitPeak >= 5, mascotState: 'explore', expression: 'reunion' },
    { id: 'annual', name: '年轮', hint: '让 Lumi 陪你走过完整的一年。', unlocked: effectiveNow - firstRecordAt >= 365 * DAY, mascotState: 'discover', expression: 'thinking' },
  ]

  const shards = visits.length
    + uniqueCities.size * 3
    + fulfilledCount * 3
    + (activeWeeks >= 3 ? 5 : 0)
    + (monthViewed ? 5 : 0)

  const nextGoal = recent.length < 3
    ? { text: `再记录 ${3 - recent.length} 个地方，点亮探索橙`, progress: recent.length, target: 3 }
    : uniqueCities.size < 2
      ? { text: '再走进 1 座新城市，点亮发现青蓝', progress: uniqueCities.size, target: 2 }
      : activeWeeks < 3
        ? { text: `再坚持 ${3 - activeWeeks} 周，点亮陪伴粉`, progress: activeWeeks, target: 3 }
        : { text: '去实现一个想去，让 Lumi 迎来高光', progress: fulfilledCount > 0 ? 1 : 0, target: 1 }

  const weeklyColor = COLORS.find((item) => item.id === weeklyColorId) || COLORS[0]
  const activeColor = COLORS.find((item) => item.id === activeColorId) || COLORS[0]
  const monthNumber = Number(currentMonth.slice(5, 7))
  const monthCityCounts = new Map<string, number>()
  monthVisits.forEach((item) => {
    if (item.city) monthCityCounts.set(item.city, (monthCityCounts.get(item.city) || 0) + 1)
  })
  const topCity = [...monthCityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const monthlySummary = monthVisits.length
    ? `新增 ${monthVisits.length} 段足迹${topCity ? `，最常走进 ${topCity}` : ''}。`
    : '这个月还没有新足迹，从一次出发开始吧。'

  const snapshot: GrowthSnapshot = {
    weeklyColorId,
    activeColorId,
    colorMode,
    displayTitle: `${colorMode === 'fixed' ? '固定展示' : '自动调整'} · ${activeColor.name}`,
    weeklyTitle: `本周状态 · ${weeklyColor.name}`,
    weeklyMessage: weeklyColorId === 'journey'
      ? 'Lumi 正在等你一起出发。'
      : weeklyColorId === 'highlight'
        ? '这一周，你把一个想去变成了去过。'
        : weeklyColorId === 'discover'
          ? '这一周，你走进了新的地方。'
          : weeklyColorId === 'explore'
            ? '这一周，你一直在往新的地方走。'
            : '稳定的记录，让生活慢慢有了形状。',
    monthlyColorId,
    monthlyTitle: `${monthNumber} 月回顾`,
    monthKey: currentMonth,
    monthLabel: `${monthNumber} 月`,
    monthlySummary,
    shards,
    nextGoalText: nextGoal.text,
    nextGoalProgress: nextGoal.progress,
    nextGoalTarget: nextGoal.target,
    isPlus,
    plusDaysLeft,
    isPro,
    proDaysLeft,
    colors,
    expressions,
    hiddenStates,
    recentVisitCount: recent.length,
    monthVisitCount: monthVisits.length,
    monthCityCount: new Set(monthVisits.map((item) => item.city).filter(Boolean)).size,
    fulfilledCount,
  }
  if (memoizable && !options.skipDistance) snapshotMemo.set(footprints, { profile, day, result: snapshot })
  return snapshot
}

/** 在成长详情页分帧检查远方成就，避免一次长循环阻塞点击。 */
export const hasDistantPairDeferred = (
  footprints: Footprint[],
  thresholdKm = 1000,
  budgetMs = 8,
): Promise<boolean> => {
  const visits = footprints.filter((item) =>
    item.status === 'visited' && typeof item.lat === 'number' && typeof item.lng === 'number')
  let left = 0
  let right = 1
  return new Promise((resolve) => {
    const scan = () => {
      const startedAt = Date.now()
      while (left < visits.length - 1) {
        while (right < visits.length) {
          if (distanceKm(visits[left], visits[right]) >= thresholdKm) {
            resolve(true)
            return
          }
          right += 1
          if (Date.now() - startedAt >= budgetMs) {
            setTimeout(scan, 0)
            return
          }
        }
        left += 1
        right = left + 1
      }
      resolve(false)
    }
    scan()
  })
}
