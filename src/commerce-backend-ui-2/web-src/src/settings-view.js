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
 * The scopes to offer, Default Config first. An unsynced tree — the state before
 * Commerce's websites have been read — still offers the default rather than nothing.
 *
 * @param {object[]} tree the scope tree the settings action answered
 * @returns {object[]} the choices, each with the id the action takes
 */
export function scopeChoices(tree) {
  const rest = (tree ?? [])
    .filter((node) => node.level !== "global" && node.level !== "commerce")
    .filter((node) => !HIDDEN_CODES.has(node.code))
    .map((node) => ({
      id: node.id,
      label: node.name ?? node.code,
      level: node.level,
    }));
  return [DEFAULT_CHOICE, ...rest];
}
