const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const MAX_INPUT_LENGTH = 2000
const MAX_PHOTOS = 9

const sanitizePhotoIds = (value, openid) => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('照片字段不合法')
  if (value.length > MAX_PHOTOS) throw new Error('照片最多允许 9 张')
  const seen = new Set()
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      !item.startsWith('cloud://') ||
      !item.includes(`/${openid}/`)
    ) {
      throw new Error('照片必须来自当前用户的云存储目录')
    }
    seen.add(item.slice(0, 500))
  }
  return [...seen]
}

// Mood keywords indexed by mood value (mirrors miniprogram/data/options.ts MOOD_OPTIONS)
const MOOD_KEYWORDS = [
  { value: 'happy', words: ['开心', '高兴', '快乐', '愉快', '嗨'] },
  { value: 'calm', words: ['平静', '安静', '宁和', '安宁'] },
  { value: 'excited', words: ['兴奋', '激动', '刺激', '嗨翻'] },
  { value: 'grateful', words: ['感恩', '感谢', '温暖', '感动'] },
  { value: 'nostalgic', words: ['怀念', '回忆', '想念', '记得'] },
  { value: 'relaxed', words: ['放松', '悠闲', '舒服', '惬意', '休闲'] },
  { value: 'curious', words: ['好奇', '新奇', '探索', '发现'] },
  { value: 'romantic', words: ['浪漫', '甜蜜', '约会', '恋爱'] },
  { value: 'energetic', words: ['活力', '热血', '运动', '燃烧'] },
  { value: 'cozy', words: ['温馨', '居家', '舒服', '暖'] },
]

// Category keywords indexed by category value (mirrors miniprogram/data/options.ts CATEGORY_OPTIONS)
const CATEGORY_KEYWORDS = [
  { value: 'park', words: ['公园', '园子', '绿地'] },
  { value: 'food', words: ['美食', '餐厅', '吃饭', '饭馆', '小吃', '面馆', '咖啡'] },
  { value: 'scenic', words: ['景点', '景区', '名胜', '打卡'] },
  { value: 'shopping', words: ['商场', '购物', '逛街', '商店'] },
  { value: 'bar', words: ['酒吧', '酒馆', '小酌', '微醺'] },
  { value: 'nature', words: ['自然', '山水', '山', '湖', '海', '森林', '草原'] },
  { value: 'heritage', words: ['古迹', '古城', '遗址', '历史'] },
  { value: 'market', words: ['市集', '集市', '夜市'] },
  { value: 'sports', words: ['运动', '健身', '打球', '跑步', '骑行'] },
  { value: 'exhibition', words: ['展览', '展馆', '博物馆', '美术馆'] },
  { value: 'show', words: ['演出', '演唱会', '话剧', '电影', '舞台剧'] },
  { value: 'home', words: ['在家', '家里', '宅家'] },
]

const pad2 = (n) => String(n).padStart(2, '0')

const formatDate = (date) =>
  (() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  })()

const extractDate = (text) => {
  const now = new Date()
  if (/今天|今日/.test(text)) return formatDate(now)
  if (/昨天/.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return formatDate(d)
  }
  if (/前天/.test(text)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 2)
    return formatDate(d)
  }
  // Match patterns like 9月10日, 9.10, 09-10, 9/10
  const m = text.match(/(\d{1,2})\s*[月./\-]\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    const month = Number(m[1])
    const day = Number(m[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${now.getFullYear()}-${pad2(month)}-${pad2(day)}`
    }
  }
  return undefined
}

const extractMood = (text) => {
  for (const { value, words } of MOOD_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return value
  }
  return undefined
}

const extractCategory = (text) => {
  for (const { value, words } of CATEGORY_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return value
  }
  return undefined
}

const extractTags = (text) => {
  const tags = []
  const hashMatches = text.match(/#([^\s#，,。.!！?？]+)/g) || []
  for (const m of hashMatches) {
    const tag = m.slice(1).trim().slice(0, 20)
    if (tag) tags.push(tag)
  }
  return [...new Set(tags)]
}

const extractPoiName = (text) => {
  // Try patterns like "在XXX" or "去了XXX" or "到XXX"
  const patterns = [
    /在\s*([^\s,，。.!！?？]{2,30})/,
    /去了\s*([^\s,，。.!！?？]{2,30})/,
    /到\s*([^\s,，。.!！?？]{2,30})/,
    /逛了?\s*([^\s,，。.!！?？]{2,30})/,
  ]
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) return m[1].trim()
  }
  return undefined
}

/**
 * Heuristic draft generator. This is a placeholder for a real AI API call.
 * Replace the body with a call to an LLM (GPT-4, Claude, etc.) when integrating.
 * The function signature should remain: (text, photoIds) => FootprintDraftAI
 */
const draftHeuristic = (text, photoIds) => {
  const trimmed = String(text || '').trim().slice(0, MAX_INPUT_LENGTH)
  if (!trimmed) throw new Error('文本内容不能为空')
  const extractedDate = extractDate(trimmed)
  const visitDate = extractedDate || formatDate(new Date())
  const mood = extractMood(trimmed)
  const category = extractCategory(trimmed)
  const tags = extractTags(trimmed)
  const poiName = extractPoiName(trimmed)
  const note = trimmed.slice(0, 500)
  const photos = Array.isArray(photoIds) && photoIds.length ? photoIds : undefined

  const draft = {
    poiName,
    visitDate,
    mood,
    category,
    tags: tags.length ? tags : undefined,
    note,
    photos,
    confidence: 0.3,
    needsPoiConfirmation: true,
    dateWasDefaulted: !extractedDate,
  }
  return draft
}

/**
 * Plug-in point for a real AI service. Replace the implementation with an
 * actual API call when ready. The heuristic fallback remains as a safety net.
 */
const draftWithAI = async (text, photoIds) => {
  // TODO: integrate real AI API here, e.g.:
  //   const response = await fetch('https://api.openai.com/v1/chat/completions', { ... })
  //   return parseAIResponse(response)
  return draftHeuristic(text, photoIds)
}

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    if (event.action !== 'draft') throw new Error('不支持的操作')
    if (typeof event.text !== 'string' || event.text.trim().length > MAX_INPUT_LENGTH) {
      throw new Error(`文本内容不能为空且不能超过 ${MAX_INPUT_LENGTH} 字`)
    }
    const photoIds = sanitizePhotoIds(event.photoIds, OPENID)
    const draft = await draftWithAI(event.text, photoIds)
    return { ok: true, data: draft }
  } catch (error) {
    return { ok: false, message: error.message || 'AI 助手调用失败' }
  }
}
