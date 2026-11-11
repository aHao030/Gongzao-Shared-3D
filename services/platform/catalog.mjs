// Fabricated sandbox partners and rates. No physical devices or market offers.
export const CATALOG_VERSION = 'coforge-sandbox-v2';
export const farms = [
  { id: 'f1', name: '青屿制造工作室', city: '杭州 · 浙江', initial: '青', tone: '', multiplierBps: 10000, baseCents: 1200, days: [3, 5], shippingCents: 1000, device: 'Prusa MK4S', route: 'PrusaLink', origin: 'east' },
  { id: 'f2', name: '造物工场', city: '苏州 · 江苏', initial: '造', tone: 'blue', multiplierBps: 11400, baseCents: 1500, days: [2, 4], shippingCents: 1200, device: 'Klipper FDM 01', route: 'Moonraker', origin: 'east' },
  { id: 'f3', name: '拾物 3D 实验室', city: '深圳 · 广东', initial: '拾', tone: 'sand', multiplierBps: 8800, baseCents: 1000, days: [4, 7], shippingCents: 1200, device: 'FDM Production 03', route: 'OctoPrint', origin: 'south' }
];
export const materials = {
  PLA: { label: 'PLA', process: 'FDM', density: 1.24, centsPerGram: 45, auto: true },
  PETG: { label: 'PETG', process: 'FDM', density: 1.27, centsPerGram: 58, auto: true },
  ABS: { label: 'ABS', process: 'FDM', auto: false },
  RESIN: { label: '工程树脂', process: '树脂', auto: false },
  ALUMINUM: { label: '铝合金', process: '金属', auto: false },
  CNC: { label: 'CNC 铝件', process: 'CNC', auto: false }
};
export const destinations = { east: '中国大陆 · 华东', south: '中国大陆 · 华南', north: '中国大陆 · 华北', other: '其他地区 · 询价确认' };
export const freshDevices = () => farms.map((farm, index) => ({
  id: `p${index + 1}`, farm: farm.id, name: farm.device, route: farm.route,
  state: 'ready', orderId: null, material: 'PLA / PETG', loadedMaterial: 'PLA',
  profileVersion: 'fdm-certified-demo-v2', recipeVersion: 'sandbox-recipe-v2',
  bedClear: true, materialReady: true, clearanceEpoch: 0
}));
export const sampleModel = {
  id: 'sample-bracket', name: '桌面设备固定支架.stl', size: 284672,
  dimensions: [72, 48, 58], volume: 22.4, faceCount: 3248,
  isSample: true, review: false, closed: true, format: 'stl',
  verified: true, geometrySource: 'server-fixture', unit: 'mm',
  sha256: 'acd2860b0e8087374a859758d4b7b11b6413f21ada2ddb539a968b9da6f42b8b',
  version: 1, blobKey: null
};
