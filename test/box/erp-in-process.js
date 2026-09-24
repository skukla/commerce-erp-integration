/*
 * The ERP, in this process: its actions run against its own in-memory database (the
 * ERP repo's test helper), and the integration's ERP client is answered from here rather
 * than over HTTP. `demo-erp` is reached by path (a sibling checkout), the way the
 * pair-in-a-box item planned it (AB-26c); nothing here needs a deployed ERP.
 *
 * Events the ERP raises stay pending (it has no webhook address in a test), and the box
 * delivers them to the integration's handlers itself (journeys.test.js).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ERP_ROOT = path.resolve(here, "../../../demo-erp");
const requireErp = createRequire(path.join(ERP_ROOT, "package.json"));

const ACTIONS = [
  "health",
  "admin",
  "products",
  "partners",
  "pricing",
  "orders",
  "shipments",
  "invoices",
  "events",
  "search",
  "settings",
];

/** @returns {{ call, cols, pendingEvents, markDelivered, reset, lib }} */
export function startErp() {
  const { memoryCollections } = requireErp("./test/helpers/memory-db");
  const { run } = requireErp("./lib/action");
  const events = requireErp("./lib/events");
  const handlers = Object.fromEntries(
    ACTIONS.map((name) => [name, requireErp(`./actions/${name}`).handler]),
  );
  let cols = memoryCollections();

  /**
   * One ERP call, answered the way `erpRequest` answers: `{ ok, status, data }`.
   * @param {string} action the ERP action name
   * @param {{ method?: string, path?: string, body?: object, params?: object }} [request]
   */
  async function call(
    action,
    { method = "GET", path: p = "", body, params = {} } = {},
  ) {
    const handler = handlers[action];
    if (!handler) {
      return {
        data: { errorMessage: `no ERP action ${action}` },
        ok: false,
        status: 404,
      };
    }
    const q = p.indexOf("?");
    const query =
      q >= 0 ? Object.fromEntries(new URLSearchParams(p.slice(q + 1))) : {};
    const owParams = {
      ...params,
      ...query,
      __ow_method: method.toLowerCase(),
      __ow_path: q >= 0 ? p.slice(0, q) : p,
    };
    if (body !== undefined) {
      owParams.__ow_body = JSON.stringify(body);
    }
    const res = await run(owParams, handler, { collections: async () => cols });
    return { data: res.body, ok: res.statusCode < 400, status: res.statusCode };
  }

  return {
    call,
    get cols() {
      return cols;
    },
    lib: {
      events,
      fulfilment: requireErp("./lib/fulfilment"),
      orders: requireErp("./lib/orders"),
      partners: requireErp("./lib/partners"),
      products: requireErp("./lib/products"),
    },
    async markDelivered(entry) {
      await cols.events.replaceOne(
        { _id: entry._id },
        { ...entry, attempts: (entry.attempts || 0) + 1, delivered: true },
        { upsert: true },
      );
    },
    /** The ERP's undelivered outbound events, oldest first. */
    pendingEvents: () => events.pending(cols),
    reset() {
      cols = memoryCollections();
    },
  };
}
