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
 * What the ERP promised for a part, in a sentence (AB-19): the lines it can ship now, and
 * for the rest the date it promises. Read from the promises the router recorded on the part
 * (router/route-order.js), so it costs no call to an ERP.
 * @param {object[]|undefined} promises the ERP's per-line answers (lib/erp-availability.js)
 * @returns {string|null} e.g. "2 of 3 lines ship now; A1 by 2026-10-07", or null when the
 *   ERP was not asked or could not answer
 */
export function promiseWords(promises) {
  if (!Array.isArray(promises) || promises.length === 0) {
    return null;
  }
  const known = promises.filter((p) => !p.unknown);
  const now = known.filter((p) => p.canPromiseNow);
  const later = known.filter((p) => !p.canPromiseNow);
  const pieces = [
    `${now.length} of ${known.length} ${known.length === 1 ? "line ships" : "lines ship"} now`,
  ];
  if (later.length > 0) {
    pieces.push(
      later.map((p) => `${p.sku} by ${p.promiseDate ?? "a date the ERP did not give"}`).join(", "),
    );
  }
  const unknown = promises.length - known.length;
  if (unknown > 0) {
    pieces.push(`${lines(unknown)} the ERP does not have`);
  }
  return pieces.join("; ");
}

/**
 * @param {{ parts?: object }} record the order's parts
 * @param {{ id: string, name: string }[]} erps the ERP list, for the names
 * @returns {object[]} one row per part: its ERP, lines, status, ERP number, why it waits,
 *   what it promised, its setup warnings, and whether staff may send it again
 */
export function partRows(record, erps) {
  return Object.entries(record?.parts ?? {}).map(([erpId, part]) => ({
    canResend: RESENDABLE.includes(part.status),
    erpId,
    erpName: erps.find((e) => e.id === erpId)?.name ?? erpId,
    erpNumber: part.erpNumber ?? null,
    promised: promiseWords(part.promises),
    skus: part.skus ?? [],
    status: part.status,
    waitsFor: WAITING.includes(part.status) ? (part.message ?? null) : null,
    warnings: part.warnings ?? [],
  }));
}

/**
 * With one ERP and no parts record (a guest's order is sent whole and keeps none), the order
 * is its ERP's one part, read from the order's history record (lib/history.js). Staff send it
 * again with the Admin screen's Retry, so the row says it is the whole order.
 */
function wholeOrderRecord(history, erp) {
  return {
    parts: {
      [erp.id]: {
        ...(history.erpNumber ? { erpNumber: history.erpNumber } : {}),
        message: history.message,
        status: history.outcome,
      },
    },
  };
}

/**
 * Everything the order's parts page shows.
 * @param {{ record?: object, history?: object, erps: object[] }} sources the order's parts
 *   record, its history record (`order.<increment id>`) and the ERP list
 * @returns {{ rows: object[], summary: string|undefined, unrouted: string[], conflicts: object[] }}
 */
export function orderPartsPage({ record, history, erps }) {
  const routed = Object.keys(record?.parts ?? {}).length > 0;
  const whole = !routed && history && erps.length === 1;
  const shown = whole ? wholeOrderRecord(history, erps[0]) : record;
  const rows = partRows(shown, erps).map((row) =>
    whole ? { ...row, wholeOrder: true } : row,
  );
  return {
    conflicts: record?.conflicts ?? [],
    rows,
    summary: partsSummary(shown),
    unrouted: record?.unrouted ?? [],
  };
}
