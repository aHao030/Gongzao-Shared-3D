const service = require('../../utils/service');
Page({
  data: { orders: [], loading: false, error: '', isLocal: true },
  onShow() { this.refresh(); },
  onHide() { this._requestVersion = (this._requestVersion || 0) + 1; },
  async refresh() {
    const version = (this._requestVersion || 0) + 1; this._requestVersion = version;
    this.setData(Object.assign({ loading: true, error: '', orders: [] }, service.getModeInfo()));
    try { const orders = await service.listOrders(); if (version === this._requestVersion) this.setData({ orders }); }
    catch (error) { if (version === this._requestVersion) this.setData({ error: error.message }); }
    finally { if (version === this._requestVersion) this.setData({ loading: false }); }
  },
  goUpload() { wx.switchTab({ url: '/pages/upload/index' }); },
  advance(event) { try { service.advanceOrder(event.currentTarget.dataset.id); this.refresh(); } catch (error) { this.setData({ error: error.message }); } },
  clear() {
    if (!this.data.isLocal) return;
    wx.showModal({ title: '清空演示订单', content: '仅删除这个小程序本机保存的演示订单。', confirmText: '清空', success: result => { if (result.confirm) { service.clearOrders(); this.refresh(); } } });
  }
});
