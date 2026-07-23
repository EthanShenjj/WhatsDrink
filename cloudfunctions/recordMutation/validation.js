const categories = new Set(['coffee', 'milk_tea'])
const calorieSources = new Set(['official', 'estimated', 'user'])

const text = (value, max = 80) => String(value || '').trim().slice(0, max)
const optionalNumber = (value, min, max) => {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number < min || number > max) throw new Error('数值字段不合法')
  return number
}

const sanitizeRecord = (input, openid, existingCreatedAt, now = Date.now()) => {
  if (!openid) throw new Error('登录状态无效')
  if (!input || !categories.has(input.category)) throw new Error('饮品分类不合法')
  const drinkName = text(input.drinkName, 40)
  if (!drinkName) throw new Error('饮品名称不能为空')
  const consumedAt = Number(input.consumedAt)
  if (!Number.isFinite(consumedAt)) throw new Error('记录时间不合法')
  return {
    _openid: openid,
    category: input.category,
    brandId: text(input.brandId, 50) || undefined,
    brandName: text(input.brandName, 40),
    drinkId: text(input.drinkId, 50) || undefined,
    drinkName,
    size: text(input.size, 20),
    temperature: text(input.temperature, 20),
    sweetness: text(input.sweetness, 20),
    calorieKcal: optionalNumber(input.calorieKcal, 0, 5000),
    calorieSource: calorieSources.has(input.calorieSource) ? input.calorieSource : 'user',
    priceYuan: optionalNumber(input.priceYuan, 0, 10000),
    rating: optionalNumber(input.rating, 1, 5),
    note: text(input.note, 200),
    photoPath: text(input.photoPath, 500) || undefined,
    consumedAt,
    clientRequestId: text(input.clientRequestId, 100),
    createdAt: existingCreatedAt || now,
    updatedAt: now,
  }
}

module.exports = {
  sanitizeRecord,
  text,
}
