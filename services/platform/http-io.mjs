import { ApiError, ensure } from './geometry.mjs';

const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};

export async function readLimited(request,limit) {
  const length=Number(request.headers.get('content-length'));
  ensure(!Number.isFinite(length)||length<=limit,413,'BODY_TOO_LARGE','请求数据超过当前大小限制');
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader(),chunks=[];let size=0;
  try { for(;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','请求数据超过当前大小限制');}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}return bytes;
}
export function jsonResponse(data,status=200,extra={}) {return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extra}});}

export async function readJsonObject(request, limit) {
  ensure(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json',
    415, 'INVALID_CONTENT_TYPE', '请提交 JSON 对象');
  const bytes = await readLimited(request, limit);
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new ApiError(400,'INVALID_JSON','请求内容不是有效的 JSON'); }
  ensure(data && typeof data === 'object' && !Array.isArray(data),400,'INVALID_PAYLOAD','请求内容必须为对象');
  return data;
}
