import { ApiError } from './geometry.mjs';
import { WORKSPACE_QUOTE_PREFIX } from './workspace-storage.mjs';

const WORKSPACE_LIMIT = 32;

// Only a bounded set of row IDs and the platform-owned order states are examined.
// The database returns one aggregate row. Addresses, account identities, financial
// amounts, models and gzip quote history do not cross this reporting boundary.
// The packed format leaves orders in the plain state section.
const query = `
  WITH candidates AS MATERIALIZED (
    SELECT rowid AS rid FROM platform_workspaces ORDER BY rowid DESC LIMIT ?1
  ),
  sample AS (
    SELECT rid FROM candidates ORDER BY rid DESC LIMIT ?2
  ),
  documents AS (
    SELECT CASE WHEN substr(w.data, 1, length(?3)) = ?3 THEN substr(w.data, length(?3) + 1) ELSE w.data END AS doc,
           CASE WHEN substr(w.data, 1, length(?3)) = ?3 THEN '$.state.orders' ELSE '$.orders' END AS orders_path
    FROM sample JOIN platform_workspaces w ON w.rowid = sample.rid
  ),
  lists AS MATERIALIZED (
    SELECT CASE WHEN json_type(doc, orders_path) = 'array' THEN json_extract(doc, orders_path) END AS orders
    FROM documents
  ),
  states AS (
    SELECT item.type AS item_type, item.value ->> '$.status' AS status,
           item.value ->> '$.productionState' AS production,
           item.value ->> '$.paymentState' AS payment,
           item.value ->> '$.logisticsState' AS logistics,
           item.value ->> '$.refundState' AS refund,
           COALESCE((item.value ->> '$.disputeState') = 'OPEN',
                    (item.value ->> '$.dispute') = 1, 0) AS disputed
    FROM lists, json_each(lists.orders) AS item
  )
  SELECT (SELECT count(*) FROM candidates) AS available,
         (SELECT count(*) FROM lists) AS scanned,
         (SELECT count(*) FROM lists WHERE orders IS NULL) AS invalid_workspaces,
         count(*) FILTER (WHERE item_type != 'object' OR (
           production IS NULL AND COALESCE(status NOT IN (
             'review','queued','printing','printed','awaiting_pickup','qc','qc_failed','ready','ready_to_ship',
             'shipped','delivered','accepted','settling','settlement_failed','refund_pending','refunded','settled','cancelled'
           ), 1)
         )) AS invalid_orders,
         count(*) AS orders,
         count(*) FILTER (WHERE COALESCE(refund = 'REQUESTED', status = 'refund_pending')) AS pending_refunds,
         count(*) FILTER (WHERE disputed) AS open_disputes,
         count(*) FILTER (
           WHERE COALESCE(production = 'QC_PASSED', status IN ('ready', 'ready_to_ship'))
             AND COALESCE(logistics = 'NONE', status IN ('ready', 'ready_to_ship'))
             AND COALESCE(payment = 'SIMULATED_FROZEN', status IN ('ready', 'ready_to_ship'))
             AND COALESCE(refund IN ('NONE', 'REJECTED'), status NOT IN ('refunded', 'refund_pending'))
             AND NOT disputed
         ) AS awaiting_shipment
  FROM states
`;

export async function readAdminBusiness(store, now = Date.now()) {
  // Authorization belongs to the admin HTTP router. This function only reads.
  try {
    const statement = store.db.prepare(query);
    const args = [WORKSPACE_LIMIT + 1, WORKSPACE_LIMIT, WORKSPACE_QUOTE_PREFIX];
    let row;
    if (store.kind === 'sqlite') row = statement.get(...args);
    else if (store.kind === 'd1') row = await statement.bind(...args).first();
    else throw new Error('Unsupported store');
    const counts = ['available','scanned','invalid_workspaces','invalid_orders','orders','pending_refunds','open_disputes','awaiting_shipment'];
    if (!row || counts.some(name => !Number.isSafeInteger(row[name]) || row[name] < 0)
        || row.invalid_workspaces || row.invalid_orders) throw new Error('Unusable workspace');
    return {
      summary: {
        workspaces: row.scanned,
        orders: row.orders,
        pendingRefunds: row.pending_refunds,
        openDisputes: row.open_disputes,
        awaitingShipment: row.awaiting_shipment
      },
      coverage: { scanned: row.scanned, limit: WORKSPACE_LIMIT, partial: row.available > row.scanned },
      asOf: now
    };
  } catch {
    throw new ApiError(503, 'ADMIN_BUSINESS_UNAVAILABLE', '业务统计暂时无法读取，请稍后重试。');
  }
}
