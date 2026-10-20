/*
 * The Data Map's records, read live (owner, 2026-10-13: "It must be live"). Each row shows
 * the newest real record of its kind, on the Commerce side and in each ERP, from reads the
 * page already makes: Activity picks the record, then the look-up, the order trace and the
 * settings say how each side holds it. A side with no such record says so; nothing here is
 * made up.
 *
 * A row is `{ commerce: cell, erps: { [erpId]: cell } }`, and a cell `[value, note, open]`:
 * `value` null for an empty cell, `open` what a click opens (`{ kind: "company", id }`,
 * `{ kind: "product", sku }`, `{ kind: "trace", ref }`) or null.
 */
import { SINGLE_ERP_ID } from "#web/overview-view.js";
import { clockTime } from "#web/time-view.js";

/** A cell with nothing in it, and why. */
const empty = (note) => [null, note, null];

export const NO_RECORD = "No record yet";
export const NOT_READ = "Could not be read";

/** Every ERP's cell the same. */
function each(erps, cell) {
  return Object.fromEntries(erps.map((erp) => [erp.id, cell]));
}

/** A row with no record anywhere. */
export function emptyRow(erps, note = NO_RECORD) {
  return { commerce: empty(note), erps: each(erps, empty(note)) };
}

/** The ERPs an Activity record is about: its own list, else the one ERP there is. */
function erpIdsOf(entry) {
  const ids = entry.erpIds ?? [];
  if (ids.length > 0) {
    return ids;
  }
  return [entry.event?.data?.erpId ?? SINGLE_ERP_ID];
}

/** The ERP id an ERP list uses for a record's ERP: with one ERP, that one. */
function erpIdIn(erps, id) {
  return erps.length === 1 ? erps[0].id : id;
}

/** One row of a look-up's rows, by label. */
function rowOf(lookup, label) {
  return (lookup?.rows ?? []).find((row) => row.label === label) ?? {};
}

/**
 * Which record each row shows: the newest of its kind in Activity (newest first). A price list
 * or payment Commerce did not apply is not one Commerce holds, so only applied ones count. The
 * company falls back to the first customer the key map pairs, so a store with no company event
 * yet still shows one.
 * @param {object[]} history the Activity records, newest first
 * @param {object[]} keyMap the key map's pairs (erp/keymap)
 */
export function mapPicks(history, keyMap) {
  const newest = (test) => history.find((e) => e.ref && test(e));
  const customer = keyMap.find((pair) => pair.kind === "customer");
  return {
    companyId:
      newest((e) => e.company?.id)?.company.id ?? customer?.commerce ?? null,
    contract:
      newest((e) => e.kind === "contract" && e.outcome === "applied") ?? null,
    // An order that reached its ERPs, so each side has its sales order.
    order:
      newest((e) => e.kind === "order" && e.outcome === "sent")?.ref ?? null,
    payment:
      newest((e) => e.kind === "payment" && e.outcome === "applied") ?? null,
    sku:
      newest((e) => ["product", "stock", "product-changed"].includes(e.kind))
        ?.ref ?? null,
  };
}

/** The company as Commerce holds it, and each ERP's customer for it (erp/lookup). */
export function companyRow(lookup, erps, keyMap) {
  const id = lookup.key;
  const open = { id, kind: "company" };
  // With several ERPs the look-up is one per ERP, each carrying Commerce's side too.
  const perErp = lookup.erps ?? [{ ...lookup, erpId: erps[0].id }];
  const name = rowOf(perErp[0], "Name").commerce;
  const limit = rowOf(perErp[0], "Credit limit").commerce;
  const numberIn = (erpId) =>
    keyMap.find(
      (pair) =>
        pair.kind === "customer" &&
        pair.commerce === id &&
        erpIdIn(erps, pair.erpId ?? SINGLE_ERP_ID) === erpId,
    )?.erp;
  return {
    commerce: name
      ? [name, limit ? `credit limit ${limit}` : "no credit limit", open]
      : empty("not in Commerce"),
    erps: Object.fromEntries(
      erps.map((erp) => {
        const side = perErp.find((s) => s.erpId === erp.id);
        const number = numberIn(erp.id);
        const erpLimit = rowOf(side, "Credit limit").erp;
        const cell = number
          ? [
              `Customer ${number}`,
              erpLimit ? `credit limit ${erpLimit}` : "no credit limit",
              open,
            ]
          : empty("not a customer here");
        return [erp.id, cell];
      }),
    ),
  };
}

/** The ERP a product look-up names: its owner, or with one ERP that one. */
function productErp(lookup, erps) {
  return erps.length === 1 ? erps[0].id : (lookup.owner?.id ?? null);
}

/** A product's cell in one ERP: another ERP's product, absent from its owner, or `cell`. */
function ownerCell(erp, owner, lookup, cell, notOwned) {
  if (erp.id !== owner) {
    return empty(notOwned);
  }
  return lookup.found?.erp ? cell : empty("not in this ERP");
}

/** The product as Commerce holds it, and as the ERP that owns it does (erp/lookup). */
export function productRow(lookup, erps) {
  const sku = lookup.key;
  const open = { kind: "product", sku };
  const price = rowOf(lookup, "Price");
  const owner = productErp(lookup, erps);
  return {
    commerce: lookup.found?.commerce
      ? [sku, `price ${price.commerce ?? "not set"}`, open]
      : empty("not in Commerce"),
    erps: Object.fromEntries(
      erps.map((erp) => [
        erp.id,
        ownerCell(
          erp,
          owner,
          lookup,
          [`Item ${sku}`, `list price ${price.erp ?? "not set"}`, open],
          "not its product",
        ),
      ]),
    ),
  };
}

/** The same product's stock: Commerce's sources, and the owning ERP's warehouses. */
export function stockRow(lookup, erps) {
  const sku = lookup.key;
  const open = { kind: "product", sku };
  const stock = rowOf(lookup, "Stock");
  // "989 on hand · 2 committed · 987 available", the look-up's own words.
  const [onHand, ...rest] = String(
    rowOf(lookup, "Availability").erp ?? "",
  ).split(" · ");
  const owner = productErp(lookup, erps);
  return {
    commerce: lookup.found?.commerce
      ? [sku, stock.commerce ?? "no stock", open]
      : empty("not in Commerce"),
    erps: Object.fromEntries(
      erps.map((erp) => [
        erp.id,
        ownerCell(
          erp,
          owner,
          lookup,
          [onHand, rest.join(", "), open],
          "not its warehouse",
        ),
      ]),
    ),
  };
}

/** The newest price list an ERP sent: whose prices, and how many lines (Activity). */
export function pricesRow(entry, erps) {
  const data = entry.event?.data ?? {};
  const lines = Array.isArray(data.lines) ? data.lines.length : 0;
  // The record's ref is the ERP's partner (lib/erp-event-history.js).
  const partner = data.partnerId ?? entry.ref;
  const { company } = entry;
  const open = company?.id ? { id: company.id, kind: "company" } : null;
  const from = erpIdIn(erps, erpIdsOf(entry)[0]);
  const plural = lines === 1 ? "price" : "prices";
  return {
    commerce: company?.name
      ? [company.name, `${lines} company ${plural}`, open]
      : empty("no company paired"),
    erps: Object.fromEntries(
      erps.map((erp) => [
        erp.id,
        erp.id === from
          ? [`Price list for ${partner}`, `${lines} ${plural} in force`, open]
          : empty("no prices for this company"),
      ]),
    ),
  };
}

/** Each ERP's sales order for the order, from the trace's summary (by the ERP's name). */
function salesOrders(summary, erps) {
  if (!summary.erps) {
    return {
      [erps[0].id]: { number: summary.erpNumber, status: summary.erpStatus },
    };
  }
  return Object.fromEntries(
    erps
      .map((erp) => [
        erp.id,
        summary.erps.find((side) => side.name === erp.name),
      ])
      .filter(([, side]) => side),
  );
}

/** The order as Commerce holds it, and each ERP's sales order for its part (erp/history?trace). */
export function orderRow(ref, trace, erps) {
  const open = { kind: "trace", ref };
  const { summary } = trace;
  const orders = salesOrders(summary, erps);
  return {
    commerce: summary.incrementId
      ? [`Order ${ref}`, summary.commerceStatus ?? "no status", open]
      : empty("not in Commerce"),
    erps: Object.fromEntries(
      erps.map((erp) => {
        const side = orders[erp.id];
        return [
          erp.id,
          side?.number
            ? [
                `Sales order ${side.number}`,
                side.status ?? side.part ?? "",
                open,
              ]
            : empty("no part of this order"),
        ];
      }),
    ),
  };
}

/** When an ERP shipped and invoiced the order, from its events in Activity. */
function fulfilled(history, ref, erpId, erps) {
  const at = (kind) =>
    history.find(
      (e) =>
        e.direction === "from-erp" &&
        e.kind === kind &&
        e.ref === ref &&
        erpIdsOf(e).some((id) => erpIdIn(erps, id) === erpId),
    )?.lastAt;
  return { invoiced: at("invoice"), shipped: at("shipment") };
}

/** The same order's shipping and invoicing, in Commerce and in each ERP. */
export function fulfilRow(ref, history, erps, timeZone) {
  const open = { kind: "trace", ref };
  const time = (iso) => clockTime(iso, timeZone);
  const sides = Object.fromEntries(
    erps.map((erp) => [erp.id, fulfilled(history, ref, erp.id, erps)]),
  );
  const done = Object.values(sides);
  const shipped = done.filter((s) => s.shipped).length;
  const invoiced = done.filter((s) => s.invoiced).length;
  const counted = (n, what) =>
    erps.length === 1 || n === erps.length
      ? what
      : `${n} of ${erps.length} parts ${what}`;
  const commerceNote = [
    shipped > 0 ? counted(shipped, "shipped") : "not shipped yet",
    ...(invoiced > 0 ? [counted(invoiced, "invoiced")] : []),
  ].join(", ");
  return {
    commerce: [`Order ${ref}`, commerceNote, open],
    erps: Object.fromEntries(
      erps.map((erp) => {
        const side = sides[erp.id];
        return [
          erp.id,
          [
            side.shipped ? `Shipped ${time(side.shipped)}` : "Not shipped yet",
            side.invoiced ? `invoiced ${time(side.invoiced)}` : "not invoiced",
            open,
          ],
        ];
      }),
    ),
  };
}

/** The websites in the settings' scope tree (lib-config's shape), the Admin website left out. */
export function websitesOf(scopes) {
  const found = [];
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.level === "website" && node.code !== "admin") {
        found.push({ code: node.code, label: node.label });
      }
      walk(node.children);
    }
  };
  walk(scopes);
  return found;
}

/**
 * A website and the sales organization each ERP files its orders under (erp/settings
 * `?websites=&erp=`). The website shown is the first that the most ERPs file under a sales
 * organization.
 * @param {Array<{ code: string, label: string }>} websites
 * @param {Record<string, { websites: Record<string, object> }>} perErp each ERP's answer
 */
export function websiteRow(websites, perErp, erps) {
  const filed = (code) =>
    erps.filter((erp) => perErp[erp.id]?.websites?.[code]?.structure_sales_org)
      .length;
  const most = Math.max(0, ...websites.map((w) => filed(w.code)));
  const site = websites.find((w) => filed(w.code) === most);
  if (!site) {
    return emptyRow(erps);
  }
  return {
    commerce: [site.label, `code ${site.code}`, null],
    erps: Object.fromEntries(
      erps.map((erp) => {
        const values = perErp[erp.id]?.websites?.[site.code] ?? {};
        return [
          erp.id,
          values.structure_sales_org
            ? [
                `Sales org ${values.structure_sales_org}`,
                values.structure_sales_org_name ?? "",
                null,
              ]
            : empty("no sales organization"),
        ];
      }),
    ),
  };
}

/** The newest payment an ERP posted, and the order it paid (Activity). */
export function paymentRow(entry, erps) {
  const data = entry.event?.data ?? {};
  const open = { kind: "trace", ref: entry.ref };
  const from = erpIdIn(erps, erpIdsOf(entry)[0]);
  return {
    commerce: [`Order ${entry.ref}`, `paid ${data.amount}`, open],
    erps: Object.fromEntries(
      erps.map((erp) => [
        erp.id,
        erp.id === from
          ? [
              `Payment ${data.paymentNumber}`,
              `${data.amount} against its invoice`,
              open,
            ]
          : empty("no payment for this order"),
      ]),
    ),
  };
}
