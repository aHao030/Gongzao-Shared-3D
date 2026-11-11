const demo = require('../../utils/demo');
Page({
  data: { orders: [] },
  onShow() { this.refresh(); },
  refresh() { this.setData({ orders: demo.listOrders() }); },
  goUpload() { wx.switchTab({ url: '/pages/upload/index' }); },
  advance(event) { demo.advanceOrder(event.currentTarget.dataset.id); this.refresh(); },
  clear() {
    wx.showModal({ title: '清空演示订单', content: '仅删除这个小程序本机保存的演示订单。', confirmText: '清空', success: result => { if (result.confirm) { demo.clearOrders(); this.refresh(); } } });
  }
});
