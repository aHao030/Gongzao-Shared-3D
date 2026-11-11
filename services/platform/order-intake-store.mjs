// Used inside the same SQLite/D1 statement that commits the order. No row yet
// means normal intake. Existing malformed flags fail closed.
export const openOrderIntakeSQL = `NOT EXISTS (
  SELECT 1 FROM platform_admin_control WHERE id = 1
    AND json_type(data, '$.intake') IS NOT NULL
    AND json_type(data, '$.intake.paused') IS NOT 'false'
)`;

const update = 'UPDATE platform_workspaces SET revision=?, data=?, updated_at=? WHERE owner=? AND revision=?';
const insert = 'INSERT OR IGNORE INTO platform_workspaces(owner,revision,data,updated_at)';
export function workspaceWriteSQL(existing, requireOpenIntake) {
  if (existing) return requireOpenIntake ? update + ' AND ' + openOrderIntakeSQL : update;
  return insert + (requireOpenIntake ? ' SELECT ?,?,?,? WHERE ' + openOrderIntakeSQL : ' VALUES (?,?,?,?)');
}

// A CAS miss caused by a competing workspace change must re-run idempotency
// resolution: the winner may already have created this very same order.
export const inspectOrderConflictSQL = `SELECT
  (SELECT revision FROM platform_workspaces WHERE owner=?) AS revision,
  ${openOrderIntakeSQL} AS open`;
export function pauseBlockedCurrentRevision(snapshot, previous) {
  return snapshot?.open === 0 && snapshot.revision === (previous?.revision ?? null);
}
