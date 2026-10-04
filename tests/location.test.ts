import { describe, expect, it } from 'vitest'
import { locationRegion, shortCity, shortProvince } from '../miniprogram/utils/location'

describe('location administration metadata', () => {
  it.each([
    ['浙江省杭州市西湖区测试路', '浙江', '杭州', '西湖区'],
    ['上海市黄浦区测试路', '上海', '上海', '黄浦区'],
    ['广西壮族自治区南宁市青秀区测试路', '广西', '南宁', '青秀区'],
    ['中国四川省成都市锦江区测试路', '四川', '成都', '锦江区'],
    ['杭州市西湖区测试路', '', '杭州', '西湖区'],
  ])('parses %s without a reverse-geocoding request', (address, province, city, district) => {
    expect(locationRegion(address)).toMatchObject({ country: '中国', province, city, district })
  })
  it('does not guess a city for an ambiguous street address', () => {
    expect(locationRegion('测试路1号').city).toBe('')
  })
  it('uses the same short names as the region filters', () => {
    expect(shortProvince('新疆维吾尔自治区')).toBe('新疆')
    expect(shortCity('杭州市')).toBe('杭州')
  })
})
