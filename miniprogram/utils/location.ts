import { CHINA_REGIONS } from '../data/regions'
import type { FootprintDraft } from '../domain/types'

export const shortProvince = (value: string): string =>
  value.trim().replace(/(特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/, '')
export const shortCity = (value: string): string => value.trim().replace(/市$/, '')
const municipalities = ['北京', '上海', '天津', '重庆']
const provinces = CHINA_REGIONS[0].children || []

/** chooseLocation 没有行政区字段：只解析明确的地址信息，不用最近城市猜测。 */
export const locationRegion = (address: string): Partial<FootprintDraft> => {
  const text = address.trim().replace(/^中国/, '')
  const node = provinces.find((item) => text.startsWith(item.name))
  const provinceMatch = text.match(/^(.+?(?:省|自治区|特别行政区))/)
  const province = node?.name || (provinceMatch ? shortProvince(provinceMatch[1]) : '')
  const rest = provinceMatch ? text.slice(provinceMatch[1].length) : text.replace(new RegExp(`^${province}(?:市)?`), '')
  const cityMatch = rest.match(/^([^省区县路街镇乡村\d]{2,12}?(?:市|自治州|地区|盟))/)
  const city = municipalities.includes(province) ? province
    : cityMatch ? shortCity(cityMatch[1])
    : node?.children?.find((item) => rest.startsWith(item.name))?.name || ''
  const district = rest.replace(cityMatch?.[1] || '', '').match(/^(.+?(?:区|县|旗))/)?.[1] || ''
  return { country: province || city ? '中国' : '', province, city, district }
}

export const MAP_TARGET_STORAGE_KEY = 'sgj:map-target'
export const MAP_TAB_ENTRY_STORAGE_KEY = 'sgj:map-tab-entry'
export const CITY_STAMP_TARGET_STORAGE_KEY = 'sgj:city-stamp-target'

export const citySelection = (regions: string[]): { province: string; city: string } => {
  const province = shortProvince(regions[0] || '')
  const rawCity = shortCity(regions[1] || '')
  const city = ['北京', '上海', '天津', '重庆', '香港', '澳门'].includes(province)
    ? province
    : rawCity
  return { province, city }
}
