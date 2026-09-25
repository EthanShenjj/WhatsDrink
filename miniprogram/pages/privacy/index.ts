Page({
  onOpenSettings() {
    wx.openSetting({
      fail: () => wx.showToast({ title: '暂时无法打开系统设置', icon: 'none' }),
    })
  },
})
