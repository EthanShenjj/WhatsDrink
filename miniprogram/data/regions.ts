export interface RegionNode {
  code: string
  name: string
  level: 'country' | 'province' | 'city'
  children?: RegionNode[]
}

export const CHINA_REGIONS: RegionNode[] = [
  {
    code: 'CN',
    name: '中国',
    level: 'country',
    children: [
      {
        code: 'SC',
        name: '四川',
        level: 'province',
        children: [
          { code: 'SC_CD', name: '成都', level: 'city' },
          { code: 'SC_MY', name: '绵阳', level: 'city' },
          { code: 'SC_ZG', name: '自贡', level: 'city' },
          { code: 'SC_LS', name: '乐山', level: 'city' },
          { code: 'SC_YB', name: '宜宾', level: 'city' },
          { code: 'SC_NC', name: '南充', level: 'city' },
        ],
      },
      {
        code: 'GD',
        name: '广东',
        level: 'province',
        children: [
          { code: 'GD_GZ', name: '广州', level: 'city' },
          { code: 'GD_SZ', name: '深圳', level: 'city' },
          { code: 'GD_ZH', name: '珠海', level: 'city' },
          { code: 'GD_FS', name: '佛山', level: 'city' },
          { code: 'GD_DG', name: '东莞', level: 'city' },
          { code: 'GD_ST', name: '汕头', level: 'city' },
        ],
      },
      {
        code: 'ZJ',
        name: '浙江',
        level: 'province',
        children: [
          { code: 'ZJ_HZ', name: '杭州', level: 'city' },
          { code: 'ZJ_NB', name: '宁波', level: 'city' },
          { code: 'ZJ_WZ', name: '温州', level: 'city' },
          { code: 'ZJ_SX', name: '绍兴', level: 'city' },
          { code: 'ZJ_JX', name: '嘉兴', level: 'city' },
        ],
      },
      {
        code: 'JS',
        name: '江苏',
        level: 'province',
        children: [
          { code: 'JS_NJ', name: '南京', level: 'city' },
          { code: 'JS_SZ', name: '苏州', level: 'city' },
          { code: 'JS_WX', name: '无锡', level: 'city' },
          { code: 'JS_NT', name: '南通', level: 'city' },
          { code: 'JS_XZ', name: '徐州', level: 'city' },
        ],
      },
      {
        code: 'BJ',
        name: '北京',
        level: 'province',
        children: [{ code: 'BJ_BJ', name: '北京', level: 'city' }],
      },
      {
        code: 'SH',
        name: '上海',
        level: 'province',
        children: [{ code: 'SH_SH', name: '上海', level: 'city' }],
      },
      {
        code: 'CQ',
        name: '重庆',
        level: 'province',
        children: [{ code: 'CQ_CQ', name: '重庆', level: 'city' }],
      },
      {
        code: 'HB',
        name: '湖北',
        level: 'province',
        children: [
          { code: 'HB_WH', name: '武汉', level: 'city' },
          { code: 'HB_YC', name: '宜昌', level: 'city' },
        ],
      },
      {
        code: 'HN',
        name: '湖南',
        level: 'province',
        children: [
          { code: 'HN_CS', name: '长沙', level: 'city' },
          { code: 'HN_ZJJ', name: '张家界', level: 'city' },
        ],
      },
      {
        code: 'FJ',
        name: '福建',
        level: 'province',
        children: [
          { code: 'FJ_FZ', name: '福州', level: 'city' },
          { code: 'FJ_XM', name: '厦门', level: 'city' },
          { code: 'FJ_QZ', name: '泉州', level: 'city' },
        ],
      },
      {
        code: 'SD',
        name: '山东',
        level: 'province',
        children: [
          { code: 'SD_JN', name: '济南', level: 'city' },
          { code: 'SD_QD', name: '青岛', level: 'city' },
          { code: 'SD_YT', name: '烟台', level: 'city' },
        ],
      },
      {
        code: 'YN',
        name: '云南',
        level: 'province',
        children: [
          { code: 'YN_KM', name: '昆明', level: 'city' },
          { code: 'YN_DL', name: '大理', level: 'city' },
          { code: 'YN_LJ', name: '丽江', level: 'city' },
          { code: 'YN_XSBN', name: '西双版纳', level: 'city' },
        ],
      },
      {
        code: 'GX',
        name: '广西',
        level: 'province',
        children: [
          { code: 'GX_NN', name: '南宁', level: 'city' },
          { code: 'GL_GL', name: '桂林', level: 'city' },
          { code: 'GX_BH', name: '北海', level: 'city' },
        ],
      },
      {
        code: 'XZ',
        name: '西藏',
        level: 'province',
        children: [
          { code: 'XZ_LS', name: '拉萨', level: 'city' },
          { code: 'XZ_RKZ', name: '日喀则', level: 'city' },
        ],
      },
      {
        code: 'XJ',
        name: '新疆',
        level: 'province',
        children: [
          { code: 'XJ_WLMQ', name: '乌鲁木齐', level: 'city' },
          { code: 'XJ_KEL', name: '喀什', level: 'city' },
        ],
      },
      {
        code: 'GS',
        name: '甘肃',
        level: 'province',
        children: [
          { code: 'GS_LZ', name: '兰州', level: 'city' },
          { code: 'GS_DHY', name: '敦煌', level: 'city' },
        ],
      },
      {
        code: 'SN',
        name: '陕西',
        level: 'province',
        children: [
          { code: 'SN_XA', name: '西安', level: 'city' },
          { code: 'SN_YC', name: '延安', level: 'city' },
        ],
      },
      {
        code: 'TJ',
        name: '天津',
        level: 'province',
        children: [{ code: 'TJ_TJ', name: '天津', level: 'city' }],
      },
      {
        code: 'HEB',
        name: '河北',
        level: 'province',
        children: [
          { code: 'HEB_SJZ', name: '石家庄', level: 'city' },
          { code: 'HEB_QHD', name: '秦皇岛', level: 'city' },
          { code: 'HEB_CD', name: '承德', level: 'city' },
        ],
      },
      {
        code: 'HL',
        name: '黑龙江',
        level: 'province',
        children: [
          { code: 'HL_HRB', name: '哈尔滨', level: 'city' },
          { code: 'HL_MDJ', name: '牡丹江', level: 'city' },
        ],
      },
      {
        code: 'JL',
        name: '吉林',
        level: 'province',
        children: [
          { code: 'JL_CC', name: '长春', level: 'city' },
          { code: 'JL_YB', name: '延边', level: 'city' },
        ],
      },
      {
        code: 'LN',
        name: '辽宁',
        level: 'province',
        children: [
          { code: 'LN_SY', name: '沈阳', level: 'city' },
          { code: 'LN_DL', name: '大连', level: 'city' },
        ],
      },
      {
        code: 'AH',
        name: '安徽',
        level: 'province',
        children: [
          { code: 'AH_HF', name: '合肥', level: 'city' },
          { code: 'AH_HS', name: '黄山', level: 'city' },
        ],
      },
      {
        code: 'JX',
        name: '江西',
        level: 'province',
        children: [
          { code: 'JX_NC', name: '南昌', level: 'city' },
          { code: 'JX_JJG', name: '井冈山', level: 'city' },
        ],
      },
      {
        code: 'HA',
        name: '河南',
        level: 'province',
        children: [
          { code: 'HA_ZZ', name: '郑州', level: 'city' },
          { code: 'HA_LY', name: '洛阳', level: 'city' },
        ],
      },
      {
        code: 'HI',
        name: '海南',
        level: 'province',
        children: [
          { code: 'HI_HK', name: '海口', level: 'city' },
          { code: 'HI_SY', name: '三亚', level: 'city' },
        ],
      },
      {
        code: 'GZ',
        name: '贵州',
        level: 'province',
        children: [
          { code: 'GZ_GY', name: '贵阳', level: 'city' },
          { code: 'GZ_TRJ', name: '铜仁', level: 'city' },
        ],
      },
      {
        code: 'NM',
        name: '内蒙古',
        level: 'province',
        children: [
          { code: 'NM_HHT', name: '呼和浩特', level: 'city' },
          { code: 'NM_EEDS', name: '鄂尔多斯', level: 'city' },
        ],
      },
      {
        code: 'NX',
        name: '宁夏',
        level: 'province',
        children: [{ code: 'NX_YC', name: '银川', level: 'city' }],
      },
      {
        code: 'QH',
        name: '青海',
        level: 'province',
        children: [{ code: 'QH_XN', name: '西宁', level: 'city' }],
      },
      {
        code: 'SX',
        name: '山西',
        level: 'province',
        children: [
          { code: 'SX_TY', name: '太原', level: 'city' },
          { code: 'SX_DT', name: '大同', level: 'city' },
        ],
      },
    ],
  },
]

export const ALL_PROVINCES: string[] = CHINA_REGIONS[0].children!.map((p) => p.name)

export const ALL_CITIES: string[] = CHINA_REGIONS[0].children!.flatMap(
  (p) => p.children?.map((c) => c.name) || [],
)

export const findProvince = (name?: string): RegionNode | undefined =>
  CHINA_REGIONS[0].children?.find((p) => p.name === name)

export const citiesOfProvince = (provinceName?: string): string[] => {
  if (!provinceName) return ALL_CITIES
  return findProvince(provinceName)?.children?.map((c) => c.name) || []
}
