import { describe, it, expect } from 'vitest'
import {
  CHINA_REGIONS,
  ALL_PROVINCES,
  ALL_CITIES,
  findProvince,
  citiesOfProvince,
} from '../miniprogram/data/regions'

describe('CHINA_REGIONS', () => {
  it('has China as root', () => {
    expect(CHINA_REGIONS).toHaveLength(1)
    expect(CHINA_REGIONS[0].name).toBe('中国')
    expect(CHINA_REGIONS[0].level).toBe('country')
  })

  it('has provinces as children', () => {
    const provinces = CHINA_REGIONS[0].children
    expect(provinces).toBeDefined()
    expect(provinces!.length).toBeGreaterThan(20)
  })
})

describe('ALL_PROVINCES', () => {
  it('contains key provinces', () => {
    expect(ALL_PROVINCES).toContain('四川')
    expect(ALL_PROVINCES).toContain('北京')
    expect(ALL_PROVINCES).toContain('上海')
    expect(ALL_PROVINCES).toContain('云南')
  })
})

describe('ALL_CITIES', () => {
  it('contains key cities', () => {
    expect(ALL_CITIES).toContain('成都')
    expect(ALL_CITIES).toContain('北京')
    expect(ALL_CITIES).toContain('大理')
  })
})

describe('findProvince', () => {
  it('finds existing province', () => {
    const sichuan = findProvince('四川')
    expect(sichuan).toBeDefined()
    expect(sichuan!.name).toBe('四川')
  })

  it('returns undefined for non-existent province', () => {
    expect(findProvince('火星')).toBeUndefined()
  })
})

describe('citiesOfProvince', () => {
  it('returns cities for a province', () => {
    const cities = citiesOfProvince('四川')
    expect(cities).toContain('成都')
    expect(cities).toContain('绵阳')
    expect(cities.length).toBeGreaterThan(3)
  })

  it('returns empty for non-existent province', () => {
    expect(citiesOfProvince('火星')).toEqual([])
  })

  it('returns all cities when no province specified', () => {
    const allCities = citiesOfProvince()
    expect(allCities.length).toBe(ALL_CITIES.length)
  })
})
