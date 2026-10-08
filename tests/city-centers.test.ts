import { describe, expect, it } from 'vitest'
import { CITY_CENTERS } from '../miniprogram/data/city-centers'
import { CHINA_REGIONS } from '../miniprogram/data/regions'
import { provinceAt, resolveProvince } from '../miniprogram/utils/province-map'

describe('city-only wishlist reference positions', () => {
  it('covers every city offered by the city picker with a point in its province', () => {
    const provinces = CHINA_REGIONS[0].children || []
    const keys = provinces.flatMap((province) =>
      (province.children || []).map((city) => `${province.name}/${city.name}`),
    )
    expect(Object.keys(CITY_CENTERS).sort()).toEqual(keys.sort())
    for (const province of provinces) {
      for (const city of province.children || []) {
        const [latitude, longitude] = CITY_CENTERS[`${province.name}/${city.name}`]
        expect(Number.isFinite(latitude) && Number.isFinite(longitude)).toBe(true)
        expect(provinceAt(latitude, longitude), `${province.name}/${city.name}`).toBe(resolveProvince(province.name))
      }
    }
  })
})
