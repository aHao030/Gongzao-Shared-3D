// Keep the item selected before sign-in. Only inbox paths and display choices
// are carried over; authorization and the model are resolved after login.
export function hasPlatformRoutes(doc = globalThis.document) {
  return Boolean(doc?.querySelector('meta[name="platform-routes"][content="enabled"]'));
}

export function tradeInboxHref(role, choices, routed = true) {
  const merchant = role === 'merchant';
  const params = new URLSearchParams(choices);
  params.delete('role');
  if (!routed) params.set('role', merchant ? 'merchant' : 'buyer');
  const path = routed ? (merchant ? '/merchant/messages' : '/messages') : './trade.html';
  const query = params.toString();
  return query ? path + '?' + query : path;
}

export function tradeInboxRole(pathname, search) {
  if (pathname.replace(/\/$/, '') === '/merchant/messages') return 'merchant';
  return pathname.endsWith('/trade.html') && new URLSearchParams(search).get('role') === 'merchant' ? 'merchant' : 'buyer';
}

export function tradeReturnPath(value) {
  if (typeof value !== 'string' || value.length > 640 || /[#\\\u0000-\u001f\u007f]/.test(value)) return null;
  const split = value.indexOf('?');
  const path = (split < 0 ? value : value.slice(0, split)).replace(/\/$/, '');
  if (path !== '/messages' && path !== '/merchant/messages') return null;
  const inputs = new URLSearchParams(split < 0 ? '' : value.slice(split + 1));
  const choices = new URLSearchParams();
  const identifiers = /^[a-zA-Z0-9_-]{1,128}$/;
  const rules = {modelId:identifiers, shopId:identifiers, thread:identifiers, qty:/^(?:[1-9]|[1-4][0-9]|50)$/,
    material:/^[A-Z][A-Z0-9_-]{0,23}$/, quality:/^(standard|fine)$/, unit:/^(mm|inch)$/};
  for (const [key, pattern] of Object.entries(rules)) {
    const values = inputs.getAll(key);
    if (values.length === 1 && pattern.test(values[0])) choices.set(key, values[0]);
  }
  const query = choices.toString();
  return query ? path + '?' + query : path;
}
