const demo = require('../../utils/demo');
Page({
  data: { spec: null, quotes: [], saving: false },
  onShow() { const spec = demo.getSpec(); this.setData({ spec, quotes: demo.getQuotes(spec), saving: false }); },
  goUpload() { wx.switchTab({ url: '/pages/upload/index' }); },
  saveOrder(event) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try { demo.createOrder(event.currentTarget.dataset.id); wx.switchTab({ url: '/pages/orders/index' }); }
    catch (_) { wx.showToast({ title: '请先选择示例模型', icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  }
});
