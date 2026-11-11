const service = require('../../utils/service');
Page({
  data: { spec: null, quotes: [], saving: false, loading: false, error: '', isLocal: true },
  onShow() { this.loadQuotes(); },
  onHide() { this._requestVersion = (this._requestVersion || 0) + 1; },
  async loadQuotes() {
    const version = (this._requestVersion || 0) + 1; this._requestVersion = version;
    const spec = service.getSpec(); this.setData(Object.assign({ spec, quotes: [], saving: false, loading: true, error: '' }, service.getModeInfo()));
    try { const quotes = await service.getQuotes(spec); if (version === this._requestVersion) this.setData({ quotes }); }
    catch (error) { if (version === this._requestVersion) this.setData({ error: error.message }); }
    finally { if (version === this._requestVersion) this.setData({ loading: false }); }
  },
  goUpload() { wx.switchTab({ url: '/pages/upload/index' }); },
  async saveOrder(event) {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try { await service.createOrder(event.currentTarget.dataset.id); wx.switchTab({ url: '/pages/orders/index' }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); }
  }
});
