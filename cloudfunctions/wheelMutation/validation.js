const text = (value, max = 80) => String(value || '').trim().slice(0, max)

const sanitizeWheelItems = (items) => {
  if (!Array.isArray(items) || items.length < 2 || items.length > 20) {
    throw new Error('转盘候选项必须为 2–20 个')
  }
  return items.map((item, index) => {
    const label = text(item.label, 40)
    if (!label) throw new Error(`第 ${index + 1} 个候选项不能为空`)
    const calories =
      item.calorieKcal === undefined || item.calorieKcal === null
        ? undefined
        : Number(item.calorieKcal)
    return {
      id: text(item.id, 100) || `item_${index}`,
      label,
      brandId: text(item.brandId, 80) || undefined,
      drinkId: text(item.drinkId, 80) || undefined,
      brandName: text(item.brandName, 40) || undefined,
      drinkName: text(item.drinkName, 40) || undefined,
      category:
        item.category === 'milk_tea' ? 'milk_tea' : item.category === 'coffee' ? 'coffee' : undefined,
      calorieKcal:
        Number.isFinite(calories) && calories >= 0 && calories <= 5000 ? calories : undefined,
    }
  })
}

module.exports = {
  sanitizeWheelItems,
  text,
}
