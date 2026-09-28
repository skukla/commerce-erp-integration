/*
 * The preview's order traces and look-ups, arranged by the real modules (lib/order-trace.js,
 * lib/lookup.js) from stand-in records, so their shapes stay honest: a split order in two
 * parts, one waiting on Contoso's maintenance, one refused; two products, each owned by one
 * ERP; three companies, each a customer of both ERPs.
 */
import { companyLookup, productLookup } from "#lib/lookup";
import { buildOrderTrace } from "#lib/order-trace";

import { ago, MAINTENANCE } from "./fake-records.js";

const NAMES = { contoso: "Contoso ERP", erp: "Northwind ERP" };

/** Each stand-in order: when placed, its Commerce status, and each ERP's part. */
const ORDERS = {
  3000000021: {
    parts: [["erp", "sent", "0000001011", [["created", 1500], ["shipped", 218], ["invoiced", 215]]]],
    placed: 1500,
    status: "complete",
  },
  3000000022: {
    parts: [["erp", "sent", "0000001012", [["created", 372], ["cancelled", 369]]]],
    placed: 372,
    status: "canceled",
  },
  3000000023: {
    parts: [
      ["erp", "sent", "0000001013", [["created", 286], ["confirmed", 282]]],
      ["contoso", "sent", "0000001002", [["created", 286], ["shipped", 108], ["invoiced", 100]]],
    ],
    placed: 286,
    status: "pending",
  },
  3000000024: {
    parts: [
      ["erp", "sent", "0000001014", [["created", 16]]],
      ["contoso", "held", null, []],
    ],
    placed: 16,
    status: "pending",
  },
  3000000025: { parts: [["erp", "failed", null, []]], placed: 50, status: "pending" },
  3000000026: { parts: [["contoso", "sending", null, []]], placed: 11, status: "pending" },
};

function partOf([erpId, status, number]) {
  const name = NAMES[erpId];
  const messages = {
    failed: "Commerce order 3000000025 was refused by the ERP: accesspoint quantity 0 is not allowed",
    held: MAINTENANCE,
    sending: `Commerce order is being sent to ${name}.`,
    sent: `Order sent to ${name} as ${number}.`,
  };
  return {
    erpId,
    erpName: name,
    ...(number ? { erpNumber: number } : {}),
    message: messages[status],
    ...(status === "failed" ? { refused: true } : {}),
    status,
  };
}

/**
 * erp/history?trace with several ERPs, for a stand-in order.
 * @param {string} ref the order number
 * @param {object[]} history the Activity records (the order's crossings are its own)
 */
export function fakeTrace(ref, history) {
  const order = ORDERS[ref];
  if (!order) {
    return buildOrderTrace({ commerceOrder: null, crossings: [], erpName: "the ERPs", incrementId: ref });
  }
  const crossings = history.filter((e) => e.ref === ref || e.orderRef === ref);
  return buildOrderTrace({
    commerceOrder: { created_at: ago(order.placed), increment_id: ref, status: order.status },
    crossings,
    erpName: order.parts.map(([id]) => NAMES[id]).join(" and "),
    erpNames: NAMES,
    erpOrders: order.parts
      .filter(([, , number]) => number)
      .map(([erpId, , number, steps]) => ({
        erpName: NAMES[erpId],
        erpOrder: {
          history: steps.map(([status, minutes]) => ({ at: ago(minutes), status })),
          number,
          status: steps.at(-1)?.[0] ?? "created",
        },
        number,
      })),
    incrementId: ref,
    parts: order.parts.map(partOf),
  });
}

/** The one-ERP preview's trace: the order as it stands in Northwind alone. */
export function fakeTraceOneErp(ref, history) {
  const trace = fakeTrace(ref, history);
  const { erps: _erps, ...summary } = trace.summary;
  return { ...trace, summary };
}

const PRODUCTS = {
  accesspoint: {
    commerce: { name: "Access Point", price: 199, sku: "accesspoint", status: 1, type_id: "simple" },
    erp: {
      available: 987, committed: 2, listPrice: 199, name: "Access Point", salesStatus: "released",
      sku: "accesspoint", stock: 989, type: "goods", unit: "each",
      warehouses: [{ code: "northwind_warehouse", quantity: 989 }],
    },
    owner: "erp",
    sources: ["northwind_warehouse"],
  },
  proliantdl380: {
    commerce: { name: "ProLiant DL380", price: 1660, sku: "proliantdl380", status: 1, type_id: "simple" },
    erp: {
      available: 41, committed: 1, listPrice: 1660, name: "ProLiant DL380 Gen11", salesStatus: "released",
      sku: "proliantdl380", stock: 42, type: "goods", unit: "each",
      warehouses: [{ code: "contoso_warehouse", quantity: 42 }],
    },
    owner: "contoso",
    sources: ["contoso_warehouse"],
  },
};

/** erp/lookup ?sku: the product beside the ERP that owns it (none answers in maintenance). */
export function fakeProduct(sku, { allGood, oneErp }) {
  const known = PRODUCTS[sku];
  const inMaintenance = !allGood && known?.owner === "contoso";
  const answer = productLookup({
    commerce: known?.commerce ?? null,
    erp: known && !inMaintenance ? known.erp : null,
    sku,
    sourceCodes: known?.sources ?? [],
  });
  if (oneErp) {
    return answer;
  }
  return {
    ...answer,
    owner: known ? { id: known.owner, name: NAMES[known.owner] } : null,
    owners: known ? [known.owner] : [],
  };
}

const COMPANIES = {
  2: ["ServerSavvy Solutions", "ServerSavvy Solutions Inc.", null, 25_000, -4210, ["100051", 25_000, 4210, "NET45", "open"], ["C-2240", 15_000, 0, "NET30", "open"]],
  3: ["Platinum Buyer", "Platinum Buyer Corp.", null, 10_000, -9900, ["100063", 10_000, 9900, "NET30", "stop-all"], ["C-2252", 10_000, 0, "NET30", "open"]],
  4: ["Kukla Studios", "Kukla Studios LLC", "US-84-1234567", 50_000, -1859, ["100042", 50_000, 199, "NET30", "open"], ["C-2231", 20_000, 1660, "NET30", "open"]],
};

function partner([id, limit, exposure, terms, blocking], name, legal, vat, salesOrg) {
  return {
    blocking,
    credit: { available: limit - exposure, exposure, limit },
    creditLimit: limit,
    id,
    legalName: legal,
    name,
    paymentTerms: terms,
    salesOrgs: [salesOrg],
    vatTaxId: vat,
    websiteAccount: "active",
  };
}

/** erp/lookup ?company: Commerce beside each ERP the company is a customer of. */
export function fakeCompany(id, { oneErp }) {
  const known = COMPANIES[id];
  const [name, legal, vat, limit, balance, northwind, contoso] = known ?? [];
  const commerce = known
    ? { company_name: name, id: Number(id), legal_name: legal, status: 1, vat_tax_id: vat }
    : null;
  const credit = known ? { balance, credit_limit: limit, currency_code: "USD" } : null;
  const side = (doc) => companyLookup({ commerce, companyId: String(id), credit, erp: doc });
  if (oneErp) {
    return side(known ? partner(northwind, name, legal, vat, "1000") : null);
  }
  return {
    erps: [
      { erpId: "erp", erpName: NAMES.erp, ...side(known ? partner(northwind, name, legal, vat, "1000") : null) },
      { erpId: "contoso", erpName: NAMES.contoso, ...side(known ? partner(contoso, name, legal, vat, "2000") : null) },
    ],
    key: String(id),
    kind: "company",
  };
}

/** erp/lookup ?companyName: the companies whose name holds the text. */
export function fakeCompanyNames(text) {
  const wanted = String(text).toLowerCase();
  return {
    kind: "companies",
    matches: Object.entries(COMPANIES)
      .filter(([, [name]]) => name.toLowerCase().includes(wanted))
      .map(([id, [name]]) => ({ id, name })),
  };
}
