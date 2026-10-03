/*
 * The Settings tab's fields as its controls show them (components/settings-tab.jsx): what
 * loaded, with this visit's edits on top. An edit decides "Use Default Value" before the save
 * does: a value typed or unticked is this scope's own, a `null` (ticked) is the wider scope's.
 */
import { dressErpField, dressField } from "#web/settings-view.js";

/**
 * An ERP's products and order-number settings, with several ERPs: its own, or not set. Not set
 * is its owner attribute (router/ownership.js) and its name's prefix, never the integration's.
 */
const OWN_OR_EMPTY = new Set([
  "structure_order_prefix",
  "structure_owns",
  "structure_owns_attribute",
  "structure_owns_sources",
  "structure_owns_websites",
]);

/** A field with an edit on top: `null` goes back to the wider value, anything else is own. */
function withEdit(dressed, edits, inheritedWhenCleared) {
  if (!(dressed.name in edits)) {
    return dressed;
  }
  if (edits[dressed.name] === null) {
    return { ...dressed, clearable: false, inherited: inheritedWhenCleared };
  }
  return {
    ...dressed,
    clearable: true,
    inherited: false,
    value: edits[dressed.name],
  };
}

/**
 * The integration's fields at a scope (every ERP's defaults; with one ERP, its settings).
 * @param {{ fields: object[], values: object[] }} page erp/settings's page at the scope
 * @param {object} edits what the merchant changed, by setting name
 * @param {string} scopeLevel "global" (Default Config) or "website"
 * @returns {Map<string, object>} each field by name
 */
export function integrationFields(page, edits, scopeLevel) {
  const values = new Map((page.values ?? []).map((v) => [v.name, v]));
  const atWebsite = scopeLevel !== "global";
  return new Map(
    (page.fields ?? []).map((field) => {
      const dressed = dressField(field, values.get(field.name), scopeLevel);
      return [field.name, withEdit(dressed, edits, atWebsite)];
    }),
  );
}

/**
 * One ERP's fields among several (its entry in the ERP list, erp/erps).
 * @param {{ fields: object[] }} page erp/settings's page at the scope
 * @param {Array<{ name: string, value: unknown, own: boolean }>} values settings-view erpValues
 * @param {object} edits what the merchant changed, by setting name
 * @returns {Map<string, object>} each of the ERP's fields by name
 */
export function erpFields(page, values, edits) {
  const held = new Map(values.map((v) => [v.name, v]));
  const shown = new Map();
  for (const field of page.fields ?? []) {
    const value = held.get(field.name);
    if (!value) {
      continue;
    }
    if (OWN_OR_EMPTY.has(field.name)) {
      const own = {
        ...dressErpField(field, value),
        clearable: false,
        inherited: false,
        value: value.own ? value.value : "",
      };
      const edit = edits[field.name];
      shown.set(
        field.name,
        field.name in edits ? { ...own, value: edit ?? "" } : own,
      );
      continue;
    }
    shown.set(field.name, withEdit(dressErpField(field, value), edits, true));
  }
  return shown;
}
