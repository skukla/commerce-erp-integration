/*
 * The settings' scopes and saves, kept apart from the React that renders them (as
 * history-view.js and trace-view.js are): the scopes a merchant can switch between, and
 * what a Save actually sends. How the settings are SHOWN — on the card of the entity each
 * one joins — is mapping-view.js; the Settings tab that grouped them by name prefix went
 * with it (2026-09-24).
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
 * The scopes to offer, Default Config first, then each website and, under it, its store
 * views. The library keeps scopes as a TREE: `global`, then a `commerce` node whose children
 * are websites, whose children are stores, whose children are store views, each node with a
 * `label` (lib-config 1.8.0). Stores are left out: the library marks them not editable. An
 * unsynced tree (the state before Commerce's websites have been read) still offers the
 * default rather than nothing.
 *
 * @param {object[]} tree the scope tree the settings action answered
 * @returns {object[]} the choices, each with the id the action takes
 */
export function scopeChoices(tree) {
  const choices = [];
  const visit = (node, website) => {
    const label = node.label ?? node.name ?? node.code;
    const offered =
      (node.level === "website" || node.level === "store_view") &&
      node.is_editable !== false &&
      !(node.level === "website" && HIDDEN_CODES.has(node.code));
    if (offered) {
      choices.push({
        id: node.id,
        label:
          node.level === "store_view" && website
            ? `${website} › ${label}`
            : label,
        level: node.level,
      });
    }
    if (node.level === "website" && HIDDEN_CODES.has(node.code)) {
      return;
    }
    for (const child of node.children ?? []) {
      visit(child, node.level === "website" ? label : website);
    }
  };
  for (const node of tree ?? []) {
    visit(node, null);
  }
  return [DEFAULT_CHOICE, ...choices];
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
