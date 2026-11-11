import { ApiError, ensure } from './geometry.mjs';
import { readJsonObject, jsonResponse } from './http-io.mjs';
import { createTradeStore } from './trade-store.mjs';

const PREFIX = '/api/v2/trade';
const privateHeaders = { 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' };
const reply = (result, status = 200) => jsonResponse(result, status, privateHeaders);

function options(url, allowed, numbers = []) {
  const result = Object.create(null);
  for (const [name, value] of url.searchParams) {
    ensure(allowed.includes(name) && !Object.hasOwn(result,name) && value.length <= 256,
      400,'TRADE_QUERY_INVALID','分页或筛选条件无效');
    if (numbers.includes(name)) {
      ensure(/^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)),
        400,'TRADE_CURSOR_INVALID','消息序号无效');
      result[name] = Number(value);
    } else {
      result[name] = value;
    }
  }
  return result;
}

export async function handleTradeRequest(request, {store, actor, clock, workspaceContext}) {
  const url = new URL(request.url);
  const route = url.pathname.slice(PREFIX.length);
  const origin = request.headers.get('origin');
  ensure(request.headers.get('sec-fetch-site') !== 'cross-site' && (!origin || origin === url.origin),
    403,'CROSS_ORIGIN_DENIED','请从本平台打开会话');
  const trade = createTradeStore({store,clock});
  if (request.method === 'GET' && route === '/shops') {
    return reply(await trade.shops(actor, options(url,['before'])));
  }
  ensure(actor,401,'ACCOUNT_LOGIN_REQUIRED','请先登录共造账号，再使用询价消息');
  ensure(workspaceContext && request.headers.get('X-Gongzao-Workspace') === workspaceContext,
    409,'WORKSPACE_CHANGED','账号已切换或页面已过期，请刷新后重试');
  const thread = /^\/threads\/([a-zA-Z0-9_-]{1,128})(?:\/(file|messages|offers|accept|read|sharing))?$/.exec(route);
  const id = thread?.[1], action = thread?.[2];

  if (request.method === 'GET') {
    if (route === '/shop') return reply(await trade.myShop(actor));
    if (route === '/threads') return reply(await trade.inbox(actor,options(url,['role','before'])));
    if (id && !action) return reply(await trade.detail(actor,id,options(url,['before','after'],['before','after'])));
    if (id && action === 'file') {
      const file = await trade.download(actor,id);
      return new Response(file.bytes, {headers:{
        ...privateHeaders, 'Content-Type':'application/octet-stream', 'X-Content-Type-Options':'nosniff',
        'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())
      }});
    }
  } else if (request.method === 'POST') {
    const key = request.headers.get('Idempotency-Key');
    ensure(typeof key === 'string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(key),
      400,'IDEMPOTENCY_REQUIRED','请提供有效的请求标识');
    const payload = await readJsonObject(request,16384);
    if (route === '/shop') return reply(await trade.publish(actor,payload,key));
    if (route === '/threads') return reply(await trade.open(actor,payload,key));
    if (id && action === 'messages') return reply(await trade.send(actor,id,payload,key));
    if (id && action === 'offers') return reply(await trade.offer(actor,id,payload,key));
    if (id && action === 'accept') return reply(await trade.accept(actor,id,payload,key));
    if (id && action === 'read') return reply(await trade.read(actor,id,payload));
    if (id && action === 'sharing') return reply(await trade.sharing(actor,id,payload,key));
  } else {
    throw new ApiError(405,'METHOD_NOT_ALLOWED','此会话接口不支持该方法');
  }
  throw new ApiError(404,'NOT_FOUND','会话接口不存在');
}
