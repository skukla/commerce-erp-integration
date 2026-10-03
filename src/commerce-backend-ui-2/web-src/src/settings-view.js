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
    if (next === null) {
      // An ERP's value it does not set (`own: false`) has nothing to clear.
      if (held?.own !== false) {
        changes[name] = null;
      }
    } else if (!held || held.value !== next) {
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
 * The settings in the order the Settings tab's cards show them (components/settings-cards.jsx),
 * each card by its id. `scope` is where a setting can be set: `website` settings can be set per
 * website (and inherit Default Config), `global` ones only at Default Config, because the
 * integration reads them there (the order-number prefix and which products an ERP owns are the
 * pair's, not a website's).
 */
export const SETTING_GROUPS = Object.freeze([
  {
    id: "orders",
    names: ["orders_send", "orders_hold_offline", "orders_confirm_status"],
    scope: "website",
  },
  {
    id: "salesOrg",
    names: ["structure_sales_org", "structure_sales_org_name"],
    scope: "website",
  },
  {
    id: "products",
    names: [
      "structure_owns",
      "structure_owns_sources",
      "structure_owns_attribute",
      "structure_owns_websites",
      "structure_order_prefix",
    ],
    scope: "global",
  },
  // When the scheduled jobs run (AB-38): the heartbeat reads them at Default Config.
  {
    id: "schedules",
    names: [
      "schedule_timezone",
      "schedule_prices_enabled",
      "schedule_prices_frequency",
      "schedule_prices_minute",
      "schedule_prices_weekday",
      "schedule_prices_time",
    ],
    scope: "global",
  },
]);

/** A card's settings, by the card's id. */
export const groupNames = (id) =>
  SETTING_GROUPS.find((group) => group.id === id)?.names ?? [];

/** Which of a job's settings each frequency reads (lib/schedule.js). */
const READ_BY = {
  daily: new Set(["time"]),
  hourly: new Set(["minute"]),
  weekly: new Set(["weekday", "time"]),
};
const JOB_SETTING = /^schedule_([a-z]+)_([a-z]+)$/u;

/**
 * The Schedules card's settings as shown: a job switched off shows only its switch, and a job
 * on shows how often and only what that frequency reads (the minute hourly, the time daily,
 * the day and time weekly).
 * @param {Map<string, { value: unknown }>} fields the fields as shown, by name
 * @returns {string[]}
 */
export function scheduleNames(fields) {
  return groupNames("schedules").filter((name) => {
    const [, job, part] = JOB_SETTING.exec(name) ?? [];
    if (!job || part === "enabled") {
      return true;
    }
    if (fields.get(`schedule_${job}_enabled`)?.value !== true) {
      return false;
    }
    const frequency = fields.get(`schedule_${job}_frequency`)?.value;
    return part === "frequency" || Boolean(READ_BY[frequency]?.has(part));
  });
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

/**
 * The settings an ERP sets for itself, on its entry in the ERP list (the integration's
 * src/lib/erp-settings.js PER_ERP_KEYS; a test keeps the two lists equal). The rest are the
 * whole integration's.
 */
export const ERP_SETTING_NAMES = Object.freeze([
  "structure_owns",
  "structure_owns_sources",
  "structure_owns_attribute",
  "structure_owns_websites",
  "structure_order_prefix",
  "structure_sales_org",
  "structure_sales_org_name",
]);

/** The ERP settings that can differ per website (the "Use Default" box's settings). */
export const ERP_WEBSITE_NAMES = new Set([
  "structure_sales_org",
  "structure_sales_org_name",
]);

/**
 * The website code of a scope id from the scope tree, or undefined for Default Config (an
 * ERP's per-website settings are kept by website code).
 */
export function websiteCodeOf(tree, scopeId) {
  if (!scopeId) {
    return;
  }
  let found;
  const visit = (node) => {
    if (node.id === scopeId) {
      found = node.code;
      return;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const node of tree ?? []) {
    visit(node);
  }
  return found;
}

/**
 * One ERP's values at a scope: its own where its entry sets them at this scope; else, at a
 * website, its own default; else the integration's as the page loaded them. That is the order
 * the integration reads them in (lib/erp-settings.js withErpSettings). `own` is whether this
 * scope sets it (the "Use Default Value" / "Same as All ERPs" box, unticked).
 * @returns {Array<{ name: string, value: unknown, own: boolean }>}
 */
export function erpValues(entry, websiteCode, pageValues) {
  const settings = entry?.settings ?? {};
  const atWebsite = websiteCode ? (settings.websites?.[websiteCode] ?? {}) : {};
  const integration = new Map(
    (pageValues ?? []).map((value) => [value.name, value.value]),
  );
  return ERP_SETTING_NAMES.map((name) => {
    const set = websiteCode ? atWebsite[name] : settings[name];
    if (set !== undefined) {
      return { name, own: true, value: set };
    }
    const wider = websiteCode ? settings[name] : undefined;
    return {
      name,
      own: false,
      value: wider === undefined ? integration.get(name) : wider,
    };
  });
}

/**
 * An ERP field as a control shows it: inherited (greyed, "Use Default" ticked) when the ERP
 * does not set it, clearable back to the integration's value when it does.
 */
export function dressErpField(field, held) {
  const own = Boolean(held?.own);
  return {
    clearable: own,
    description: field.description,
    inherited: !own,
    label: field.label,
    name: field.name,
    ...(field.options ? { options: field.options } : {}),
    type: field.type ?? "boolean",
    value: held ? held.value : field.default,
  };
}
