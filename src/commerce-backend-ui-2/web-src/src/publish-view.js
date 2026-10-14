/*
 * A price publish as its side panel shows it (lib/history.js recordPricePublish): what it did,
 * in counts, and each price row it moved, before and after. The spot-check of a scheduled
 * publish lives here, inside the log, not on a tab of its own (owner, 2026-10-14: one home
 * for each question).
 */
import { counted, money } from "#web/record-fields.js";

/** What started a publish, as the panel's second line says it. */
export const STARTED_BY = Object.freeze({
  "demo-builder": "Run by Demo Builder",
  schedule: "Run on its schedule",
});

/** A tier price as Commerce's catalog shows one: "38.00", "10% off", or none. */
export function priceText(value) {
  if (!value) {
    return "None";
  }
  return value.priceType === "discount"
    ? `${value.price}% off`
    : money(value.price);
}

/** The publish's counts, one fact each. A skip or a failure is one customer, or one ERP. */
export function publishFacts(entry) {
  const prices = (n) => counted(n ?? 0, "price", "prices");
  return [
    { label: "Written", values: [prices(entry.written)] },
    { label: "Removed", values: [prices(entry.removed)] },
    { label: "Unchanged", values: [prices(entry.unchanged)] },
    { label: "Skipped", values: [COUNT.format(entry.skipped?.length ?? 0)] },
    { label: "Failed", values: [COUNT.format(entry.failed?.length ?? 0)] },
  ];
}

/**
 * Each row moved, labeled by company, SKU and quantity (and website, when it is one), its
 * value before and after. A company whose name was not found reads by its id.
 */
export function publishChanges(entry) {
  const names = entry.companies ?? {};
  return (entry.changes ?? []).map((change) => {
    const company = names[change.companyId] ?? `Company ${change.companyId}`;
    const site = change.websiteId ? `, website ${change.websiteId}` : "";
    return {
      label: `${company}: ${change.sku}, quantity ${COUNT.format(change.quantity)}${site}`,
      values: [priceText(change.from), priceText(change.to)],
    };
  });
}

const COUNT = new Intl.NumberFormat("en-US");

/** A reason that names its own customer first (lib/contract-prices.js targetOf). */
const OWN_SUBJECT = /^partner \S+ /u;

/**
 * Why a customer was skipped or failed, each as one line: "Customer C9: no catalog", or
 * "Customer 100063 is paired with no Commerce company" when the reason names it. An ERP that
 * did not answer fails as a whole, with no customer: "Northwind ERP: ...".
 * @param {object} entry the publish's record
 * @param {(erpId: string) => string} [erpName] an ERP's name, by its id
 */
export function publishProblems(entry, erpName = (id) => `ERP ${id}`) {
  const line = (x, why) => {
    if (!x.partnerId) {
      return `${erpName(x.erpId)}: ${why}`;
    }
    const reason = String(why ?? "");
    return OWN_SUBJECT.test(reason)
      ? `Customer ${x.partnerId} ${reason.replace(OWN_SUBJECT, "")}`
      : `Customer ${x.partnerId}: ${reason}`;
  };
  return [
    ...(entry.failed ?? []).map((x) => line(x, x.error)),
    ...(entry.skipped ?? []).map((x) => line(x, x.reason)),
  ];
}
