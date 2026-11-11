const service = require('../../utils/service');
Page({
  data: { materials: service.materials, materialIndex: 0, quantity: '1', sampleSelected: false, modeOptions: ['本机演示', '服务端沙盒（需配置鉴权）'], modeIndex: 0, modeLabel: '本机演示', isLocal: true, busy: false },
  onShow() {
    const spec = service.getSpec();
    this.setData(service.getModeInfo());
    if (spec) this.setData({ materialIndex: spec.materialIndex, quantity: String(spec.quantity), sampleSelected: true });
  },
  async changeMode(event) {
    this.setData({ busy: true });
    try { this.setData(await service.selectMode(Number(event.detail.value) === 1 ? 'server' : 'local')); }
    catch (error) { this.setData(service.getModeInfo()); wx.showModal({ title: '服务端模式尚未就绪', content: error.message, showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }); },
  selectSample() { this.setData({ sampleSelected: true }); wx.showToast({ title: '已选择示例模型', icon: 'none' }); },
  changeMaterial(event) { this.setData({ materialIndex: Number(event.detail.value) }); },
  changeQuantity(event) { this.setData({ quantity: event.detail.value }); },
  generateQuotes() {
    if (this.data.busy) return;
    if (!this.data.sampleSelected) return wx.showToast({ title: '请先选择示例模型', icon: 'none' });
    try { service.saveSpec(this.data.materialIndex, this.data.quantity); wx.switchTab({ url: '/pages/quotes/index' }); }
    catch (_) { wx.showToast({ title: '数量请输入 1–100 的整数', icon: 'none' }); }
  }
});
