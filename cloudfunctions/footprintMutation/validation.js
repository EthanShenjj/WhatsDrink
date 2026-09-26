const STATUSES = new Set(['visited', 'wishlist', 'fulfilled'])
const SOURCES = new Set(['manual', 'ai', 'import'])

const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const optionalText = (value, max = 80) => {
  const trimmed = text(value, max)
  return trimmed || undefined
}

const optionalNumber = (value, min, max) => {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('数值字段不合法')
  return number
}

const pad2 = (value) => String(value).padStart(2, '0')

const todayKey = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const optionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName}格式不合法`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`${fieldName}不合法`)
  }
  return value
}

const sanitizeStringArray = (value, max = 30, itemMax = 500) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('数组字段不合法')
  if (value.length > max) throw new Error(`数组字段最多允许 ${max} 项`)
  const seen = new Set()
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('数组字段仅允许字符串')
    const trimmed = text(item, itemMax)
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

const isOwnedCloudFile = (fileId, openid) =>
  typeof fileId === 'string' &&
  fileId.startsWith('cloud://') &&
  fileId.includes(`/${openid}/`)

const sanitizePhotos = (value, openid) => {
  const photos = sanitizeStringArray(value, 9, 500)
  if (photos.some((photo) => !isOwnedCloudFile(photo, openid))) {
    throw new Error('照片必须来自当前用户的云存储目录')
  }
  return photos
}

const sanitizeMarkerStyle = (value) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('标记样式不合法')
  const color = optionalText(value.color, 20)
  const emoji = optionalText(value.emoji, 10)
  const label = optionalText(value.label, 20)
  if (!color && !emoji && !label) return undefined
  const style = {}
  if (color) style.color = color
  if (emoji) style.emoji = emoji
  if (label) style.label = label
  return style
}

const enumValue = (value, allowed, fallback, fieldName) => {
  if (value === undefined || value === null || value === '') return fallback
  if (!allowed.has(value)) throw new Error(`${fieldName}不合法`)
  return value
}

const sanitizeFootprint = (input, openid, existing, now = Date.now()) => {
  if (!openid) throw new Error('登录状态无效')
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('足迹内容不能为空')
  }
  const poiName = text(input.poiName, 60)
  if (!poiName) throw new Error('地点名称不能为空')

  const status = enumValue(input.status, STATUSES, existing ? existing.status : 'visited', '足迹状态')
  const lat = optionalNumber(input.lat, -90, 90)
  const lng = optionalNumber(input.lng, -180, 180)
  if ((lat === undefined) !== (lng === undefined)) throw new Error('纬度和经度必须同时提供')
  // A manually entered place can be saved without location permission.
  // It remains in the calendar and lists, and can be pinned after choosing a POI.

  const visitDate = optionalDate(input.visitDate, '访问日期') ||
    (status === 'visited' ? todayKey(new Date(now)) : undefined)
  const createdAt = existing && Number.isFinite(existing.createdAt) ? existing.createdAt : now
  let wishlistCreatedAt
  let convertedFromWishlist
  if (status === 'wishlist' || status === 'fulfilled') {
    wishlistCreatedAt = existing && (existing.status === 'wishlist' || existing.status === 'fulfilled')
      ? existing.wishlistCreatedAt || existing.createdAt
      : now
  } else if (existing && (existing.status === 'wishlist' || (existing.convertedFromWishlist && input.convertedFromWishlist !== false))) {
    wishlistCreatedAt = existing.wishlistCreatedAt || existing.createdAt
    convertedFromWishlist = true
  } else if (status === 'visited' && input.wishId) {
    wishlistCreatedAt = optionalNumber(input.wishlistCreatedAt, 0, 9e15)
    convertedFromWishlist = true
  }

  const fulfilledAt = status === 'fulfilled'
    ? optionalNumber(input.fulfilledAt, 0, 9e15)
    : undefined
  const fulfilledVisitId = status === 'fulfilled'
    ? optionalText(input.fulfilledVisitId, 100)
    : undefined
  if (status === 'fulfilled' && (!fulfilledAt || !fulfilledVisitId)) {
    throw new Error('已实现愿望必须关联到访记录')
  }

  return {
    _openid: openid,
    status,
    poiName,
    address: optionalText(input.address, 200),
    lat,
    lng,
    country: optionalText(input.country, 40),
    province: optionalText(input.province, 40),
    city: optionalText(input.city, 40),
    district: optionalText(input.district, 40),
    visitDate,
    photos: sanitizePhotos(input.photos, openid),
    mood: optionalText(input.mood, 30),
    category: optionalText(input.category, 30),
    tags: sanitizeStringArray(input.tags, 20, 30),
    note: optionalText(input.note, 1000),
    markerStyle: sanitizeMarkerStyle(input.markerStyle),
    source: enumValue(input.source, SOURCES, 'manual', '来源'),
    placeId: optionalText(input.placeId, 160),
    wishId: status === 'visited' ? optionalText(input.wishId, 100) : undefined,
    isImportant: status === 'visited' && input.isImportant === true,
    wishlistCreatedAt,
    fulfilledAt,
    fulfilledVisitId,
    convertedFromWishlist,
    clientRequestId: text(input.clientRequestId || (existing && existing.clientRequestId), 100),
    createdAt,
    updatedAt: now,
  }
}

module.exports = {
  isOwnedCloudFile,
  optionalDate,
  sanitizeFootprint,
  sanitizePhotos,
  text,
  todayKey,
}
