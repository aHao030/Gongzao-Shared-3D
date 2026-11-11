// Owner-scoped customer delivery details. No geocoding or external address service.
class CustomerError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'PlatformError'; this.code = code; this.status = status; }
}
const ensure = (condition, code, message, status) => { if (!condition) throw new CustomerError(code, message, status); };
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, label, maximum, required = true) => {
  ensure(typeof value === 'string', 'INVALID_ADDRESS', `${label}格式无效`);
  const result = value.trim();
  ensure((!required || result.length > 0) && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result), 'INVALID_ADDRESS', `请填写有效的${label}`);
  return result;
};
const provinceGroups = {
  east: ['上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省'],
  south: ['广东省', '广西壮族自治区', '海南省'],
  north: ['北京市', '天津市', '河北省', '山西省', '内蒙古自治区'],
  other: ['辽宁省', '吉林省', '黑龙江省', '河南省', '湖北省', '湖南省', '重庆市', '四川省', '贵州省', '云南省', '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区']
};
const provinceAliases = new Map();
for (const [destination, provinces] of Object.entries(provinceGroups)) {
  for (const province of provinces) {
    provinceAliases.set(province, { province, destination });
    provinceAliases.set(province.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, ''), { province, destination });
  }
}

export function normalizeShippingAddress(value) {
  ensure(plainObject(value), 'INVALID_ADDRESS', '请填写完整收货地址');
  const countryCode = cleanText(value.countryCode, '国家或地区代码', 2).toUpperCase();
  ensure(/^[A-Z]{2}$/.test(countryCode), 'INVALID_ADDRESS', '国家或地区代码需要两位字母');
  const phone = cleanText(value.phone, '联系电话', 40);
  ensure(/^[+\d ()-]+$/.test(phone) && phone.replace(/\D/g, '').length >= 5 && phone.replace(/\D/g, '').length <= 20 && !/\+/.test(phone.slice(1)), 'INVALID_ADDRESS', '请填写有效的联系电话');
  let province = cleanText(value.province, '省州地区', 80);
  if (countryCode === 'CN') {
    const match = provinceAliases.get(province);
    ensure(match, 'INVALID_ADDRESS', '请选择有效的中国大陆省区市');
    province = match.province;
  }
  return {
    recipient: cleanText(value.recipient, '收件人', 80), phone, countryCode, province,
    city: cleanText(value.city, '城市', 80),
    district: cleanText(value.district ?? '', '区县', 80, countryCode === 'CN'),
    addressLine: cleanText(value.addressLine, '详细地址', 240),
    postalCode: cleanText(value.postalCode ?? '', '邮政编码', 20, false)
  };
}

export function destinationForAddress(address) {
  if (address.countryCode !== 'CN') return 'other';
  return provinceAliases.get(address.province)?.destination ?? 'other';
}

export function getCustomerProfile(workspace) {
  return structuredClone(workspace.customerProfile ?? null);
}

export function saveCustomerProfile(workspace, payload, now) {
  ensure(typeof payload.setupCompleted === 'boolean', 'INVALID_PROFILE', '请明确资料设置状态');
  ensure(typeof payload.displayName === 'string' && payload.displayName.trim().length <= 80 && !/[\u0000-\u001f\u007f]/.test(payload.displayName), 'INVALID_PROFILE', '账号名称格式无效');
  ensure(Object.prototype.hasOwnProperty.call(payload, 'shippingAddress'), 'INVALID_PROFILE', '请提供收货地址或明确选择稍后填写');
  const shippingAddress = payload.shippingAddress === null ? null : normalizeShippingAddress(payload.shippingAddress);
  const previous = workspace.customerProfile;
  const changed = JSON.stringify(previous?.shippingAddress ?? null) !== JSON.stringify(shippingAddress);
  const profile = {
    displayName: payload.displayName.trim(), setupCompleted: payload.setupCompleted,
    shippingAddress, addressRevision: (previous?.addressRevision ?? 0) + (changed ? 1 : 0),
    destination: shippingAddress ? destinationForAddress(shippingAddress) : null,
    createdAt: previous?.createdAt ?? now, updatedAt: now
  };
  workspace.customerProfile = profile;
  return { profile: structuredClone(profile) };
}

export function requireShippingAddress(workspace) {
  const profile = workspace.customerProfile;
  ensure(profile?.shippingAddress, 'ADDRESS_REQUIRED', '测算费用前，请先填写收货地址', 409);
  const address = normalizeShippingAddress(profile.shippingAddress);
  return { address, addressRevision: profile.addressRevision, destination: destinationForAddress(address) };
}
