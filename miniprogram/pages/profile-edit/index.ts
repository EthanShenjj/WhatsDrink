import { ensureProfile, saveProfile, uploadRecordPhoto } from '../../services/repository'

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    avatarChanged: false,
    saving: false,
  },
  async onLoad() {
    const profile = await ensureProfile()
    this.setData({ nickname: profile.nickname, avatarUrl: profile.avatarUrl })
  },
  chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    this.setData({ avatarUrl: event.detail.avatarUrl, avatarChanged: true })
  },
  updateNickname(event: WechatMiniprogram.Input) {
    this.setData({ nickname: event.detail.value })
  },
  async save() {
    const nickname = this.data.nickname.trim() || '饮品记录者'
    this.setData({ saving: true })
    try {
      let avatarUrl = this.data.avatarUrl
      if (avatarUrl && this.data.avatarChanged) {
        avatarUrl = await uploadRecordPhoto(avatarUrl)
      }
      await saveProfile({ nickname, avatarUrl })
      wx.showToast({ title: '资料已更新', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
