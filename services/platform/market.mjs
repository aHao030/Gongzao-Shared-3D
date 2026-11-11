// A display and validation catalogue, not a payment-provider eligibility check.
// Address field conventions are based on Google libaddressinput country metadata:
// https://github.com/google/libaddressinput/wiki/AddressValidationMetadata
// https://github.com/google/libaddressinput/blob/master/common/src/main/java/com/google/i18n/addressinput/common/RegionDataConstants.java
// All provider methods remain unconfigured; no exchange rates or shipping rates
// are inferred from a delivery country.
export const ADDRESS_SCHEMA_VERSION = 1;
export const MARKET_SCHEMA_VERSION = 1;
export const ACCOUNTING_CURRENCY = 'CNY';

const optional = (label, placeholder = '') => ({ label, placeholder, required: false, visible: true });
const required = (label, placeholder = '') => ({ ...optional(label, placeholder), required: true });
const hidden = label => ({ ...optional(label), visible: false });
const baseFields = () => ({
  recipient: required('收件人 / Recipient'),
  phone: required('联系电话 / Phone'),
  countryCode: required('国家或地区 / Country or region'),
  province: optional('省、州或地区 / State or region'),
  city: required('城市 / City'),
  district: optional('区县 / District'),
  addressLine: required('街道、门牌及房间 / Street address'),
  postalCode: optional('邮政编码 / Postal code')
});

const methodLabels = {
  wechat_pay: '微信支付', alipay: '支付宝', unionpay: '银联',
  cards: '信用卡 / 借记卡', paypal: 'PayPal', apple_pay: 'Apple Pay', google_pay: 'Google Pay'
};
const internationalMethods = ['cards', 'paypal', 'apple_pay', 'google_pay'];
const definitions = [
  // Country-specific field overrides are deliberately explicit so the client
  // form and the save endpoint use exactly the same required/visible rules.
  { countryCode: 'CN', name: '中国大陆', nameEn: 'China mainland', phonePrefix: '+86', referenceCurrency: 'CNY',
    fields: { recipient: required('收件人'), phone: required('联系电话'), countryCode: required('国家或地区'), province: required('省 / 直辖市 / 自治区'), city: required('城市'), district: required('区 / 县'), addressLine: required('详细地址', '街道、门牌、楼栋和房间'), postalCode: optional('邮政编码（选填）') },
    order: ['province', 'city', 'district', 'addressLine', 'postalCode'], methods: ['wechat_pay', 'alipay', 'unionpay', 'cards'],
    note: '中国大陆地址按省、市、区县填写；邮编目前选填。' },
  { countryCode: 'HK', name: '中国香港', nameEn: 'Hong Kong', phonePrefix: '+852', referenceCurrency: 'HKD',
    fields: { province: required('区域 / Area', '香港岛、九龙或新界'), city: optional('地区 / District'), district: hidden('区县'), postalCode: hidden('邮政编码') },
    order: ['province', 'city', 'addressLine'], methods: ['cards', 'alipay', 'wechat_pay', 'paypal', 'apple_pay'],
    note: '香港地址不需要邮政编码。请在详细地址填写街道、楼宇、楼层和单位。' },
  { countryCode: 'MO', name: '中国澳门', nameEn: 'Macao', phonePrefix: '+853', referenceCurrency: 'MOP',
    fields: { province: hidden('省州'), city: hidden('城市'), district: hidden('区县'), postalCode: hidden('邮政编码') },
    order: ['addressLine'], methods: ['cards', 'alipay', 'wechat_pay'],
    note: '澳门地址不需要邮政编码；请在详细地址填写区域、街道、楼宇和单位。' },
  { countryCode: 'TW', name: '中国台湾', nameEn: 'Taiwan', phonePrefix: '+886', referenceCurrency: 'TWD',
    fields: { province: required('县 / 市'), city: required('乡 / 镇 / 市 / 区'), district: hidden('区县'), postalCode: required('邮递区号') }, order: ['postalCode', 'province', 'city', 'addressLine'] },
  { countryCode: 'US', name: '美国', nameEn: 'United States', phonePrefix: '+1', referenceCurrency: 'USD',
    fields: { province: required('州 / State'), district: hidden('区县'), postalCode: required('ZIP code', '例如 94105 或 94105-1234') } },
  { countryCode: 'CA', name: '加拿大', nameEn: 'Canada', phonePrefix: '+1', referenceCurrency: 'CAD',
    fields: { province: required('省 / 地区 / Province or territory'), district: hidden('区县'), postalCode: required('Postal code', '例如 K1A 0B1') } },
  { countryCode: 'GB', name: '英国', nameEn: 'United Kingdom', phonePrefix: '+44', referenceCurrency: 'GBP',
    fields: { province: optional('郡 / County（选填）'), district: hidden('区县'), city: required('城镇 / Post town'), postalCode: required('Postcode', '例如 SW1A 1AA') } },
  { countryCode: 'DE', name: '德国', nameEn: 'Germany', phonePrefix: '+49', referenceCurrency: 'EUR',
    fields: { province: hidden('州'), district: hidden('区县'), postalCode: required('邮政编码 / Postleitzahl') }, order: ['addressLine', 'postalCode', 'city'] },
  { countryCode: 'FR', name: '法国', nameEn: 'France', phonePrefix: '+33', referenceCurrency: 'EUR',
    fields: { province: hidden('大区'), district: hidden('区县'), postalCode: required('邮政编码 / Code postal') }, order: ['addressLine', 'postalCode', 'city'] },
  { countryCode: 'AU', name: '澳大利亚', nameEn: 'Australia', phonePrefix: '+61', referenceCurrency: 'AUD',
    fields: { province: required('州 / 领地 / State or territory'), city: required('城区 / Suburb or city'), district: hidden('区县'), postalCode: required('Postcode') } },
  { countryCode: 'NZ', name: '新西兰', nameEn: 'New Zealand', phonePrefix: '+64', referenceCurrency: 'NZD',
    fields: { province: hidden('大区'), district: required('城区 / 乡村投递区 / Suburb or rural delivery area'), postalCode: required('Postcode') }, order: ['addressLine', 'district', 'city', 'postalCode'] },
  { countryCode: 'JP', name: '日本', nameEn: 'Japan', phonePrefix: '+81', referenceCurrency: 'JPY',
    fields: { province: required('都 / 道 / 府 / 县'), city: optional('市 / 区 / 町 / 村'), district: hidden('区县'), postalCode: required('邮政编码', '例如 100-0001') }, order: ['postalCode', 'province', 'city', 'addressLine'] },
  { countryCode: 'KR', name: '韩国', nameEn: 'South Korea', phonePrefix: '+82', referenceCurrency: 'KRW',
    fields: { province: required('道 / 特别市 / 广域市'), city: required('市 / 郡 / 区'), district: hidden('区县'), postalCode: required('邮政编码') }, order: ['postalCode', 'province', 'city', 'addressLine'] },
  { countryCode: 'SG', name: '新加坡', nameEn: 'Singapore', phonePrefix: '+65', referenceCurrency: 'SGD',
    fields: { province: hidden('省州'), city: hidden('城市'), district: hidden('区县'), postalCode: required('Postal code', '例如 018956') }, order: ['addressLine', 'postalCode'] },
  { countryCode: 'MY', name: '马来西亚', nameEn: 'Malaysia', phonePrefix: '+60', referenceCurrency: 'MYR',
    fields: { province: optional('州 / State（选填）'), district: hidden('区县'), postalCode: required('Postcode') } },
  { countryCode: 'TH', name: '泰国', nameEn: 'Thailand', phonePrefix: '+66', referenceCurrency: 'THB',
    fields: { province: optional('府 / Province（选填）'), city: required('县 / 区 / District'), district: optional('乡 / 分区 / Subdistrict'), postalCode: optional('邮政编码（选填）') }, order: ['addressLine', 'district', 'city', 'province', 'postalCode'] },
  { countryCode: 'OTHER', name: '其他国家或地区', nameEn: 'Other country or region', phonePrefix: '+', referenceCurrency: null,
    fields: { province: optional('省、州或地区（如适用）'), city: optional('城市（如适用）'), district: optional('区县（如适用）'), postalCode: optional('邮政编码（如适用）') },
    note: '请填写实际两位国家或地区代码，并按当地投递习惯填写完整地址；价格、国际运费和交期需要人工确认。' }
];

function buildMarket(definition, countryCode = definition.countryCode) {
  const { fields: overrides = {}, order, methods = internationalMethods, note, ...identity } = definition;
  const fields = { ...baseFields(), ...structuredClone(overrides) };
  fields.phone.placeholder = definition.phonePrefix === '+' ? '请包含国际区号，例如 +…' : `国际区号参考 ${definition.phonePrefix}；不会自动修改已填号码`;
  const fieldOrder = ['recipient', 'phone', 'countryCode', ...(order ?? ['addressLine', 'city', 'district', 'province', 'postalCode'])].filter(key => fields[key].visible);
  const payment = {
    countryCode, referenceCurrency: definition.referenceCurrency, accountingCurrency: ACCOUNTING_CURRENCY,
    exchangeRate: null, livePaymentsEnabled: false,
    methods: methods.map(id => ({ id, label: methodLabels[id], status: 'NOT_CONFIGURED', enabled: false })),
    note: '支付方式为待接入规划，尚不能真实收款。是否可用取决于支付服务商、商户所在地、币种和审核结果；收货国家不代表支付资格。当前演示金额仅以 CNY 记账，不做汇率换算。'
  };
  return {
    ...identity, countryCode,
    address: { fieldOrder, fields, note: note ?? '请按当地投递习惯填写；国际运费、关税和交期将在工程询价后确认。' },
    payment
  };
}

export function getMarket(countryCode = 'CN') {
  const normalized = typeof countryCode === 'string' ? countryCode.toUpperCase() : 'OTHER';
  const definition = definitions.find(market => market.countryCode === normalized) ?? definitions.at(-1);
  return buildMarket(definition, /^[A-Z]{2}$/.test(normalized) ? normalized : definition.countryCode);
}

export function getMarketCatalog(countryCode) {
  const base = { schemaVersion: MARKET_SCHEMA_VERSION, accountingCurrency: ACCOUNTING_CURRENCY };
  if (countryCode !== undefined) return { ...base, market: getMarket(countryCode), countries: definitions.map(({ countryCode, name }) => ({ countryCode, name })) };
  return { ...base, markets: definitions.map(definition => buildMarket(definition)) };
}

export function quoteMarketContext(address, review) {
  const market = getMarket(address.countryCode);
  return {
    market: { countryCode: address.countryCode, name: market.name, referenceCurrency: market.referenceCurrency, accountingCurrency: ACCOUNTING_CURRENCY },
    paymentContext: { ...market.payment, payable: false, action: review ? 'REQUEST_REVIEW' : 'SIMULATE_ORDER', priceStatus: review ? 'REVIEW_REQUIRED' : 'SANDBOX_ESTIMATE' }
  };
}
