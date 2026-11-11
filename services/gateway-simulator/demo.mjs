import { GatewaySimulator, signDemoEnvelope, fileHash } from './index.mjs';
import { createQuote } from '../../packages/domain/index.mjs';

const secret = 'local-demo-secret-not-for-production';
const gateway = new GatewaySimulator(secret), quote = createQuote({});
const now = Date.now(), bytes = Buffer.from('NON_EXECUTABLE_DEMO_FIXTURE');
const common = { attemptId: 'attempt-demo-1', orderId: 'order-demo-1', machineId: 'simulator-1', leaseToken: 'demo-lease', issuedAt: now, expiresAt: now + 30000, fileSha256: fileHash(bytes), modelHash: quote.modelHash, profileVersion: quote.profileVersion, recipeVersion: quote.recipeVersion, quoteFingerprint: quote.fingerprint };
const context = { now, machineId: common.machineId, lease: { token: common.leaseToken, orderId: common.orderId, expiresAt: now + 30000 }, bytes,
  readiness: { online: true, bedClear: true, operatorReady: true, noFault: true, doorInterlockOk: true, sufficientMaterial: true, modelHash: common.modelHash, profileVersion: common.profileVersion, recipeVersion: common.recipeVersion, observedAt: now } };
console.log(gateway.execute(signDemoEnvelope({ ...common, commandId: 'upload-demo-1', action: 'UPLOAD_DEMO' }, secret), context));
const start = signDemoEnvelope({ ...common, commandId: 'start-demo-1', action: 'START_DEMO' }, secret);
console.log(gateway.execute(start, { ...context, simulateTimeout: true }));
console.log(gateway.execute(start, context)); // Duplicate returns the original unknown outcome; it cannot start twice.
console.log(gateway.reconcile(common.attemptId, { attemptId: common.attemptId, fileSha256: common.fileSha256, state: 'RUNNING' }));
console.log({ simulatedStartCount: gateway.simulatedStartCount, physicalCommandsSent: 0 });
