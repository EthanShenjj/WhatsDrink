interface SharedTicket {
  name: string
  date: string
  location: string
  code: string
}

export {}

interface PageData {
  ticket: SharedTicket | null
}

const readTicket = (raw = ''): SharedTicket | null => {
  for (const candidate of [raw, (() => { try { return decodeURIComponent(raw) } catch { return '' } })()]) {
    try {
      const value = JSON.parse(candidate) as Partial<SharedTicket>
      if (typeof value.name !== 'string' || !value.name.trim()) continue
      return {
        name: value.name.slice(0, 40),
        date: typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) ? value.date : '',
        location: typeof value.location === 'string' ? value.location.slice(0, 30) : '',
        code: typeof value.code === 'string' ? value.code.slice(0, 30) : '',
      }
    } catch { /* 兼容微信已解码和未解码的 query */ }
  }
  return null
}

Page<PageData, WechatMiniprogram.IAnyObject>({
  data: { ticket: null },
  onLoad(query: Record<string, string>) {
    this.setData({ ticket: readTicket(query.ticket) })
  },
  onExplore() { wx.switchTab({ url: '/pages/map/index' }) },
  onShareAppMessage() {
    const ticket = this.data.ticket
    return ticket
      ? { title: `${ticket.name} · 回忆票根`, path: `/pages/ticket-share/index?ticket=${encodeURIComponent(JSON.stringify(ticket))}` }
      : { title: '拾光迹 · 私人记忆地图', path: '/pages/map/index' }
  },
})
