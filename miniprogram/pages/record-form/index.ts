import { BRANDS, DRINKS, drinksForBrand } from '../../data/catalog'
import type { Brand, Drink, DrinkCategory, DrinkRecordDraft } from '../../domain/types'
import { STORAGE_KEYS } from '../../services/config'
import {
  deleteRecord,
  getRecord,
  hasRecordAccess,
  loginForRecordAccess,
  saveRecord,
  uploadRecordPhoto,
} from '../../services/repository'
import { dateKey, timeText, timestampFromDateAndTime } from '../../utils/date'

const CATEGORY_VALUES: DrinkCategory[] = ['coffee', 'milk_tea']
const CATEGORY_LABELS = ['咖啡', '奶茶']
const SIZE_OPTIONS = ['小杯', '中杯', '大杯', '超大杯', '其他']
const TEMPERATURE_OPTIONS = ['冰', '少冰', '去冰', '常温', '热']
const SWEETNESS_OPTIONS = ['无糖', '三分糖', '五分糖', '七分糖', '标准糖', '其他']
const RATING_OPTIONS = ['未评分', '1 分', '2 分', '3 分', '4 分', '5 分']

const confirmRecordLogin = (): Promise<boolean> =>
  new Promise((resolve) => {
    wx.showModal({
      title: '登录后记一杯',
      content: '登录后可以保存饮品记录，并在日历和统计中查看。',
      confirmText: '微信登录',
      cancelText: '暂不登录',
      confirmColor: '#B94E35',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })

const optionIndex = (options: string[], value: string, fallback = 0): number => {
  const index = options.indexOf(value)
  return index >= 0 ? index : fallback
}

Page({
  data: {
    editingId: '',
    categoryLabels: CATEGORY_LABELS,
    categoryIndex: 0,
    brandOptions: [] as Brand[],
    brandLabels: [] as string[],
    brandIndex: 0,
    customBrand: '',
    drinkOptions: [] as Drink[],
    drinkLabels: [] as string[],
    drinkIndex: 0,
    customDrink: '',
    sizeOptions: SIZE_OPTIONS,
    sizeIndex: 1,
    temperatureOptions: TEMPERATURE_OPTIONS,
    temperatureIndex: 0,
    sweetnessOptions: SWEETNESS_OPTIONS,
    sweetnessIndex: 4,
    ratingOptions: RATING_OPTIONS,
    ratingIndex: 0,
    calorieText: '',
    calorieSource: 'user' as 'official' | 'estimated' | 'user',
    priceText: '',
    note: '',
    dateValue: dateKey(new Date()),
    timeValue: timeText(Date.now()),
    photoPath: '',
    pendingPhotoPath: '',
    authenticating: true,
    saving: false,
    drinkNameError: '',
    calorieError: '',
    priceError: '',
  },
  async onLoad(query: Record<string, string>) {
    if (!hasRecordAccess() && !(await confirmRecordLogin())) {
      wx.navigateBack()
      return
    }
    try {
      await loginForRecordAccess()
      this.setData({ authenticating: false })
    } catch {
      wx.showToast({ title: '登录失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.rebuildBrands('coffee')
    if (query.id) {
      const record = await getRecord(query.id)
      if (record) {
        this.populate({
          ...record,
          id: record.id,
        })
        wx.setNavigationBarTitle({ title: '编辑记录' })
        return
      }
    }
    if (query.from === 'choice') {
      const choiceDraft = wx.getStorageSync<DrinkRecordDraft | null>(STORAGE_KEYS.recordDraft)
      if (choiceDraft) {
        this.populate(choiceDraft)
        return
      }
    }
    const cached = wx.getStorageSync<DrinkRecordDraft | null>(STORAGE_KEYS.recordDraft)
    if (cached) {
      this.populate(cached)
      return
    }
    if (query.date) this.setData({ dateValue: query.date })
  },
  rebuildBrands(category: DrinkCategory, brandId?: string) {
    const brandOptions = BRANDS.filter((brand) => brand.category === category)
    const index = brandId ? brandOptions.findIndex((brand) => brand.id === brandId) : 0
    this.setData({
      brandOptions,
      brandLabels: [...brandOptions.map((brand) => brand.name), '自定义品牌'],
      brandIndex: index >= 0 ? index : brandOptions.length,
    })
    const brand = index >= 0 ? brandOptions[index] : brandOptions[0]
    this.rebuildDrinks(brand?.id || '', undefined)
  },
  rebuildDrinks(brandId: string, drinkId?: string) {
    const drinkOptions = brandId ? drinksForBrand(brandId) : []
    const index = drinkId ? drinkOptions.findIndex((drink) => drink.id === drinkId) : 0
    this.setData({
      drinkOptions,
      drinkLabels: [...drinkOptions.map((drink) => drink.name), '自定义饮品'],
      drinkIndex: index >= 0 ? index : drinkOptions.length,
    })
  },
  populate(draft: DrinkRecordDraft) {
    const categoryIndex = Math.max(CATEGORY_VALUES.indexOf(draft.category), 0)
    const category = CATEGORY_VALUES[categoryIndex]
    const brandOptions = BRANDS.filter((brand) => brand.category === category)
    const matchedBrand = brandOptions.find(
      (brand) => brand.id === draft.brandId || brand.name === draft.brandName,
    )
    const brandIndex = matchedBrand ? brandOptions.indexOf(matchedBrand) : brandOptions.length
    const drinkOptions = matchedBrand ? drinksForBrand(matchedBrand.id) : []
    const matchedDrink = drinkOptions.find(
      (drink) => drink.id === draft.drinkId || drink.name === draft.drinkName,
    )
    const drinkIndex = matchedDrink ? drinkOptions.indexOf(matchedDrink) : drinkOptions.length
    this.setData({
      editingId: draft.id || '',
      categoryIndex,
      brandOptions,
      brandLabels: [...brandOptions.map((brand) => brand.name), '自定义品牌'],
      brandIndex,
      customBrand: matchedBrand ? '' : draft.brandName,
      drinkOptions,
      drinkLabels: [...drinkOptions.map((drink) => drink.name), '自定义饮品'],
      drinkIndex,
      customDrink: matchedDrink ? '' : draft.drinkName,
      sizeIndex: optionIndex(SIZE_OPTIONS, draft.size, 1),
      temperatureIndex: optionIndex(TEMPERATURE_OPTIONS, draft.temperature),
      sweetnessIndex: optionIndex(SWEETNESS_OPTIONS, draft.sweetness, 4),
      ratingIndex: draft.rating || 0,
      calorieText:
        typeof draft.calorieKcal === 'number' ? String(draft.calorieKcal) : '',
      calorieSource: draft.calorieSource,
      priceText: typeof draft.priceYuan === 'number' ? String(draft.priceYuan) : '',
      note: draft.note,
      dateValue: dateKey(draft.consumedAt),
      timeValue: timeText(draft.consumedAt),
      photoPath: draft.photoPath || '',
    })
  },
  changeCategory(event: WechatMiniprogram.PickerChange) {
    const categoryIndex = Number(event.detail.value)
    const category = CATEGORY_VALUES[categoryIndex]
    this.setData({
      categoryIndex,
      customBrand: '',
      customDrink: '',
      calorieText: '',
      drinkNameError: '',
      calorieError: '',
    })
    this.rebuildBrands(category)
    this.persistDraft()
  },
  changeBrand(event: WechatMiniprogram.PickerChange) {
    const brandIndex = Number(event.detail.value)
    const brand = this.data.brandOptions[brandIndex]
    this.setData({
      brandIndex,
      customBrand: '',
      customDrink: '',
      calorieText: '',
      drinkNameError: '',
      calorieError: '',
    })
    this.rebuildDrinks(brand?.id || '')
    this.persistDraft()
  },
  changeDrink(event: WechatMiniprogram.PickerChange) {
    const drinkIndex = Number(event.detail.value)
    const drink = this.data.drinkOptions[drinkIndex]
    this.setData({
      drinkIndex,
      customDrink: '',
      calorieText:
        typeof drink?.calorieKcal === 'number' ? String(drink.calorieKcal) : '',
      calorieSource: drink?.calorieSource || 'user',
      sizeIndex: drink ? optionIndex(SIZE_OPTIONS, drink.defaultSize, 1) : this.data.sizeIndex,
      drinkNameError: '',
      calorieError: '',
    })
    this.persistDraft()
  },
  updateCustomBrand(event: WechatMiniprogram.Input) {
    this.setData({ customBrand: event.detail.value })
    this.persistDraft()
  },
  updateCustomDrink(event: WechatMiniprogram.Input) {
    this.setData({ customDrink: event.detail.value, drinkNameError: '' })
    this.persistDraft()
  },
  changeSize(event: WechatMiniprogram.PickerChange) {
    this.setData({ sizeIndex: Number(event.detail.value) })
    this.persistDraft()
  },
  changeTemperature(event: WechatMiniprogram.PickerChange) {
    this.setData({ temperatureIndex: Number(event.detail.value) })
    this.persistDraft()
  },
  changeSweetness(event: WechatMiniprogram.PickerChange) {
    this.setData({ sweetnessIndex: Number(event.detail.value) })
    this.persistDraft()
  },
  changeRating(event: WechatMiniprogram.PickerChange) {
    this.setData({ ratingIndex: Number(event.detail.value) })
    this.persistDraft()
  },
  changeDate(event: WechatMiniprogram.PickerChange) {
    this.setData({ dateValue: String(event.detail.value) })
    this.persistDraft()
  },
  changeTime(event: WechatMiniprogram.PickerChange) {
    this.setData({ timeValue: String(event.detail.value) })
    this.persistDraft()
  },
  updateCalories(event: WechatMiniprogram.Input) {
    this.setData({
      calorieText: event.detail.value,
      calorieSource: 'user',
      calorieError: '',
    })
    this.persistDraft()
  },
  updatePrice(event: WechatMiniprogram.Input) {
    this.setData({ priceText: event.detail.value, priceError: '' })
    this.persistDraft()
  },
  updateNote(event: WechatMiniprogram.TextareaInput) {
    this.setData({ note: event.detail.value })
    this.persistDraft()
  },
  async choosePhoto() {
    try {
      const response = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      })
      this.setData({ pendingPhotoPath: response.tempFiles[0]?.tempFilePath || '' })
      this.persistDraft()
    } catch {
      // 用户取消不提示错误。
    }
  },
  removePhoto() {
    this.setData({ photoPath: '', pendingPhotoPath: '' })
    this.persistDraft()
  },
  currentDraft(): DrinkRecordDraft {
    const category = CATEGORY_VALUES[this.data.categoryIndex]
    const brand = this.data.brandOptions[this.data.brandIndex]
    const drink = this.data.drinkOptions[this.data.drinkIndex]
    const calorie = this.data.calorieText.trim()
    const price = this.data.priceText.trim()
    return {
      id: this.data.editingId || undefined,
      category,
      brandId: brand?.id,
      brandName: brand?.name || this.data.customBrand.trim(),
      drinkId: drink?.id,
      drinkName: drink?.name || this.data.customDrink.trim(),
      size: SIZE_OPTIONS[this.data.sizeIndex],
      temperature: TEMPERATURE_OPTIONS[this.data.temperatureIndex],
      sweetness: SWEETNESS_OPTIONS[this.data.sweetnessIndex],
      calorieKcal: calorie ? Number(calorie) : undefined,
      calorieSource: this.data.calorieSource,
      priceYuan: price ? Number(price) : undefined,
      rating: this.data.ratingIndex || undefined,
      note: this.data.note.trim(),
      photoPath: this.data.photoPath || undefined,
      consumedAt: timestampFromDateAndTime(this.data.dateValue, this.data.timeValue),
    }
  },
  persistDraft() {
    wx.nextTick(() => {
      try {
        wx.setStorageSync(STORAGE_KEYS.recordDraft, this.currentDraft())
      } catch {
        // 草稿缓存失败不打断表单编辑。
      }
    })
  },
  async submit() {
    if (this.data.authenticating || this.data.saving) return
    const draft = this.currentDraft()
    const drinkNameError = draft.drinkName ? '' : '请填写饮品名称'
    const calorieError =
      draft.calorieKcal !== undefined &&
      (!Number.isFinite(draft.calorieKcal) || draft.calorieKcal < 0)
        ? '请输入不小于 0 的数字'
        : ''
    const priceError =
      draft.priceYuan !== undefined &&
      (!Number.isFinite(draft.priceYuan) || draft.priceYuan < 0)
        ? '请输入不小于 0 的数字'
        : ''
    this.setData({ drinkNameError, calorieError, priceError })
    if (drinkNameError || calorieError || priceError) {
      wx.showToast({ title: '请检查标记字段', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      if (this.data.pendingPhotoPath) {
        draft.photoPath = await uploadRecordPhoto(this.data.pendingPhotoPath)
      }
      await saveRecord(draft)
      wx.removeStorageSync(STORAGE_KEYS.recordDraft)
      wx.showToast({ title: '记录好了', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch {
      this.persistDraft()
      wx.showToast({ title: '保存失败，草稿已保留', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
  removeCurrentRecord() {
    if (!this.data.editingId || this.data.saving) return
    wx.showModal({
      title: '删除这杯记录？',
      content: '删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#A54B3F',
      success: async (result) => {
        if (!result.confirm) return
        try {
          await deleteRecord(this.data.editingId)
          wx.removeStorageSync(STORAGE_KEYS.recordDraft)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(() => wx.navigateBack(), 300)
        } catch {
          wx.showToast({ title: '删除失败，请重试', icon: 'none' })
        }
      },
    })
  },
})
