const demo = require('../../utils/demo');
Page({
  data: { materials: demo.materials, materialIndex: 0, quantity: '1', sampleSelected: false },
  onShow() {
    const spec = demo.getSpec();
    if (spec) this.setData({ materialIndex: spec.materialIndex, quantity: String(spec.quantity), sampleSelected: true });
  },
  selectSample() { this.setData({ sampleSelected: true }); wx.showToast({ title: '已选择示例模型', icon: 'none' }); },
  changeMaterial(event) { this.setData({ materialIndex: Number(event.detail.value) }); },
  changeQuantity(event) { this.setData({ quantity: event.detail.value }); },
  generateQuotes() {
    if (!this.data.sampleSelected) return wx.showToast({ title: '请先选择示例模型', icon: 'none' });
    try { demo.saveSpec(this.data.materialIndex, this.data.quantity); wx.switchTab({ url: '/pages/quotes/index' }); }
    catch (_) { wx.showToast({ title: '数量请输入 1–100 的整数', icon: 'none' }); }
  }
});
