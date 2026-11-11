const service = require('../../utils/service');
Page({
  data: { spec: null, quotes: [], saving: false, loading: false, error: '', addressRequired: false, isLocal: true, budget: null, budgetLoading: false, budgetError: '' },
  onShow() {
    const info = service.getModeInfo();
    this.setData(Object.assign({ spec: service.getSpec(), quotes: [], error: '', saving: false, loading: false, addressRequired: false,
      budget: null, budgetLoading: false, budgetError: '' }, info));
    if (info.isLocal) return this.loadQuotes();
  },
  onHide() {
    this._requestVersion = (this._requestVersion || 0) + 1;
    this._budgetVersion = (this._budgetVersion || 0) + 1;
  },
  onUnload() { this.onHide(); },
  async loadBudget() {
    if (this.data.budgetLoading || !this.data.spec || this.data.isLocal) return;
    const version = this._budgetVersion = (this._budgetVersion || 0) + 1;
    this.setData({ budget: null, budgetLoading: true, budgetError: '' });
    try {
      const budget = await service.getBudgetEstimate(this.data.spec);
      if (version === this._budgetVersion) this.setData({budget});
    } catch (error) {
      if (version === this._budgetVersion) this.setData({budgetError: error.message});
    } finally {
      if (version === this._budgetVersion) this.setData({budgetLoading: false});
    }
  },
  async loadQuotes() {
    const version = (this._requestVersion || 0) + 1; this._requestVersion = version;
    const spec = service.getSpec(); this.setData(Object.assign({ spec, quotes: [], saving: false, loading: true, error: '', addressRequired: false }, service.getModeInfo()));
    try { const quotes = await service.getQuotes(spec); if (version === this._requestVersion) this.setData({ quotes }); }
    catch (error) { if (version === this._requestVersion) this.setData({ error: error.message, addressRequired: ['ADDRESS_REQUIRED', 'ADDRESS_CHANGED', 'ADDRESS_INCOMPLETE'].includes(error.code) }); }
    finally { if (version === this._requestVersion) this.setData({ loading: false }); }
  },
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  goUpload() { wx.switchTab({ url: '/pages/upload/index' }); },
  async saveOrder(event) {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try { await service.createOrder(event.currentTarget.dataset.id); wx.switchTab({ url: '/pages/orders/index' }); }
    catch (error) { this.setData({ error: error.message, addressRequired: ['ADDRESS_REQUIRED', 'ADDRESS_CHANGED', 'ADDRESS_INCOMPLETE'].includes(error.code) }); }
    finally { this.setData({ saving: false }); }
  }
});
