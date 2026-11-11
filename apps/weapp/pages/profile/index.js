const service = require('../../utils/service');
const blank = () => ({ displayName: '', recipient: '', phone: '', countryCode: 'CN', province: '', city: '', district: '', addressLine: '', postalCode: '' });
const regionalFields = ['province', 'city', 'district', 'postalCode'];
const fieldLengths = { recipient: 80, phone: 40, province: 80, city: 80, district: 80, addressLine: 240, postalCode: 20 };
function validateFields(form, market) {
  const errors = {};
  if (!/^[A-Z]{2}$/.test(form.countryCode)) errors.countryCode = '请填写实际两位国家或地区代码，例如 BR。';
  for (const key of market.address.fieldOrder) {
    if (key === 'countryCode') continue;
    const field = market.address.fields[key], value = String(form[key] || '').trim();
    if (field.required && !value) errors[key] = '请填写' + field.label + '。';
    else if (/[\u0000-\u001f\u007f]/.test(value)) errors[key] = field.label + '不能包含换行或控制字符。';
    else if (key === 'phone' && value && (!/^[+]?[0-9 ()-]+$/.test(value) || !/^\d{5,20}$/.test(value.replace(/\D/g, '')))) errors[key] = '联系电话需含 5–20 位数字，+ 只能放在开头。';
  }
  return errors;
}
function errorSummary(errors) {
  const messages = Object.values(errors);
  return messages.length > 1 ? '请修改 ' + messages.length + ' 处填写内容。' : messages[0] || '';
}
Page({
  data: { form: blank(), isLocal: true, loading: false, saving: false, error: '', fieldErrors: {}, marketsReady: false, countryOptions: [], countryIndex: 0, otherCountry: false, addressFields: [], addressNote: '', currencyNote: '', paymentMethods: [], paymentNote: '' },
  async onShow() {
    const version = (this._loadVersion || 0) + 1; this._loadVersion = version;
    this._markets = null; this._market = null;
    this.setData(Object.assign({ loading: false, error: '', fieldErrors: {}, marketsReady: false, countryOptions: [], addressFields: [], paymentMethods: [] }, service.getModeInfo()));
    if (this.data.isLocal) { this.setData({ form: blank() }); return; }
    this.setData({ loading: true });
    try {
      const results = await Promise.all([service.getCustomerProfile(), service.getMarkets()]);
      if (version !== this._loadVersion) return;
      const profile = results[0].profile;
      this._markets = results[1].markets;
      if (!this._markets || !this._markets.some(market => market.countryCode === 'OTHER') || !this._markets.some(market => market.countryCode === 'CN')) throw new Error('服务端国家配置不完整，请稍后重试。');
      const form = Object.assign(blank(), profile && profile.shippingAddress || {}, { displayName: profile && profile.displayName || '' });
      this.setData({ form, countryOptions: this._markets.map(market => ({ countryCode: market.countryCode, name: market.name })), marketsReady: true });
      this.applyMarket(form.countryCode, false);
    } catch (error) { if (version === this._loadVersion) this.setData({ error: error.message, marketsReady: false }); }
    finally { if (version === this._loadVersion) this.setData({ loading: false }); }
  },
  onUnload() { this._loadVersion = (this._loadVersion || 0) + 1; this._markets = null; this._market = null; this.setData({ form: blank() }); },
  applyMarket(countryCode, clearRegional) {
    if (!this._markets) return;
    const index = this._markets.findIndex(market => market.countryCode === countryCode);
    const otherIndex = this._markets.findIndex(market => market.countryCode === 'OTHER');
    const countryIndex = index < 0 ? otherIndex : index;
    const market = this._markets[countryIndex];
    const form = Object.assign({}, this.data.form, { countryCode: countryCode === 'OTHER' ? '' : countryCode });
    if (clearRegional) regionalFields.forEach(field => { form[field] = ''; });
    Object.keys(market.address.fields).forEach(field => { if (!market.address.fields[field].visible) form[field] = ''; });
    this._market = market;
    const addressFields = market.address.fieldOrder.filter(key => key !== 'countryCode').map(key => Object.assign({ key, maxlength: fieldLengths[key] || 80, showOptional: !market.address.fields[key].required && !market.address.fields[key].label.includes('选填') }, market.address.fields[key]));
    this.setData({ form, countryIndex, otherCountry: market.countryCode === 'OTHER', addressFields, addressNote: market.address.note, error: '', fieldErrors: {},
      currencyNote: (market.referenceCurrency ? '当地参考币种 ' + market.referenceCurrency + '；' : '当地参考币种待确认；') + '当前演示计账 CNY，不进行汇率换算。',
      paymentMethods: market.payment.methods, paymentNote: market.payment.note });
  },
  changeCountry(event) {
    if (this.data.saving || !this.data.marketsReady) return;
    const market = this._markets[Number(event.detail.value)];
    if (market) this.applyMarket(market.countryCode, market.countryCode !== this.data.form.countryCode);
  },
  changeField(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.saving || !this.data.marketsReady || !Object.prototype.hasOwnProperty.call(blank(), field)) return;
    const previousCountry = this.data.form.countryCode;
    const value = field === 'countryCode' ? String(event.detail.value).trim().toUpperCase() : event.detail.value;
    const updates = { ['form.' + field]: value };
    if (this.data.fieldErrors[field]) {
      const errors = Object.assign({}, this.data.fieldErrors);
      const current = validateFields(Object.assign({}, this.data.form, { [field]: value }), this._market)[field];
      if (current) errors[field] = current;
      else delete errors[field];
      updates.fieldErrors = errors;
      updates.error = errorSummary(errors);
    }
    this.setData(updates);
    if (field === 'countryCode' && /^[A-Z]{2}$/.test(value)) this.applyMarket(value, value !== previousCountry);
  },
  async saveProfile() {
    if (this.data.saving || this.data.loading || this.data.isLocal || !this.data.marketsReady || !this._market) return;
    const form = {}; Object.keys(blank()).forEach(key => { form[key] = String(this.data.form[key] || '').trim(); });
    form.countryCode = form.countryCode.toUpperCase();
    const errors = validateFields(form, this._market);
    if (Object.keys(errors).length) {
      this.setData({ fieldErrors: errors, error: errorSummary(errors) });
      return;
    }
    Object.keys(this._market.address.fields).forEach(key => { if (!this._market.address.fields[key].visible) form[key] = ''; });
    const { displayName, ...shippingAddress } = form;
    this.setData({ saving: true, fieldErrors: {}, error: '' });
    try { await service.saveCustomerProfile({ displayName, setupCompleted: true, shippingAddress }); wx.showToast({ title: '地址已保存', icon: 'none' }); wx.switchTab({ url: '/pages/quotes/index' }); }
    catch (error) { this.setData({ error: error.message, fieldErrors: error.fieldErrors || {} }); }
    finally { this.setData({ saving: false }); }
  },
  goBack() { if (!this.data.saving) wx.switchTab({ url: '/pages/upload/index' }); }
});
