import type { Brand, DrinkRecordDraft, WheelItem } from '../domain/types'

export const MIN_WHEEL_ITEMS = 2
export const MAX_WHEEL_ITEMS = 20

export const getCanvasSetupStatus = (
  hasNode: boolean,
  width: number,
  attempt: number,
  maxAttempts = 4,
): 'ready' | 'retry' | 'failed' => {
  if (hasNode && width > 0) return 'ready'
  return attempt < maxAttempts ? 'retry' : 'failed'
}

export const getWheelLabelRotation = (
  middleAngle: number,
  wheelRotation: number,
  spinning: boolean,
): number => (spinning ? Math.PI / 2 : -(middleAngle + wheelRotation))

export const brandToWheelItem = (brand: Brand, id: string): WheelItem => ({
  id,
  label: brand.name,
  brandId: brand.id,
  brandName: brand.name,
  category: brand.category,
})

export const normalizeWheelItemsToBrands = (items: WheelItem[]): WheelItem[] => {
  const seenBrands = new Set<string>()

  return items.flatMap((item) => {
    const brandName = item.brandName?.trim()
    if (!brandName) return [{ ...item, label: item.label.trim() }]

    const brandKey = brandName.toLocaleLowerCase()
    if (seenBrands.has(brandKey)) return []
    seenBrands.add(brandKey)

    return [
      {
        id: item.id,
        label: brandName,
        brandId: item.brandId,
        brandName,
        category: item.category,
      },
    ]
  })
}

export const validateWheelItems = (items: WheelItem[]): string | null => {
  if (items.length < MIN_WHEEL_ITEMS) return '至少添加 2 个候选项'
  if (items.length > MAX_WHEEL_ITEMS) return '最多添加 20 个候选项'
  if (items.some((item) => !item.label.trim())) return '候选项不能为空'
  return null
}

export const chooseWheelItem = (items: WheelItem[], random = Math.random): WheelItem => {
  const error = validateWheelItems(items)
  if (error) throw new Error(error)
  const safeRandom = Math.min(Math.max(random(), 0), 0.999999999)
  return items[Math.floor(safeRandom * items.length)]
}

export const wheelItemToDraft = (item: WheelItem, now = Date.now()): DrinkRecordDraft => ({
  category: item.category ?? 'coffee',
  brandId: item.brandId,
  brandName: item.brandName ?? '',
  drinkId: item.drinkId,
  drinkName: item.drinkName ?? (item.brandName ? '' : item.label),
  size: '中杯',
  temperature: '冰',
  sweetness: '标准糖',
  calorieKcal: item.calorieKcal,
  calorieSource: typeof item.calorieKcal === 'number' ? 'estimated' : 'user',
  note: '',
  consumedAt: now,
})
