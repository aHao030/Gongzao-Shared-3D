import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { assert, fingerprint, readinessIssues, IdempotencyRegistry } from '../../packages/domain/index.mjs';

// This module has no HTTP, TCP, serial, printer SDK, file upload or process execution.
// Its only side effect is changing in-memory simulation records.
export const fileHash = bytes => createHash('sha256').update(bytes).digest('hex');
function signature(payload, secret) { return createHmac('sha256', secret).update(fingerprint(payload)).digest('hex'); }
export function signDemoEnvelope(payload, secret) { return { payload, signature: signature(payload, secret) }; }

export class GatewaySimulator {
  #secret; #commands = new IdempotencyRegistry(); #attempts = new Map(); #machines = new Map();
  simulatedStartCount = 0;
  constructor(secret) { assert(typeof secret === 'string' && secret.length >= 16, 'WEAK_DEMO_SECRET', '演示密钥至少 16 个字符'); this.#secret = secret; }
  execute(envelope, context = {}) {
    const { payload, signature: supplied = '' } = envelope;
    const computed = signature(payload, this.#secret);
    assert(/^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(computed), Buffer.from(supplied)), 'INVALID_SIGNATURE', '签名不匹配');
    const now = context.now ?? Date.now();
    assert(now >= payload.issuedAt && now < payload.expiresAt, 'EXPIRED_COMMAND', '指令已过期或尚未生效');
    assert(['UPLOAD_DEMO', 'START_DEMO'].includes(payload.action), 'UNSUPPORTED_ACTION', '仅支持模拟操作');
    assert(context.lease?.token === payload.leaseToken && context.lease?.orderId === payload.orderId && context.lease.expiresAt > now, 'INVALID_LEASE', '派发租约不匹配或已过期');
    assert(context.machineId === payload.machineId, 'WRONG_MACHINE', '目标机器不匹配');
    return this.#commands.run(payload.commandId, payload, () => {
      if (payload.action === 'UPLOAD_DEMO') {
        assert(fileHash(context.bytes ?? '') === payload.fileSha256, 'FILE_HASH_MISMATCH', '文件完整性校验失败');
        assert(!this.#attempts.has(payload.attemptId), 'ATTEMPT_EXISTS', '同一生产尝试不能替换文件');
        const record = { state: 'UPLOADED', payload: { ...payload } };
        this.#attempts.set(payload.attemptId, record);
        return { mode: 'SIMULATED_NO_DEVICE_COMMANDS', state: record.state, attemptId: payload.attemptId };
      }
      const attempt = this.#attempts.get(payload.attemptId);
      assert(attempt?.state === 'UPLOADED', 'START_NOT_ALLOWED', '该任务未上传，或已经启动/状态未知');
      const machine = this.#machines.get(payload.machineId);
      assert(!machine?.activeAttemptId, 'MACHINE_OCCUPIED', '设备仍由其他生产尝试占用，租约变化不能释放物理占用');
      for (const field of ['fileSha256', 'orderId', 'machineId', 'modelHash', 'profileVersion', 'recipeVersion', 'quoteFingerprint']) {
        assert(attempt.payload[field] === payload[field], 'ATTEMPT_CHANGED', `生产尝试的 ${field} 发生变化`);
      }
      const issues = readinessIssues(context.readiness ?? {}, { ...payload, now });
      assert(issues.length === 0, 'NOT_READY', `本地准备条件不满足：${issues.join(', ')}`);
      if (machine?.clearanceId) {
        assert(context.readiness.clearanceId === machine.clearanceId && context.readiness.observedAt >= machine.clearedAt, 'STALE_CLEARANCE', '必须使用上次取件清台之后的新就绪确认');
      }
      this.simulatedStartCount += 1;
      attempt.state = context.simulateTimeout ? 'EXECUTION_UNKNOWN' : 'RUNNING';
      this.#machines.set(payload.machineId, { ...machine, activeAttemptId: payload.attemptId, state: attempt.state, startedReadinessAt: context.readiness.observedAt });
      return { mode: 'SIMULATED_NO_DEVICE_COMMANDS', state: attempt.state, attemptId: payload.attemptId };
    });
  }
  reconcile(attemptId, evidence) {
    const attempt = this.#attempts.get(attemptId);
    assert(attempt?.state === 'EXECUTION_UNKNOWN', 'RECONCILIATION_NOT_REQUIRED', '仅未知执行状态可核对');
    assert(evidence.attemptId === attemptId && evidence.fileSha256 === attempt.payload.fileSha256, 'INSUFFICIENT_EVIDENCE', '任务身份不能确认');
    assert(['RUNNING', 'STOP_CONFIRMED'].includes(evidence.state), 'INSUFFICIENT_EVIDENCE', '需明确运行中或已确认停止的证据');
    const machine = this.#machines.get(attempt.payload.machineId);
    assert(machine?.activeAttemptId === attemptId, 'RESOURCE_OWNER_MISMATCH', '设备占用身份不匹配');
    attempt.state = evidence.state;
    machine.state = evidence.state;
    return { mode: 'SIMULATED_NO_DEVICE_COMMANDS', state: attempt.state, attemptId };
  }
  reportCompletion(attemptId, evidence) {
    const attempt = this.#attempts.get(attemptId);
    assert(attempt?.state === 'RUNNING', 'COMPLETION_NOT_ALLOWED', '只有运行中任务可以报告完成');
    assert(evidence.attemptId === attemptId && evidence.fileSha256 === attempt.payload.fileSha256, 'INSUFFICIENT_EVIDENCE', '完成事件需匹配任务身份');
    const machine = this.#machines.get(attempt.payload.machineId);
    assert(machine?.activeAttemptId === attemptId, 'RESOURCE_OWNER_MISMATCH', '设备占用身份不匹配');
    attempt.state = 'WAITING_REMOVAL'; machine.state = 'WAITING_REMOVAL';
    return { mode: 'SIMULATED_NO_DEVICE_COMMANDS', state: attempt.state, attemptId };
  }
  confirmClearance(attemptId, evidence, now = Date.now()) {
    const attempt = this.#attempts.get(attemptId);
    assert(['WAITING_REMOVAL', 'STOP_CONFIRMED'].includes(attempt?.state), 'CLEARANCE_NOT_ALLOWED', '未完成或未确认停止不能清台释放');
    const machine = this.#machines.get(attempt.payload.machineId);
    assert(machine?.activeAttemptId === attemptId, 'RESOURCE_OWNER_MISMATCH', '只能释放自己的物理任务');
    assert(evidence.partRemoved === true && evidence.bedClear === true && typeof evidence.clearanceId === 'string' && evidence.clearanceId.length > 0 && evidence.clearanceId !== machine.clearanceId, 'CLEARANCE_REQUIRED', '需新的取件与清台确认事件');
    assert(Number.isFinite(evidence.observedAt) && evidence.observedAt > machine.startedReadinessAt && evidence.observedAt <= now && now - evidence.observedAt <= 10000, 'STALE_CLEARANCE', '清台确认必须发生于本任务开始之后且仍新鲜');
    attempt.state = 'CLEARED';
    this.#machines.set(attempt.payload.machineId, { activeAttemptId: null, state: 'IDLE', clearanceId: evidence.clearanceId, clearedAt: evidence.observedAt });
    return { mode: 'SIMULATED_NO_DEVICE_COMMANDS', state: 'IDLE', machineId: attempt.payload.machineId, clearanceId: evidence.clearanceId };
  }
  getState(attemptId) { return this.#attempts.get(attemptId)?.state ?? null; }
}
