const DECISIONS = new Set(['accept', 'reject', 'ban', 'filter'])
const MAX_SAVED_AUTHORIZATIONS = 30

const parseTemplateData = (raw) => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null
    const entries = Object.entries(parsed)
    if (!entries.length) return null
    const valid = entries.every(
      ([key, item]) =>
        key &&
        item &&
        !Array.isArray(item) &&
        typeof item === 'object' &&
        typeof item.value === 'string' &&
        item.value.trim().length > 0,
    )
    return valid ? parsed : null
  } catch {
    return null
  }
}

const readTemplateData = (env) => {
  const jsonData = parseTemplateData(env.SUBSCRIBE_TEMPLATE_DATA)
  if (jsonData) return jsonData

  const version = String(env.SUBSCRIBE_TEMPLATE_VERSION || '').trim()
  const content = String(env.SUBSCRIBE_TEMPLATE_CONTENT || '').trim()
  if (!version || !content) return null
  return {
    character_string1: { value: version },
    thing2: { value: content },
  }
}

const readSubscriptionConfig = (env = process.env) => {
  const templateId = String(env.SUBSCRIBE_TEMPLATE_ID || '').trim()
  const data = readTemplateData(env)
  const page = String(env.SUBSCRIBE_PAGE || 'pages/home/index')
    .trim()
    .replace(/^\/+/, '')
  const configured = Boolean(templateId && data)
  return {
    configured,
    templateId: configured ? templateId : '',
    page: page || 'pages/home/index',
    data: data || {},
    reminderTime: '20:00',
  }
}

const applySubscriptionDecision = (existing, decision, config, now = Date.now()) => {
  if (!DECISIONS.has(decision)) throw new Error('订阅结果无效')
  const current = existing || {}
  const remainingCount = Math.max(0, Number(current.remainingCount) || 0)
  const acceptedCount =
    decision === 'accept'
      ? Math.min(MAX_SAVED_AUTHORIZATIONS, remainingCount + 1)
      : remainingCount

  return {
    enabled: decision === 'ban' ? false : acceptedCount > 0,
    remainingCount: acceptedCount,
    templateId: config.templateId,
    page: config.page,
    messageData: config.data,
    reminderTime: config.reminderTime || '20:00',
    lastDecision: decision,
    lastAttemptDate: String(current.lastAttemptDate || ''),
    lastSentDate: String(current.lastSentDate || ''),
    lastError: String(current.lastError || ''),
    createdAt: Number(current.createdAt) || now,
    updatedAt: now,
  }
}

const publicSubscriptionStatus = (subscription, configured) => ({
  configured: Boolean(configured),
  enabled: Boolean(subscription && subscription.enabled),
  remainingCount: Math.max(0, Number(subscription && subscription.remainingCount) || 0),
  reminderTime: String((subscription && subscription.reminderTime) || '20:00'),
  lastDecision: String((subscription && subscription.lastDecision) || ''),
  lastSentDate: String((subscription && subscription.lastSentDate) || ''),
})

module.exports = {
  applySubscriptionDecision,
  publicSubscriptionStatus,
  readSubscriptionConfig,
}
