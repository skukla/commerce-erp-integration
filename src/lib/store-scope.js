/*
 * Which store views a store-scoped close covers (erp/close-orders, owner 2026-10-30). Demo
 * Builder's store wipe names its scope the way its own wipe does: stores (Commerce's store
 * groups) and websites, by code. A website names every view of every one of its stores; a store
 * names its own views. An order names its view in `store_id`, so the views are what the close
 * filters orders by. A code the store does not have is named back, never guessed; the Admin
 * website is never one.
 *
 * Pure, over the three lists Commerce answers (`store/websites`, `store/storeGroups`,
 * `store/storeViews`; read by lib/commerce-store-scope.js).
 */

/** A list of codes from a body (an array) or a query (comma-separated). */
function codesOf(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return list.map((code) => String(code).trim()).filter(Boolean);
}

/**
 * The scope a caller named.
 * @param {{ stores?: string[]|string, websites?: string[]|string }} params action params
 * @returns {{ stores: string[], websites: string[] }}
 */
export function scopeOf(params) {
  return {
    stores: codesOf(params.stores),
    websites: codesOf(params.websites),
  };
}

/** Whether a scope names anything at all. */
export const scopeIsEmpty = (scope) =>
  scope.stores.length === 0 && scope.websites.length === 0;

/**
 * @param {{ websites: object[], storeGroups: object[], storeViews: object[] }} structure the
 *   store's three lists, as Commerce answers them
 * @param {{ stores?: string[], websites?: string[] }} scope the codes named
 * @returns {{ viewIds: number[], unknown: string[] }} the views, sorted; `unknown` names each code
 *   the store does not have ("store x", "website y")
 */
export function viewsInScope(structure, scope) {
  const unknown = [];
  const groupIds = new Set();
  for (const code of scope.websites ?? []) {
    const site = structure.websites.find(
      (w) => w.code === code && code !== "admin",
    );
    if (!site) {
      unknown.push(`website ${code}`);
      continue;
    }
    for (const group of structure.storeGroups) {
      if (Number(group.website_id) === Number(site.id)) {
        groupIds.add(Number(group.id));
      }
    }
  }
  for (const code of scope.stores ?? []) {
    const group = structure.storeGroups.find((g) => g.code === code);
    if (group) {
      groupIds.add(Number(group.id));
    } else {
      unknown.push(`store ${code}`);
    }
  }
  const viewIds = structure.storeViews
    .filter((view) => groupIds.has(Number(view.store_group_id)))
    .map((view) => Number(view.id))
    .sort((a, b) => a - b);
  return { unknown: unknown.sort(), viewIds };
}
