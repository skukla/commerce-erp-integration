/*
 * The settings' scopes, groups and saves, kept apart from the React that renders them (as
 * history-view.js and trace-view.js are): the scopes a merchant can switch between, which
 * settings each scope can set, how one field shows at a scope, and what a Save sends. The
 * Settings section renders them (components/settings-section.jsx).
 */

/** The Admin website is hidden: its codes collide with store codes in the config store. */
const HIDDEN_CODES = new Set(["admin"]);

const DEFAULT_CHOICE = { id: "", label: "Default Config", level: "global" };

/**
 * What a Save sends: only what the merchant changed. `null` is the library's "use the
 * wider scope's value", which is what Use Default does.
 *
 * @param {object[]} values the values as loaded
 * @param {object} edits what the merchant changed, by setting name
 * @returns {object} the changes to send
 */
export function pendingChanges(values, edits) {
  const byName = new Map((values ?? []).map((value) => [value.name, value]));
  const changes = {};
  for (const [name, next] of Object.entries(edits ?? {})) {
    const held = byName.get(name);
    if (next === null || !held || held.value !== next) {
      changes[name] = next;
    }
  }
  return changes;
}

/**
 * The scopes the Settings section offers: Default Config, then each website. Every setting
 * the integration has is a website's decision or the whole integration's (an order reads its
 * store view's value, which Commerce resolves up to the website), so store views are not
 * offered; Commerce's own configuration puts settings like these at website level too
 * (owner, 2026-09-27: a Website › Store view list read nothing like Commerce's). The library
 * keeps scopes as a TREE: `global`, then a `commerce` node whose children are websites
 * (lib-config 1.8.0). An unsynced tree still offers the default rather than nothing.
 *
 * @param {object[]} tree the scope tree the settings action answered
 * @returns {object[]} the choices, each with the id the action takes
 */
export function websiteChoices(tree) {
  const websites = [];
  const visit = (node) => {
    if (node.level === "website") {
      if (node.is_editable !== false && !HIDDEN_CODES.has(node.code)) {
        websites.push({
          id: node.id,
          label: node.label ?? node.name ?? node.code,
          level: "website",
        });
      }
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const node of tree ?? []) {
    visit(node);
  }
  return [DEFAULT_CHOICE, ...websites];
}

/**
 * Where the page reads its settings: at one scope, and with `refresh`, after reading
 * Commerce's websites again (the list is not kept in step with Commerce).
 *
 * @param {string} [scope] a scope id; Default Config when omitted
 * @param {{ refresh?: boolean }} [options] read Commerce's websites again first
 * @returns {string} the settings action's path
 */
export function settingsPath(scope, { refresh = false } = {}) {
  const query = new URLSearchParams();
  if (scope) {
    query.set("scope", scope);
  }
  if (refresh) {
    query.set("refresh", "true");
  }
  const asked = query.toString();
  return asked ? `settings?${asked}` : "settings";
}

/**
 * The settings in the order the section shows them. `scope` is where a setting can be set:
 * `website` settings can be set per website (and inherit Default Config), `global` ones only
 * at Default Config, because the integration reads them there (the order-number prefix and
 * which products this ERP owns are the pair's, not a website's).
 */
export const SETTING_GROUPS = Object.freeze([
  {
    legend: "Orders",
    names: ["orders_send", "orders_hold_offline", "orders_confirm_status"],
    scope: "website",
  },
  {
    legend: "Prices",
    names: ["pricing_contract_prices", "pricing_discount_ceiling"],
    scope: "website",
  },
  {
    legend: "Sales organisation",
    names: ["structure_sales_org", "structure_sales_org_name"],
    scope: "website",
  },
  {
    legend: "Products and order numbers",
    names: [
      "structure_owns",
      "structure_owns_sources",
      "structure_owns_attribute",
      "structure_order_prefix",
    ],
    scope: "global",
  },
]);

/** The groups a scope can edit: every group at Default Config, website groups at a website. */
export function groupsAt(scopeLevel) {
  const atDefault = !scopeLevel || scopeLevel === "global";
  return SETTING_GROUPS.filter(
    (group) => atDefault || group.scope === "website",
  );
}

/**
 * One setting field as a control shows it: its value at this scope, whether the value is
 * inherited from a wider scope, and whether this scope can clear it back to the default.
 * Inherited means "this scope does not set it"; at Default Config there is nothing wider,
 * so nothing is inherited and nothing is clearable.
 */
export function dressField(field, held, scopeLevel) {
  const atDefault = !scopeLevel || scopeLevel === "global";
  // lib-config's origin is the scope a value comes from, `{ code, level }`. A scope's own
  // value has the shown scope's level: a value set further up the path has a wider one.
  const inherited = atDefault ? false : held?.origin?.level !== scopeLevel;
  return {
    clearable: !(atDefault || inherited),
    description: field.description,
    inherited,
    label: field.label,
    name: field.name,
    ...(field.options ? { options: field.options } : {}),
    type: field.type ?? "boolean",
    value: held ? held.value : field.default,
  };
}
