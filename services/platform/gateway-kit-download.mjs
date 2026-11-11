import { staticAssetResponse } from './http.mjs';

export const gatewayKitPath = '/downloads/gongzao-bambu-gateway.zip';
export function gatewayKitResponse(bytes,size) {
  const response = staticAssetResponse(bytes,'application/zip',gatewayKitPath);
  response.headers.set('Content-Disposition','attachment; filename="gongzao-bambu-gateway.zip"');
  response.headers.set('Content-Length',String(size));
  return response;
}
