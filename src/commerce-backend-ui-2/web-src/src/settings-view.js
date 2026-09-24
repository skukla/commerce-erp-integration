/*
 * What the Settings tab shows, kept apart from the React that renders it (as
 * history-view.js and trace-view.js are): the fields grouped the way a merchant reads
 * them, the scopes they can switch between, and what a Save actually sends.
 *
 * The layout follows Live Search (Marketing ▸ SEO & Search): a scope bar, then sections
 * with a heading and a sentence under each field. The grouping comes from the setting's
 * name — `orders_*`, `pricing_*` — so a new setting joins its section by being named for
 * it, with no second list to keep in step.
 */

/** What each prefix is called on the page, in the order the sections appear. */
const SECTIONS = [
  { prefix: "orders", title: "Orders" },
  { prefix: "pricing", title: "Pricing" },
  { prefix: "structure", title: "Structure" },
];

/** Anything not matching a known prefix still has a home. */
const OTHER = { prefix: "", title: "Other" };

/** The Admin website is hidden: its codes collide with store codes in the config store. */
const HIDDEN_CODES = new Set(["admin"]);

const DEFAULT_CHOICE = { id: "", label: "Default Config", level: "global" };

/**
 * The fields, grouped into the sections the page renders.
 *
 * @param {object[]} fields the schema fields the settings action answered
 * @param {object[]} values the values at the current scope, each with its origin
 * @param {{scopeLevel?: string}} [options] the level of the scope being shown
 *   ('website', 'store', 'storeView'); omitted or 'global' means Default Config
 * @returns {object[]} sections with at least one field, in SECTIONS order
 */
export function settingSections(fields, values, { scopeLevel } = {}) {
  // Inherited means "this scope does not set it": the value came from a wider one. At
  // Default Config there is nothing wider, so nothing is inherited.
  const atDefault = !scopeLevel || scopeLevel === "global";
  const byName = new Map((values ?? []).map((value) => [value.name, value]));
  const sections = [...SECTIONS, OTHER].map((section) => ({
    fields: [],
    title: section.title,
  }));
  for (const field of fields ?? []) {
    const index = SECTIONS.findIndex((section) =>
      field.name.startsWith(`${section.prefix}_`),
    );
    const held = byName.get(field.name);
    const inherited = atDefault ? false : !held || held.origin !== scopeLevel;
    sections[index === -1 ? SECTIONS.length : index].fields.push({
      // Clearable means "this scope sets it and a wider one can take over again". At
      // Default Config there is nothing wider, so nothing is ever clearable there.
      clearable: !(atDefault || inherited),
      description: field.description,
      inherited,
      label: field.label,
      name: field.name,
      // How the field is drawn: a switch, a text box, or a pick from `options`.
      ...(field.options ? { options: field.options } : {}),
      type: field.type ?? "boolean",
      value: held ? held.value : field.default,
    });
  }
  return sections.filter((section) => section.fields.length > 0);
}

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
