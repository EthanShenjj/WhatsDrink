import { describe, expect, it } from 'vitest'
import { citySelection } from '../miniprogram/utils/location'

describe('city region selection', () => {
  it('normalizes municipalities and Hong Kong/Macau', () => {
    expect(citySelection(['北京市', '市辖区'])).toEqual({ province: '北京', city: '北京' })
    expect(citySelection(['香港特别行政区', '香港特别行政区'])).toEqual({ province: '香港', city: '香港' })
    expect(citySelection(['澳门特别行政区', '澳门特别行政区'])).toEqual({ province: '澳门', city: '澳门' })
  })

  it('keeps an ordinary city without using the district', () => {
    expect(citySelection(['四川省', '成都市', '锦江区'])).toEqual({ province: '四川', city: '成都' })
  })
})
