import type { Brand, Drink } from '../domain/types'

const brand = (id: string, name: string, category: Brand['category']): Brand => ({
  id,
  name,
  category,
  public: true,
  version: 1,
})

export const BRANDS: Brand[] = [
  brand('starbucks', '星巴克', 'coffee'),
  brand('luckin', '瑞幸', 'coffee'),
  brand('manner', 'Manner', 'coffee'),
  brand('cotti', '库迪', 'coffee'),
  brand('tims', 'Tims', 'coffee'),
  brand('mstand', 'M Stand', 'coffee'),
  brand('heytea', '喜茶', 'milk_tea'),
  brand('nayuki', '奈雪', 'milk_tea'),
  brand('chagee', '霸王茶姬', 'milk_tea'),
  brand('mixue', '蜜雪冰城', 'milk_tea'),
  brand('coco', 'CoCo 都可', 'milk_tea'),
  brand('auntea', '沪上阿姨', 'milk_tea'),
]

const drink = (
  id: string,
  brandId: string,
  brandName: string,
  name: string,
  category: Drink['category'],
  calorieKcal?: number,
): Drink => ({
  id,
  brandId,
  brandName,
  name,
  category,
  defaultSize: '中杯',
  calorieKcal,
  calorieSource: 'estimated',
  public: true,
  version: 1,
})

export const DRINKS: Drink[] = [
  drink('starbucks-latte', 'starbucks', '星巴克', '拿铁', 'coffee', 190),
  drink('starbucks-americano', 'starbucks', '星巴克', '美式咖啡', 'coffee', 15),
  drink('starbucks-coldbrew', 'starbucks', '星巴克', '冷萃冰咖啡', 'coffee', 10),
  drink('luckin-coconut', 'luckin', '瑞幸', '生椰拿铁', 'coffee', 180),
  drink('luckin-spanish', 'luckin', '瑞幸', '西班牙拿铁', 'coffee', 230),
  drink('luckin-americano', 'luckin', '瑞幸', '标准美式', 'coffee', 15),
  drink('manner-latte', 'manner', 'Manner', '燕麦拿铁', 'coffee', 170),
  drink('manner-americano', 'manner', 'Manner', '美式咖啡', 'coffee', 15),
  drink('manner-flatwhite', 'manner', 'Manner', '澳白', 'coffee', 150),
  drink('cotti-coconut', 'cotti', '库迪', '潘帕斯蓝生酪拿铁', 'coffee', 220),
  drink('cotti-latte', 'cotti', '库迪', '经典拿铁', 'coffee', 180),
  drink('cotti-americano', 'cotti', '库迪', '经典美式', 'coffee', 15),
  drink('tims-double', 'tims', 'Tims', '双双拿铁', 'coffee', 210),
  drink('tims-latte', 'tims', 'Tims', '经典拿铁', 'coffee', 180),
  drink('tims-americano', 'tims', 'Tims', '鲜萃美式', 'coffee', 15),
  drink('mstand-coconut', 'mstand', 'M Stand', '椰青冰萃', 'coffee', 120),
  drink('mstand-latte', 'mstand', 'M Stand', '拿铁', 'coffee', 180),
  drink('mstand-flatwhite', 'mstand', 'M Stand', '澳白', 'coffee', 150),
  drink('heytea-grape', 'heytea', '喜茶', '多肉葡萄', 'milk_tea', 320),
  drink('heytea-bobo', 'heytea', '喜茶', '烤黑糖波波牛乳', 'milk_tea', 410),
  drink('heytea-cheese', 'heytea', '喜茶', '芝芝绿妍茶后', 'milk_tea', 190),
  drink('nayuki-grape', 'nayuki', '奈雪', '霸气葡萄', 'milk_tea', 310),
  drink('nayuki-jasmine', 'nayuki', '奈雪', '茉莉初雪', 'milk_tea', 180),
  drink('nayuki-milk', 'nayuki', '奈雪', '金色山脉珍珠奶茶', 'milk_tea', 390),
  drink('chagee-boyaju', 'chagee', '霸王茶姬', '伯牙绝弦', 'milk_tea', 106),
  drink('chagee-guanyin', 'chagee', '霸王茶姬', '青青糯山', 'milk_tea', 126),
  drink('chagee-jasmine', 'chagee', '霸王茶姬', '花田乌龙', 'milk_tea', 118),
  drink('mixue-lemon', 'mixue', '蜜雪冰城', '冰鲜柠檬水', 'milk_tea', 190),
  drink('mixue-boba', 'mixue', '蜜雪冰城', '珍珠奶茶', 'milk_tea', 360),
  drink('mixue-king', 'mixue', '蜜雪冰城', '雪王圣代', 'milk_tea', 330),
  drink('coco-three', 'coco', 'CoCo 都可', '三兄弟奶茶', 'milk_tea', 430),
  drink('coco-taro', 'coco', 'CoCo 都可', '鲜芋青稞牛奶', 'milk_tea', 390),
  drink('coco-boba', 'coco', 'CoCo 都可', '珍珠奶茶', 'milk_tea', 360),
  drink('auntea-grape', 'auntea', '沪上阿姨', '葡萄酸奶昔', 'milk_tea', 350),
  drink('auntea-jasmine', 'auntea', '沪上阿姨', '茉莉奶绿', 'milk_tea', 290),
  drink('auntea-blood', 'auntea', '沪上阿姨', '血糯米奶茶', 'milk_tea', 410),
]

export const findBrand = (id?: string): Brand | undefined => BRANDS.find((item) => item.id === id)

export const findDrink = (id?: string): Drink | undefined => DRINKS.find((item) => item.id === id)

export const drinksForBrand = (brandId: string): Drink[] =>
  DRINKS.filter((item) => item.brandId === brandId)
