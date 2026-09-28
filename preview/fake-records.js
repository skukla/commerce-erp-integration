/*
 * The preview's stand-in records with two ERPs, in the shapes the actions return: erp/status's
 * list (each ERP's figures and how it looks), erp/erps (each ERP's own settings and
 * connection), erp/history (the Activity records, timed from now so Today and Yesterday read
 * true) and the scheduled runs. They follow the owner-approved mockup's story
 * (preview/mockups/): Northwind ERP answers; Contoso ERP is in maintenance, so some orders and
 * updates did not get through. `?ok` shows the same store with nothing wrong.
 */

const MINUTE = 60 * 1000;
/** A time `minutes` before the page opened. */
const ago = (minutes) => new Date(Date.now() - minutes * MINUTE).toISOString();

const MAINTENANCE = "Contoso ERP is in maintenance until 15:55.";

/** erp/status `erps`: each ERP's figures and appearance (demo-erp's palettes). */
export function statusErps(allGood) {
  return [
    {
      appearance: { logo: "cube", nav: "rail", palette: "teal" },
      counts: { businessPartners: 5, events: 0, products: 3, salesOrders: 3 },
      id: "erp",
      lastImportAt: ago(52),
      lastWipeAt: ago(54),
      name: "Northwind ERP",
      reachable: true,
    },
    {
      appearance: { logo: "orbit", nav: "top", palette: "indigo" },
      counts: {
        businessPartners: 5,
        events: allGood ? 0 : 4,
        products: 3,
        salesOrders: 2,
      },
      id: "contoso",
      lastImportAt: ago(52),
      lastWipeAt: ago(52),
      name: "Contoso ERP",
      reachable: allGood,
      ...(allGood ? {} : { error: MAINTENANCE }),
    },
  ];
}

/** erp/erps: the list Demo Builder stores; Contoso has its own credential and settings. */
export const ERP_ENTRIES = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://northwind-erp.example.adobeioruntime.net" },
    id: "erp",
    name: "Northwind ERP",
    settings: {
      structure_owns: "sources",
      structure_owns_sources: "northwind_warehouse",
      websites: { bodea: { structure_sales_org: "1100" } },
    },
  },
  {
    adapter: "demo-erp",
    connection: {
      auth: {
        clientId: "7c1e5d0c9b1a4e2f8d3c6b5a4f3e42af",
        hasSecret: true,
        orgId: "EXAMPLE@AdobeOrg",
      },
      baseUrl: "https://contoso-erp.example.adobeioruntime.net",
    },
    id: "contoso",
    name: "Contoso ERP",
    settings: {
      structure_sales_org: "2000",
      structure_sales_org_name: "Contoso US Sales",
    },
  },
];

const fromErp = (minutes, erpId, kind, ref, message, extra = {}) => ({
  attempts: 1,
  direction: "from-erp",
  erpIds: [erpId],
  event: { data: { erpId }, type: `be-observer.${kind}` },
  eventId: `ev-${kind}-${ref || minutes}`,
  firstAt: ago(minutes),
  kind,
  lastAt: ago(minutes),
  message,
  outcome: "applied",
  ref,
  ...extra,
});
const toErp = (minutes, erpIds, kind, ref, message, extra = {}) => ({
  attempts: 1,
  direction: "to-erp",
  erpIds,
  firstAt: ago(minutes),
  kind,
  lastAt: ago(minutes),
  message,
  outcome: "sent",
  ref,
  ...extra,
});

const KUKLA = { id: "4", name: "Kukla Studios" };
const SERVERSAVVY = { id: "2", name: "ServerSavvy Solutions" };
const PLATINUM = { id: "3", name: "Platinum Buyer" };

/** What went wrong while Contoso was in maintenance; with `?ok`, it all went through. */
function problems(allGood) {
  if (allGood) {
    return [
      toErp(16, ["erp", "contoso"], "order", "3000000024", "Order sent to Northwind ERP as NORT-0000001014 and to Contoso ERP as CONT-0000001003."),
    ];
  }
  return [
    toErp(11, ["contoso"], "order", "3000000026", "order 3000000026 is being sent to Contoso ERP.", { outcome: "sending" }),
    toErp(16, ["erp", "contoso"], "order", "3000000024", `Order sent to Northwind ERP as NORT-0000001014. ${MAINTENANCE}`, { attempts: 3, outcome: "held" }),
    fromErp(30, "erp", "price", "accesspoint", "SKU accesspoint: price 189 — not applied: Commerce did not answer", { attempts: 2, outcome: "failed" }),
    fromErp(38, "erp", "contract", "100077", "partner 100077: 1 price line(s) in force — not applied: no Commerce company is paired with partner 100077", { outcome: "refused" }),
    toErp(50, ["erp"], "order", "3000000025", "order 3000000025 was refused by the ERP: accesspoint quantity 0 is not allowed", { outcome: "dropped" }),
  ];
}

/** The Activity records, newest first, as erp/history answers them with several ERPs. */
export function historyRecords(allGood) {
  const records = [
    fromErp(2, "erp", "contract", "100042", "partner 100042: 1 price line(s) in force", { company: KUKLA }),
    fromErp(9, "contoso", "stock", "proliantdl380", "SKU proliantdl380 at contoso_warehouse: 42 in stock"),
    fromErp(20, "erp", "credit", "100051", "customer 100051: credit limit 25000", { company: SERVERSAVVY }),
    fromErp(24, "erp", "block", "100063", "customer 100063: blocked", { company: PLATINUM }),
    ...problems(allGood),
    fromErp(100, "contoso", "invoice", "3000000023", "order 3000000023: invoiced"),
    fromErp(108, "contoso", "shipment", "3000000023", "order 3000000023: shipped"),
    toErp(215, ["erp"], "invoiced", "3000000011", "Commerce invoice 3000000011: told Northwind ERP about its lines.", { orderRef: "3000000021" }),
    toErp(218, ["erp"], "shipped", "3000000012", "Commerce shipment 3000000012: told Northwind ERP about its lines.", { orderRef: "3000000021" }),
    toErp(265, ["erp"], "changed", "3000000020", "Northwind ERP: Commerce order 3000000020: held on sales order 0000001010"),
    fromErp(282, "erp", "order-status", "3000000023", "order 3000000023: confirmed"),
    toErp(286, ["erp", "contoso"], "order", "3000000023", "Order sent to Northwind ERP as NORT-0000001013 and to Contoso ERP as CONT-0000001002."),
    fromErp(300, "erp", "hold", "3000000019", "order 3000000019: credit hold released"),
    fromErp(328, "erp", "hold", "3000000019", "order 3000000019: on credit hold"),
    toErp(369, ["erp"], "changed", "3000000022", "Northwind ERP: Commerce order 3000000022: canceled on sales order 0000001012"),
    toErp(372, ["erp"], "order", "3000000022", "order 3000000022 is ERP sales order NORT-0000001012."),
    toErp(24 * 60 - 60, ["erp"], "order", "3000000017", "order 3000000017 is ERP sales order NORT-0000001007."),
    fromErp(24 * 60 + 60, "contoso", "cancel", "3000000018", "order 3000000018: canceled"),
    fromErp(24 * 60 + 240, "contoso", "price", "proliantdl380", "SKU proliantdl380: price 1660"),
    {
      attempts: 1,
      direction: "reset",
      erpIds: ["erp", "contoso"],
      firstAt: ago(24 * 60 + 260),
      kind: "reset",
      lastAt: ago(24 * 60 + 260),
      message:
        "Demo reset on 2026-09-27: 21 orders canceled, 3 noted as closed; the ERPs' changes in Commerce undone. The activity before it was cleared.",
      outcome: "done",
      ref: "2026-09-27",
    },
  ];
  return records.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** The scheduled price publish: ran at five past, changed nothing; the hour before, 2 written. */
export function scheduledRuns() {
  const lastRun = new Date();
  lastRun.setUTCMinutes(5, 0, 0);
  if (lastRun.getTime() > Date.now()) {
    lastRun.setTime(lastRun.getTime() - 60 * MINUTE);
  }
  const before = new Date(lastRun.getTime() - 60 * MINUTE);
  return [
    {
      id: "prices",
      lastChange: {
        at: before.toISOString(),
        failed: 0,
        removed: 0,
        unchanged: 12,
        written: 2,
      },
      lastRun: {
        at: lastRun.toISOString(),
        failed: 0,
        removed: 0,
        unchanged: 14,
        written: 0,
      },
    },
  ];
}

export { ago, MAINTENANCE };
