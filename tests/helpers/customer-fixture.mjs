// Synthetic test-only shipping details; never sent to an external service.
export function customerProfileFixture(overrides = {}) {
  const profile = {
    displayName: '测试用户',
    setupCompleted: true,
    shippingAddress: {
      recipient: '测试收件人', phone: '13800000000', countryCode: 'CN',
      province: '浙江省', city: '杭州市', district: '西湖区',
      addressLine: '测试路1号', postalCode: ''
    }
  };
  const supplied = structuredClone(overrides);
  return { ...profile, ...supplied, shippingAddress: supplied.shippingAddress === null
    ? null : { ...profile.shippingAddress, ...(supplied.shippingAddress ?? {}) } };
}
