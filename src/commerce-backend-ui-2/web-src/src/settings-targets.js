/*
 * What the Settings tab edits, as targets: the integration's settings, which every ERP shares,
 * and, with several ERPs, each ERP's own (its entry in the ERP list, erp/erps). Each target has
 * its values at the scope, its fields as shown with this visit's edits on top, and what a save
 * would send. One ERP keeps its settings in the integration's configuration, so it is the
 * integration target (owner, 2026-10-14: an ERP's settings under its name, not behind a
 * switcher).
 */
import { erpFields, integrationFields } from "#web/settings-fields.js";
import {
  erpValues,
  ownerAttributeOf,
  ownershipGap,
  pendingChanges,
} from "#web/settings-view.js";

/** The integration's target id; an ERP's is its id. */
export const INTEGRATION = "";

/** An ERP's products and order-number settings are its own or not set: "" is not set. */
const EMPTY_IS_UNSET = new Set([
  "structure_order_prefix",
  "structure_owns",
  "structure_owns_attribute",
  "structure_owns_websites",
]);

/**
 * @param {{ page: object|null, edits: object, scopeLevel: string, websiteCode?: string,
 *   entries: object[], erpInfo: object }} view
 * @returns {Array<{ id: string, erp: object|null, entry?: object, values: object[],
 *   fields: Map<string, object>, changes: object }>}
 */
export function settingsTargets({
  edits,
  entries,
  erpInfo,
  page,
  scopeLevel,
  websiteCode,
}) {
  if (!page) {
    return [];
  }
  const own = (id) => edits[id] ?? {};
  const integration = {
    erp: erpInfo.several ? null : erpInfo.erps[0],
    fields: integrationFields(page, own(INTEGRATION), scopeLevel),
    id: INTEGRATION,
    values: page.values,
  };
  const erps = erpInfo.several
    ? entries.map((entry) => {
        const values = erpValues(entry, websiteCode, page.values);
        return {
          entry,
          erp: entry,
          fields: erpFields(page, values, own(entry.id)),
          id: entry.id,
          values,
        };
      })
    : [];
  return [integration, ...erps].map((target) => ({
    ...target,
    changes: pendingChanges(target.values, own(target.id)),
  }));
}

/** Whether any target has something to save. */
export const anyChanges = (targets) =>
  targets.some((target) => Object.keys(target.changes).length > 0);

/**
 * The first products setting left without what it reads, against its target and field; or
 * null. A save would make its ERP own nothing (lib/structure.js ownershipProblem).
 * @returns {{ target: string, name: string, text: string } | null}
 */
export function firstGap(targets) {
  for (const target of targets) {
    const gap = ownershipGap(target.fields);
    if (gap) {
      return { ...gap, target: target.id };
    }
  }
  return null;
}

/**
 * One edit, as it lands in the edits: an ERP's own products setting cleared is unset, and
 * picking "by attribute" with no attribute fills in the one its products carry by default.
 * @param {object} target the target edited
 * @returns {object} the target's new edits
 */
export function editOf(target, current, name, value) {
  const unset =
    target.id !== INTEGRATION && EMPTY_IS_UNSET.has(name) && value === "";
  const blank = !String(
    target.fields.get("structure_owns_attribute")?.value ?? "",
  );
  const attribute =
    name === "structure_owns" && value === "attribute" && blank
      ? {
          structure_owns_attribute: ownerAttributeOf(target.erp?.id ?? "erp"),
        }
      : {};
  return { ...current, [name]: unset ? null : value, ...attribute };
}
