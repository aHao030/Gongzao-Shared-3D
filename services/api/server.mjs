import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DEMO_CATALOG, DomainError, assert, createQuote, verifyQuote, transition, reserve, confirmReservation, canReleaseMachine, settlementEligibility, IdempotencyRegistry } from '../../packages/domain/index.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; assert(Buffer.byteLength(text) <= 16384, 'BODY_TOO_LARGE', '请求体超过 16 KiB'); }
  try { return text ? JSON.parse(text) : {}; } catch { throw new DomainError('INVALID_JSON', '请求体不是有效 JSON'); }
}
export function createDemoServer() {
  const quotes = new Map(), orders = new Map(), idempotency = new IdempotencyRegistry();
  const machines = new Map(Object.keys(DEMO_CATALOG.farms).map(farmId => [farmId, { id: `${farmId}-simulator`, state: 'IDLE', availableGrams: 5000, reservation: null }]));
  return http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, JSON_HEADERS); res.end(JSON.stringify({ mode: 'DEMO_ONLY_IN_MEMORY', ...data })); };
    try {
      // Loopback bind is mandatory. Host/Origin checks also block browser DNS-rebinding writes.
      assert(/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? ''), 'INVALID_HOST', '仅允许 localhost');
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        assert(['127.0.0.1', 'localhost'].includes(origin.hostname) && origin.port === String(serverPort(req)), 'CROSS_ORIGIN_DENIED', '不接受跨站请求');
      }
      const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname;
      if (req.method === 'GET' && path === '/health') return send(200, { ok: true, realPayments: false, realDevices: false, durableStorage: false });
      if (req.method === 'GET' && path === '/api/capabilities') return send(200, { catalog: DEMO_CATALOG, note: '全部为虚构演示参数。没有在线农场、设备或商业报价。' });
      if (req.method === 'POST' && path === '/api/quotes') {
        const input = await body(req), quote = createQuote(input);
        quotes.set(quote.quoteId, quote); return send(201, { quote });
      }
      if (req.method === 'POST' && path === '/api/orders') {
        const input = await body(req), key = req.headers['idempotency-key'];
        const result = idempotency.run(key, { path, input }, () => {
          const quote = quotes.get(input.quoteId); assert(quote, 'QUOTE_NOT_FOUND', '报价不存在');
          verifyQuote(quote, input.fingerprint);
          const orderId = randomUUID(), now = Date.now();
          // Approximate fixture density; not a material bill of quantities.
          const machine = reserve(machines.get(quote.farmId), orderId, DEMO_CATALOG.models[quote.modelId].volumeCm3 * 1.25 * quote.quantity, now);
          const order = { orderId, quote, machineId: machine.id, productionState: 'RESERVED', paymentState: 'UNPAID', acceptanceState: 'PENDING', logisticsState: 'NONE', settlementState: 'NOT_REQUESTED', disputeOpen: false, refundState: 'NONE', events: [{ action: 'reserve', at: now }] };
          machines.set(quote.farmId, machine); orders.set(orderId, order);
          return { order: structuredClone(order) };
        });
        return send(201, result);
      }
      const match = path.match(/^\/api\/orders\/([^/]+)(?:\/(actions|state))?$/);
      if (match) {
        const order = orders.get(match[1]); assert(order, 'ORDER_NOT_FOUND', '订单不存在');
        if (req.method === 'GET' && !match[2]) return send(200, { order, settlementGate: settlementEligibility(order) });
        if (req.method === 'POST' && match[2] === 'actions') {
          const input = await body(req), key = req.headers['idempotency-key'];
          const result = idempotency.run(key, { path, input }, () => {
            assert(input.demoAcknowledged === true, 'DEMO_ACK_REQUIRED', '必须明确确认演示操作');
            let machine = machines.get(order.quote.farmId);
            if (input.action === 'simulate-payment') {
              assert(order.productionState === 'RESERVED' && order.paymentState === 'UNPAID', 'PAYMENT_NOT_ALLOWED', '订单不能重复支付');
              machine = confirmReservation(machine, order.orderId);
              order.paymentState = 'PAID_FROZEN_DEMO'; order.productionState = transition(order.productionState, 'QUEUED');
            } else if (input.action === 'simulate-transition') {
              const next = transition(order.productionState, input.nextState);
              assert(!['QUEUED', 'CANCELLED', 'ACCEPTED'].includes(next), 'USE_EXPLICIT_ACTION', '请使用对应支付、取消或验收操作');
              if (next === 'STARTING') assert(input.readinessConfirmed === true, 'READINESS_REQUIRED', '模拟开机前也需明确确认本地就绪');
              if (next === 'STOP_CONFIRMED') assert(input.stopConfirmed === true, 'STOP_EVIDENCE_REQUIRED', '不能假定停机成功');
              if (next === 'QC_PENDING') {
                assert(input.partRemoved === true && input.bedClear === true, 'REMOVAL_REQUIRED', '需确认取件及清台');
                assert(machine.reservation?.orderId === order.orderId && machine.activeJobId === order.orderId, 'RESOURCE_OWNER_MISMATCH', '只有当前设备占用任务可以释放设备');
              }
              if (next === 'QC_PASSED') assert(input.qcPassed === true, 'QC_EVIDENCE_REQUIRED', '需确认质检通过');
                            order.productionState = next;
              if (['DISPATCHED', 'UPLOADED', 'READY', 'STARTING', 'RUNNING', 'PAUSED', 'EXECUTION_UNKNOWN', 'WAITING_REMOVAL', 'CANCEL_REQUESTED', 'FAILED', 'STOP_CONFIRMED'].includes(next)) machine = { ...machine, state: next, activeJobId: order.orderId };
              // Release only when the currently occupying attempt moves off the bed.
              // Later quality decisions on old order A must not clear a new order B.
              if (next === 'QC_PENDING' && canReleaseMachine(next, input)) machine = { ...machine, state: 'IDLE', activeJobId: null, reservation: null };
            } else if (input.action === 'simulate-cancel') {
              assert(['RESERVED', 'QUEUED', 'STOP_CONFIRMED'].includes(order.productionState), 'STOP_FIRST', '已派发任务需要先请求停止并确认');
              if (order.productionState === 'STOP_CONFIRMED') assert(input.bedClear === true, 'BED_NOT_CLEAR', '需确认清台');
              order.productionState = transition(order.productionState, 'CANCELLED');
              if (machine.reservation?.orderId === order.orderId) machine = { ...machine, state: 'IDLE', activeJobId: null, reservation: null };
              if (order.paymentState === 'PAID_FROZEN_DEMO') order.refundState = 'REVIEW_REQUIRED';
            } else if (input.action === 'simulate-shipment') {
              assert(order.productionState === 'QC_PASSED' && order.logisticsState === 'NONE', 'SHIPMENT_NOT_ALLOWED', '需质检通过且尚未发货');
              assert(typeof input.trackingNumber === 'string' && input.trackingNumber.startsWith('DEMO-'), 'DEMO_TRACKING_REQUIRED', '演示单号必须以 DEMO- 开头');
              order.logisticsState = 'SHIPPED'; order.trackingNumber = input.trackingNumber;
            } else if (input.action === 'simulate-delivery') {
              assert(order.logisticsState === 'SHIPPED', 'DELIVERY_NOT_ALLOWED', '需先模拟发货');
              order.logisticsState = 'DELIVERED';
            } else if (input.action === 'simulate-acceptance') {
              assert(input.customerAccepted === true, 'ACCEPTANCE_REQUIRED', '物流签收不能替代客户验收');
              assert(order.productionState === 'QC_PASSED' && order.logisticsState === 'DELIVERED' && order.acceptanceState === 'PENDING', 'ACCEPTANCE_NOT_ALLOWED', '需质检通过并已送达，且尚未验收');
              order.acceptanceState = 'ACCEPTED';
            } else if (input.action === 'simulate-dispute') {
              assert(order.settlementState === 'NOT_REQUESTED', 'ALREADY_SETTLED', '结算后的争议需要独立追偿流程');
              order.disputeOpen = true;
            } else if (input.action === 'simulate-settlement') {
              const gate = settlementEligibility(order); assert(gate.eligible, 'SETTLEMENT_BLOCKED', gate.reasons.join(', '));
              order.settlementState = 'SIMULATED_SETTLED';
            } else throw new DomainError('UNKNOWN_ACTION', '未知演示操作');
            machines.set(order.quote.farmId, machine);
            order.events.push({ action: input.action, state: order.productionState, at: Date.now() });
            return { order: structuredClone(order), physicalCommandsSent: 0, moneyTransferred: 0 };
          });
          return send(200, result);
        }
      }
      send(404, { error: { code: 'NOT_FOUND', message: '未找到接口' } });
    } catch (error) {
      const status = error instanceof DomainError ? 409 : 500;
      send(status, { error: { code: error.code ?? 'INTERNAL_ERROR', message: error instanceof DomainError ? error.message : '本地演示服务器错误' } });
    }
  });
}
function serverPort(req) { return req.socket.localPort; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.DEMO_API_PORT ?? 8787);
  assert(Number.isInteger(port) && port > 0 && port < 65536, 'INVALID_PORT', '端口无效');
  createDemoServer().listen(port, '127.0.0.1', () => console.log(`DEMO ONLY: http://127.0.0.1:${port} — memory resets on restart; no payment or printer commands.`));
}
