const service = require('../../utils/service');
const blank = () => ({ displayName: '', recipient: '', phone: '', countryCode: 'CN', province: '', city: '', district: '', addressLine: '', postalCode: '' });
Page({
  data: { form: blank(), isLocal: true, loading: false, saving: false, error: '' },
  async onShow() {
    this.setData(Object.assign({ loading: false, error: '' }, service.getModeInfo()));
    if (this.data.isLocal) { this.setData({ form: blank() }); return; }
    this.setData({ loading: true });
    try { const { profile } = await service.getCustomerProfile(); this.setData({ form: Object.assign(blank(), profile && profile.shippingAddress || {}, { displayName: profile && profile.displayName || '' }) }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  onUnload() { this.setData({ form: blank() }); },
  changeField(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.saving || !Object.prototype.hasOwnProperty.call(blank(), field)) return;
    this.setData({ ['form.' + field]: event.detail.value });
  },
  async saveProfile() {
    if (this.data.saving || this.data.loading || this.data.isLocal) return;
    const form = {}; Object.keys(blank()).forEach(key => { form[key] = String(this.data.form[key] || '').trim(); });
    form.countryCode = form.countryCode.toUpperCase();
    const required = ['recipient', 'phone', 'countryCode', 'province', 'city', 'addressLine'];
    if (form.countryCode === 'CN') required.push('district');
    if (required.some(key => !form[key]) || !/^[A-Z]{2}$/.test(form.countryCode)) { this.setData({ error: '请填写完整收货信息，国家/地区代码使用两位英文字母，例如 CN。' }); return; }
    const { displayName, ...shippingAddress } = form;
    this.setData({ saving: true, error: '' });
    try { await service.saveCustomerProfile({ displayName, setupCompleted: true, shippingAddress }); wx.showToast({ title: '地址已保存', icon: 'none' }); wx.switchTab({ url: '/pages/quotes/index' }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ saving: false }); }
  },
  goBack() { if (!this.data.saving) wx.switchTab({ url: '/pages/upload/index' }); }
});
