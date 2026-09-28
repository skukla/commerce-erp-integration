/*
 * Stand-in answers for the Admin page's actions, in the shapes the actions really return
 * (erp/status, erp/settings, erp/erps, erp/history, erp/lookup, erp/order-parts — see each
 * action). The preview renders the real components against these, so the page can be looked
 * at without a Commerce Admin, a sign-in, or a deployed app. The records are fake-records.js's
 * and the traces and look-ups fake-lookups.js's.
 */
import appConfig from "#app.commerce.config";
import { orderPartsPage } from "#lib/order-parts-view";

import { BODEA_SCOPE_TREE } from "../test/web/fixtures/bodea-scope-tree.js";
import {
  fakeCompany,
  fakeCompanyNames,
  fakeProduct,
  fakeTrace,
  fakeTraceOneErp,
} from "./fake-lookups.js";
import {
  ERP_ENTRIES,
  historyRecords,
  scheduledRuns,
  statusErps,
} from "./fake-records.js";

/** The settings the app declares, as erp/settings lists them (lib/settings.js settingsPage). */
const SETTINGS_FIELDS = appConfig.businessConfig.schema.map(
  ({ default: value, description, label, name, options, type }) => ({
    default: value,
    description,
    label,
    name,
    ...(options ? { options } : {}),
    type,
  }),
);

/** The Pending statuses Commerce answers (GET order-statuses, lib/commerce-admin-reads.js). */
const CONFIRM_STATUSES = [
  { label: "Awaiting ERP review", value: "erp_review" },
  { label: "Confirmed in ERP", value: "erp_confirmed" },
];

// The tree lib-config builds, in its own shape (test/web/fixtures/bodea-scope-tree.js).
const SCOPES = BODEA_SCOPE_TREE;

/** A scope's node, found anywhere in the tree. */
function scopeNode(id, nodes = SCOPES) {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = scopeNode(id, node.children ?? []);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Values the preview's saves set, by `<scope>:<name>`; a website's own sales organization. */
const values = new Map([["website-bodea:structure_sales_org", "1100"]]);

function settingsPage(scope, { oneErp }) {
  const node = scopeNode(scope);
  const level = node?.level ?? "global";
  return {
    confirmStatuses: CONFIRM_STATUSES,
    fields: SETTINGS_FIELDS,
    scope: scope ?? "global",
    scopes: SCOPES,
    values: SETTINGS_FIELDS.map((field) => {
      const held = values.get(`${scope}:${field.name}`);
      if (held !== undefined) {
        return {
          name: field.name,
          origin: { code: node?.code ?? "global", level },
          value: held,
        };
      }
      const atDefault = values.get(`undefined:${field.name}`);
      const byDefault =
        oneErp && field.name === "structure_owns" ? "all" : field.default;
      return {
        name: field.name,
        origin: { code: "global", level: "global" },
        value: atDefault ?? byDefault,
      };
    }),
  };
}

/*
 * One routed order's parts, as the router records them (lib/order-parts.js): Northwind has its
 * part, with a setup warning from the variant check; Contoso holds its part on a credit block.
 * The page's rows are made by the real erp/order-parts view (lib/order-parts-view.js).
 */
const ORDER_PARTS = {
  companyId: "3",
  conflicts: [],
  parts: {
    contoso: {
      heldBy: "block",
      itemIds: [3],
      message:
        "Contoso ERP blocks this company; its lines wait until it lifts the block.",
      skus: ["proliantdl380"],
      status: "held",
    },
    erp: {
      erpNumber: "NORT-0000001042",
      itemIds: [1, 2],
      message: "Order sent to Northwind ERP as NORT-0000001042.",
      skus: ["accesspoint"],
      status: "sent",
      warnings: [
        "ACCESS's variants belong to different ERPs (erp: accesspoint; contoso: accesspoint-pro); fix the setup.",
      ],
    },
  },
  unrouted: [],
};

function orderParts() {
  return Promise.resolve({
    incrementId: "3000000027",
    orderId: 57,
    ...orderPartsPage({ erps: ERP_ENTRIES, record: ORDER_PARTS }),
  });
}

function resendPart(_incrementId, erpId) {
  const part = ORDER_PARTS.parts[erpId];
  if (part) {
    const { heldBy: _heldBy, ...rest } = part;
    ORDER_PARTS.parts[erpId] = {
      ...rest,
      erpNumber: "CONT-0000000311",
      message: "Order sent to Contoso ERP as CONT-0000000311.",
      status: "sent",
    };
  }
  return Promise.resolve({
    message: "Order sent to Contoso ERP as CONT-0000000311.",
    outcome: "sent",
  });
}

function saveErpSettings(id, website, changes) {
  const entry = ERP_ENTRIES.find((candidate) => candidate.id === id);
  const settings = { ...(entry.settings ?? {}) };
  const target = website
    ? { ...(settings.websites?.[website] ?? {}) }
    : settings;
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) {
      delete target[name];
    } else {
      target[name] = value;
    }
  }
  if (website) {
    settings.websites = { ...(settings.websites ?? {}), [website]: target };
  }
  entry.settings = settings;
  return Promise.resolve({ entry: { ...entry } });
}

/** The one-ERP status: Northwind's health, with no list. */
function oneErpStatus() {
  const [northwind] = statusErps(true);
  return {
    erp: {
      appearance: northwind.appearance,
      counts: northwind.counts,
      displayName: northwind.name,
      lastImportAt: northwind.lastImportAt,
      lastWipeAt: northwind.lastWipeAt,
      reachable: true,
    },
    ledger: { entries: 2 },
  };
}

/** One ERP: its records, with no ERP named on them (erp/history with one ERP). */
function oneErpHistory(records) {
  return records
    .filter((e) => !(e.erpIds ?? []).includes("contoso") || e.kind === "reset")
    .map(({ erpIds: _erpIds, ...entry }) => entry);
}

/**
 * @param {{ oneErp?: boolean, allGood?: boolean }} [options] `oneErp`: the store with one ERP;
 *   `allGood`: nothing wrong (Contoso answers, every record went through)
 */
export function fakeApi({ allGood = false, oneErp = false } = {}) {
  const records = historyRecords(allGood);
  const shown = oneErp ? oneErpHistory(records) : records;
  const answer = (value) => Promise.resolve(value);
  return {
    erps: () =>
      answer({
        entries: oneErp ? [ERP_ENTRIES[0]] : ERP_ENTRIES,
        stored: !oneErp,
      }),
    history: (failedOnly, erp) =>
      answer({
        entries: shown
          .filter(
            (e) =>
              !failedOnly ||
              ["held", "dropped", "failed", "refused"].includes(e.outcome),
          )
          .filter((e) => oneErp || !erp || (e.erpIds ?? []).includes(erp)),
      }),
    lookup: (query) => {
      if (query.companyName !== undefined) {
        return answer(fakeCompanyNames(query.companyName));
      }
      return answer(
        query.sku === undefined
          ? fakeCompany(query.company, { oneErp })
          : fakeProduct(query.sku, { allGood, oneErp }),
      );
    },
    orderParts,
    resendPart,
    retry: () =>
      answer({
        message: "Sent again; see Activity for how it ended.",
        outcome: "sent",
      }),
    saveErpSettings,
    saveSettings: (scope, changes) => {
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) {
          values.delete(`${scope}:${name}`);
        } else {
          values.set(`${scope}:${name}`, value);
        }
      }
      const { confirmStatuses: _statuses, ...page } = settingsPage(scope, {
        oneErp,
      });
      return answer(page);
    },
    scheduled: () => answer({ scheduled: scheduledRuns() }),
    settings: (scope) => answer(settingsPage(scope, { oneErp })),
    status: () =>
      answer(
        oneErp
          ? oneErpStatus()
          : {
              erp: { displayName: "Northwind ERP", reachable: true },
              erps: statusErps(allGood),
              ledger: { entries: 2 },
            },
      ),
    trace: (ref) =>
      answer({
        trace: oneErp ? fakeTraceOneErp(ref, shown) : fakeTrace(ref, shown),
      }),
  };
}
