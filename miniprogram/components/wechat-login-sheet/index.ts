import type { UserProfile } from '../../domain/types'
import {
  loginForAccess,
  saveProfile,
  uploadPhoto,
} from '../../services/repository'

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    rendered: false,
    closing: false,
    closeTimerId: 0,
    avatarUrl: '',
    nickname: '',
    saving: false,
  },
  observers: {
    visible(visible: boolean) {
      if (this.data.closeTimerId) {
        clearTimeout(this.data.closeTimerId)
        this.setData({ closeTimerId: 0 })
      }
      if (visible) {
        this.setData({ rendered: true, closing: false, avatarUrl: '', nickname: '', saving: false })
        return
      }
      if (!this.data.rendered || this.data.closing) return
      this.setData({ closing: true })
      const timerId = setTimeout(() => {
        this.setData({ closeTimerId: 0, rendered: false, closing: false })
      }, 260) as unknown as number
      this.setData({ closeTimerId: timerId })
    },
  },
  methods: {
    chooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
      this.setData({ avatarUrl: event.detail.avatarUrl })
    },
    updateNickname(event: WechatMiniprogram.Input) {
      this.setData({ nickname: event.detail.value })
    },
    async confirm(event: WechatMiniprogram.FormSubmit) {
      if (this.data.saving) return
      const nickname = String(event.detail.value.nickname || this.data.nickname).trim()
      const selectedAvatarUrl = this.data.avatarUrl
      if (!selectedAvatarUrl) {
        wx.showToast({ title: '请选择微信头像', icon: 'none' })
        return
      }
      if (!nickname) {
        wx.showToast({ title: '请填写微信昵称', icon: 'none' })
        return
      }

      this.setData({ saving: true })
      try {
        await loginForAccess()
        const avatarUrl = await uploadPhoto(selectedAvatarUrl)
        const profile = await saveProfile({ nickname, avatarUrl })
        this.triggerEvent<{ profile: UserProfile }>('success', { profile })
      } catch {
        this.setData({ saving: false })
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      }
    },
    cancel() {
      if (this.data.saving) return
      this.triggerEvent('cancel')
    },
    preventClose() {},
  },
})
