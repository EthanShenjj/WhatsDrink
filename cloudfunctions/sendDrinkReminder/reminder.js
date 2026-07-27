const buildSendPayload = ({ openid, templateId, page, data }) => ({
  touser: openid,
  templateId,
  page,
  lang: 'zh_CN',
  miniprogramState: 'trial',
  data,
})

const shouldSendReminder = (subscription, dateKey) =>
  Boolean(
    subscription &&
      subscription.enabled &&
      Number(subscription.remainingCount) > 0 &&
      subscription.lastAttemptDate !== dateKey,
  )

const shanghaiDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

const wechatErrorCode = (error) => {
  const direct = Number(error && (error.errCode || error.errcode))
  if (Number.isFinite(direct) && direct) return direct
  const match = String((error && (error.errMsg || error.message)) || '').match(/\b(\d{5})\b/)
  return match ? Number(match[1]) : 0
}

module.exports = {
  buildSendPayload,
  shanghaiDateKey,
  shouldSendReminder,
  wechatErrorCode,
}
