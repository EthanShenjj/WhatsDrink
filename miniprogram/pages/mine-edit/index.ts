import { ensureProfile, saveProfile, uploadPhoto } from '../../services/repository'

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    loading: true,
    saving: false,
  },

  async onLoad() {
    try {
      const profile = await ensureProfile()
      this.setData({
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
        loading: false,
      })
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '资料加载失败', icon: 'none' })
    }
  },

  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value || '' })
  },

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        wx.showLoading({ title: '处理中…', mask: true })
        try {
          const avatarUrl = await uploadPhoto(res.tempFiles[0].tempFilePath)
          this.setData({ avatarUrl })
        } catch {
          wx.showToast({ title: '头像选择失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      },
    })
  },

  async onSave() {
    const nickname = this.data.nickname.trim()
    if (!nickname) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const profile = await saveProfile({ nickname, avatarUrl: this.data.avatarUrl })
      getApp<IAppOption>().globalData.profile = profile
      wx.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      this.setData({ saving: false })
    }
  },
})
