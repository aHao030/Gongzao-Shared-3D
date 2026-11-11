// Used by deployment health checks. All queries select constants or bounded
// control state; the response never includes workspace or database contents.
export async function readinessResponse(request, store, control) {
  const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status:405, headers:{...headers,Allow:'GET, HEAD'} });
  }
  let ready = false;
  try {
    if (store.kind === 'sqlite') {
      store.db.prepare('SELECT 1 FROM platform_workspaces LIMIT 1').get();
      store.db.prepare('SELECT 1 FROM local_model_files LIMIT 1').get();
    } else {
      await store.db.prepare('SELECT 1 FROM platform_workspaces LIMIT 1').first();
      // A missing sentinel is fine. An unavailable R2 binding throws.
      await store.bucket.head('gongzao-readiness/storage-probe');
    }
    await control.intakeStatus();
    ready = true;
  } catch {
    // The deployment operator can diagnose a failing binding separately.
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ready}), {status:ready ? 200 : 503,headers});
}
