// Shared server-side analysis. This is geometry validation, not a certified slicer.
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const ensure = (value, status, code, message) => { if (!value) throw new ApiError(status, code, message); };
export const CURRENT_MESH_ANALYSIS = 'stl-server-v3';
export function needsMeshAnalysis(model) {
  return model?.format === 'stl' && !model.isSample && model.analysisVersion !== CURRENT_MESH_ANALYSIS;
}
export function modelForPricing(model) {
  if (!needsMeshAnalysis(model)) return model;
  return { ...model, volume: 0, review: true, analysisNote: '旧版几何数据需要重新解析，请重新上传同名 STL，或请商家审核原件后报价。' };
}
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}
export async function analyzeModel(bytes, rawName) {
  const name = String(rawName).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180);
  ensure(name && !/[\\/]/.test(name), 400, 'INVALID_FILENAME', '文件名不能包含路径分隔符');
  const format = name.split('.').pop().toLowerCase();
  ensure(['stl','step','stp','3mf','png','jpg','jpeg','webp'].includes(format), 415, 'UNSUPPORTED_FORMAT', '支持 STL、STEP、STP、3MF 及 PNG/JPG/WebP 设计图；图片仅进入工程审核');
  ensure(bytes.byteLength > 0, 400, 'EMPTY_FILE', '文件不能为空');
  const hash = await sha256(bytes);
  const id = 'mdl_' + (await sha256(new TextEncoder().encode(hash + ':' + name))).slice(0, 32);
  const base = { id, name, size: bytes.byteLength, sha256: hash, format, analysisVersion: format === 'stl' ? CURRENT_MESH_ANALYSIS : 'stl-server-v2', dimensions: [], volume: 0, closed: false, review: true };
  if (format !== 'stl') return base;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = 0, binary = false;
  if (bytes.byteLength >= 84) { count = view.getUint32(80,true); binary = count > 0 && 84 + count * 50 === bytes.byteLength; }
  const LIMIT = 50000;
  let triangles;
  if (binary) {
    ensure(count <= LIMIT, 413, 'MODEL_TOO_COMPLEX', '当前服务端支持最多 50,000 个三角面，请先简化模型');
    triangles = Array.from({length:count}, (_,i) => Array.from({length:3}, (_,j) => Array.from({length:3},(_,k) => view.getFloat32(84+i*50+12+j*12+k*4,true))));
  } else {
    ensure(bytes.byteLength <= 8*1024*1024, 413, 'ASCII_STL_TOO_LARGE', 'ASCII STL 最大 8 MiB，请转换为二进制或简化');
    const source = new TextDecoder('utf-8',{fatal:false}).decode(bytes);
    ensure(/^\s*solid\b/i.test(source) && /endsolid\b/i.test(source), 422, 'INVALID_STL', 'STL 格式不完整');
    const vertices = [];
    for (const m of source.matchAll(/\bvertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)) {
      vertices.push(m.slice(1).map(Number));
      ensure(vertices.length <= LIMIT*3, 413, 'MODEL_TOO_COMPLEX', '当前服务端支持最多 50,000 个三角面');
    }
    ensure(vertices.length > 0 && vertices.length%3 === 0, 422, 'INVALID_STL', 'STL 顶点数无效');
    triangles = Array.from({length:vertices.length/3}, (_,i) => vertices.slice(i*3,i*3+3));
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const edges = new Map(), parents = triangles.map((_, i) => i);
  function component(face) {
    while (face !== parents[face]) {
      parents[face] = parents[parents[face]];
      face = parents[face];
    }
    return face;
  }
  let degenerate = false;
  for (const [index, vertices] of triangles.entries()) {
    for (const point of vertices) for (let axis = 0; axis < 3; axis++) {
      ensure(Number.isFinite(point[axis]) && Math.abs(point[axis]) <= 1e6, 422, 'INVALID_COORDINATE', '模型包含无效或过大的坐标');
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
    const [a, b, c] = vertices, u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
    if (Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) < 1e-10) degenerate = true;
    const points = vertices.map(p => p.map(n => n.toFixed(5)).join(','));
    for (let i = 0; i < 3; i++) {
      const x = points[i], y = points[(i + 1) % 3], key = x < y ? x + '|' + y : y + '|' + x;
      const edge = edges.get(key) ?? { count: 0, balance: 0, face: index };
      parents[component(index)] = component(edge.face);
      edge.count++;
      edge.balance += x < y ? 1 : -1;
      edges.set(key, edge);
    }
  }
  const dimensions = max.map((n, i) => n - min[i]);
  ensure(dimensions.every(n => n > 0 && n <= 1e6), 422, 'INVALID_DIMENSIONS', '模型缺少有效三维尺寸');

  // A per-shell reference avoids catastrophic cancellation far from the origin.
  const shellVolumes = new Map();
  for (const [index, vertices] of triangles.entries()) {
    const shell = component(index), origin = triangles[shell][0];
    const [a, b, c] = vertices.map(point => point.map((n, axis) => n - origin[axis]));
    const sixVolume = a[0]*(b[1]*c[2]-b[2]*c[1]) + a[1]*(b[2]*c[0]-b[0]*c[2]) + a[2]*(b[0]*c[1]-b[1]*c[0]);
    shellVolumes.set(shell, (shellVolumes.get(shell) ?? 0) + sixVolume);
  }
  const signed = [...shellVolumes.values()];
  const volume = Math.abs(signed.reduce((sum, n) => sum + n, 0)) / 6000;
  const mixedWinding = signed.some(n => n < 0) && signed.some(n => n > 0);
  const closed = !degenerate && [...edges.values()].every(edge => edge.count === 2 && edge.balance === 0);
  const analysisNote = mixedWinding ? '多个封闭曲面的绕向不同，需要确认内腔与独立实体后估算用量。' : '单位需由客户确认；未验证自相交、壁厚、公差或切片可制造性';
  return { ...base, dimensions, volume, closed, review: !closed || mixedWinding || volume <= 0, faceCount: triangles.length, analysisNote };
}
