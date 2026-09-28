/*
 * An order's parts as staff read them (design v1 §3.3): the "ERP parts" cell on Commerce's
 * Sales > Orders grid, and the rows of the order's parts page (the order view's button). Read
 * from the router's parts record (lib/order-parts.js), so neither costs a call to an ERP.
 */

/** The statuses a part waits in, in the order the cell names them. */
const WAITING = Object.freeze(["held", "failed", "cancelled"]);

/** A waiting part staff can send again: its ERP was down, refused it, or a block held it. */
const RESENDABLE = Object.freeze(["held", "failed"]);

const lines = (n) => `${n} ${n === 1 ? "line" : "lines"}`;

/**
 * @param {{ parts?: object, unrouted?: string[], conflicts?: object[] }} [record] the order's parts
 * @returns {string|undefined} e.g. "2 of 2 sent" or "1 held", or undefined for no parts
 */
export function partsSummary(record) {
  const statuses = Object.values(record?.parts ?? {}).map((p) => p.status);
  if (statuses.length === 0) {
    return;
  }
  const waiting = WAITING.map((status) => [
    status,
    statuses.filter((s) => s === status).length,
  ])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`);
  const pieces =
    waiting.length > 0
      ? waiting
      : [
          `${statuses.filter((s) => s === "sent").length} of ${statuses.length} sent`,
        ];
  const unrouted = record.unrouted?.length ?? 0;
  if (unrouted > 0) {
    pieces.push(`${lines(unrouted)} with no ERP`);
  }
  const conflicts = record.conflicts?.length ?? 0;
  if (conflicts > 0) {
    pieces.push(`${lines(conflicts)} claimed twice`);
  }
  return pieces.join(", ");
}

/**
 * @param {{ parts?: object }} record the order's parts
 * @param {{ id: string, name: string }[]} erps the ERP list, for the names
 * @returns {object[]} one row per part: its ERP, lines, status, ERP number, why it waits,
 *   its setup warnings, and whether staff may send it again
 */
export function partRows(record, erps) {
  return Object.entries(record?.parts ?? {}).map(([erpId, part]) => ({
    canResend: RESENDABLE.includes(part.status),
    erpId,
    erpName: erps.find((e) => e.id === erpId)?.name ?? erpId,
    erpNumber: part.erpNumber ?? null,
    skus: part.skus ?? [],
    status: part.status,
    waitsFor: WAITING.includes(part.status) ? (part.message ?? null) : null,
    warnings: part.warnings ?? [],
  }));
}
