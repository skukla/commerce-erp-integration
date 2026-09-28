/*
 * The preview's stand-ins with several ERPs (AB-16c), beside fake-api.js: erp/status's list with
 * each ERP's figures and why one cannot be used, the history's ERPs per record, the look-up per
 * ERP, a split order's trace arranged by the real trace module, and the scheduled runs.
 */
import { companyLookup } from "#lib/lookup";
import { buildOrderTrace } from "#lib/order-trace";

/** erp/status `erps`: Northwind answers; Contoso is in its maintenance window. */
export const STATUS_ERPS = [
  {
    counts: {
      businessPartners: 5,
      events: 0,
      products: 182,
      salesOrders: 12,
    },
    id: "erp",
    lastImportAt: "2026-09-22T09:12:04.000Z",
    lastWipeAt: "2026-09-21T19:11:14.000Z",
    name: "Northwind ERP",
    reachable: true,
  },
  {
    counts: {
      businessPartners: 3,
      events: 2,
      products: 41,
      salesOrders: 4,
    },
    error: "Contoso ERP is in maintenance until 15:55 UTC.",
    id: "contoso",
    lastImportAt: "2026-09-22T09:14:40.000Z",
    lastWipeAt: null,
    name: "Contoso ERP",
    reachable: false,
  },
];

/*
 * With several ERPs (AB-16c): the history names each record's ERPs (erp/history `erpIds`), the
 * look-up names a product's owner and shows a company in each ERP, and the trace is a split
 * order, arranged by the real trace module: Northwind took its part, Contoso's waits.
 */
const ERP_IDS = {
  "000000046": ["erp"],
  "000000047": ["erp", "contoso"],
  "000000048": ["erp"],
  "ev-75": ["contoso"],
  "ev-76": ["erp"],
  "ev-77": ["erp"],
};
/** The history's records, each with the ERPs it concerns (erp/history `erpIds`). */
export function withErpIds(history) {
  return history.map((entry) => ({
    ...entry,
    erpIds: ERP_IDS[entry.eventId ?? entry.ref] ?? [],
  }));
}

const WAITS =
  "Contoso ERP is in maintenance until 15:55 UTC; its lines are sent when it answers.";
export const TRACE_SEVERAL = buildOrderTrace({
  commerceOrder: {
    created_at: "2026-09-22T13:38:00Z",
    increment_id: "000000047",
    status: "processing",
  },
  crossings: [
    {
      attempts: 3,
      direction: "to-erp",
      kind: "order",
      lastAt: "2026-09-22T13:40:00Z",
      message: `Order sent to Northwind ERP as 0000001072. ${WAITS}`,
      outcome: "held",
      ref: "000000047",
    },
  ],
  erpName: "Northwind ERP",
  erpNames: { contoso: "Contoso ERP", erp: "Northwind ERP" },
  erpOrders: [
    {
      erpName: "Northwind ERP",
      erpOrder: {
        history: [{ at: "2026-09-22T13:40:02Z", status: "created" }],
        number: "0000001072",
        status: "created",
      },
      number: "0000001072",
    },
  ],
  incrementId: "000000047",
  parts: [
    {
      erpName: "Northwind ERP",
      erpNumber: "0000001072",
      message: "Order sent to Northwind ERP as 0000001072.",
      status: "sent",
    },
    { erpName: "Contoso ERP", message: WAITS, status: "held" },
  ],
});

/**
 * erp/lookup with several ERPs: a product names its owning ERP, and a company is shown in each
 * ERP (a customer of Northwind's, not yet of Contoso's).
 * @param {object} query `{ sku }` or `{ company }`
 * @param {object} one the one-ERP answer for the same query
 * @param {{ company: object, sku: string }} known the stand-in records
 */
export function lookupAcross(query, one, known) {
  if (query.sku !== undefined) {
    const found = query.sku === known.sku;
    return {
      ...one,
      owner: found ? { id: "erp", name: "Northwind ERP" } : null,
      owners: found ? ["erp"] : [],
    };
  }
  const found = String(query.company) === "7";
  const inErp = (erp) =>
    companyLookup({
      commerce: found ? known.company.commerce : null,
      companyId: String(query.company),
      credit: found ? known.company.credit : null,
      erp,
    });
  return {
    erps: [
      {
        erpId: "erp",
        erpName: "Northwind ERP",
        ...inErp(found ? known.company.erp : null),
      },
      // Not a customer of Contoso's yet: no pair in its key map.
      { erpId: "contoso", erpName: "Contoso ERP", ...inErp(null) },
    ],
    key: String(query.company),
    kind: "company",
  };
}

export const SCHEDULED = [
  {
    id: "prices",
    lastChange: {
      at: "2026-09-22T13:05:00.000Z",
      failed: 0,
      removed: 0,
      unchanged: 176,
      written: 6,
    },
    lastRun: {
      at: "2026-09-22T14:05:00.000Z",
      failed: 0,
      removed: 0,
      unchanged: 182,
      written: 0,
    },
  },
];
