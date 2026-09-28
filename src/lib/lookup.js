/*
 * "What do you hold for SKU X / company Y?" — one entity as both systems hold it, lined up
 * row by row for the Mapping tab (programme plan §6 row 9: a small read on the pair so the
 * ERP side of a card is live). Pure: the action fetches both records, this arranges them.
 * A side that does not have the entity contributes null cells, never a guess.
 */

/**
 * The website account: Commerce's company `status` (B2B), in the words the ERP's screen uses
 * for its read-only copy. Active and Closed are the switch; pending and rejected are the
 * company's approval, before the switch means anything.
 */
const WEBSITE_ACCOUNT = {
  0: "Pending approval",
  1: "Active",
  2: "Rejected",
  3: "Closed",
};

/** The ERP's copy of the website account (contract version 5), in the same words. */
const ERP_WEBSITE_ACCOUNT = { active: "Active", closed: "Closed" };

/** The ERP's own credit block, in the words its screen uses. Commerce has no such switch. */
const CREDIT_BLOCK = {
  all: "Stop all",
  invoicing: "Stop invoicing",
  open: "None",
  shipping: "Stop shipping",
};

const text = (value) =>
  value === undefined || value === null || value === "" ? null : String(value);

/** Where Commerce stocks a product it has, in words; null for a product it does not have. */
function sourcesText(commerce, sourceCodes) {
  if (!commerce) {
    return null;
  }
  return sourceCodes.length > 0
    ? `in sources ${sourceCodes.join(", ")}`
    : "in no source";
}

/** A Commerce product's status in words; null for a product it does not have. */
function productStatus(commerce) {
  if (!commerce) {
    return null;
  }
  return Number(commerce.status) === 1 ? "enabled" : "disabled";
}

/**
 * @param {{ sku: string, commerce: object|null, erp: object|null, sourceCodes?: string[] }} args
 *   `commerce` is the Commerce product (`GET products/{sku}`), `erp` the ERP's product
 *   document (with `committed` and `available`), `sourceCodes` the sources it is assigned to
 * @returns {{ kind: 'product', key: string, found: { commerce: boolean, erp: boolean }, rows: object[], erpHash: string|null }}
 */
export function productLookup({ commerce, erp, sku, sourceCodes = [] }) {
  const rows = [
    { commerce: text(commerce?.name), erp: text(erp?.name), label: "Name" },
    {
      commerce: text(commerce?.type_id),
      erp: erp ? `${erp.type}${erp.unit ? ` · ${erp.unit}` : ""}` : null,
      label: "Type",
    },
    {
      commerce: text(commerce?.price),
      erp: text(erp?.listPrice),
      label: "Price",
    },
    {
      commerce: productStatus(commerce),
      erp: text(erp?.salesStatus),
      label: "Status",
    },
    {
      commerce: sourcesText(commerce, sourceCodes),
      erp: erp
        ? (erp.warehouses ?? [])
            .map((w) => `${w.code} ${w.quantity}`)
            .join(", ") || "no stock"
        : null,
      label: "Stock",
    },
    {
      commerce: null,
      erp: erp
        ? `${erp.stock ?? 0} on hand · ${erp.committed ?? 0} committed · ${erp.available ?? erp.stock ?? 0} available`
        : null,
      label: "Availability",
    },
  ];
  return {
    erpHash: erp
      ? `#products?open=${encodeURIComponent(erp.sku ?? sku)}`
      : null,
    found: { commerce: Boolean(commerce), erp: Boolean(erp) },
    key: sku,
    kind: "product",
    rows,
  };
}

/**
 * @param {{ companyId: string, commerce: object|null, credit: object|null, erp: object|null }} args
 *   `commerce` is the Commerce company, `credit` its company credit record, `erp` the ERP's
 *   partner document (with `credit` { limit, exposure, available })
 */
export function companyLookup({ commerce, companyId, credit, erp }) {
  const erpCredit = erp?.credit ?? null;
  const rows = [
    {
      commerce: text(commerce?.company_name),
      erp: erp ? `${erp.name} (${erp.id})` : null,
      label: "Name",
    },
    {
      // Two separate switches (owner, 2026-09-28): the website account is Commerce's, copied
      // into the ERP; the credit block is the ERP's own and Commerce never changes it.
      commerce: commerce
        ? (WEBSITE_ACCOUNT[Number(commerce.status)] ?? String(commerce.status))
        : null,
      // An ERP built before contract version 5 keeps no copy: an empty cell, not a guess.
      erp: erp
        ? (ERP_WEBSITE_ACCOUNT[erp.websiteAccount] ?? text(erp.websiteAccount))
        : null,
      label: "Website account",
    },
    {
      commerce: null,
      erp: erp ? (CREDIT_BLOCK[erp.blocking] ?? text(erp.blocking)) : null,
      label: "Credit block",
    },
    {
      commerce: credit
        ? `${credit.credit_limit}${credit.currency_code ? ` ${credit.currency_code}` : ""}`
        : null,
      erp: text(erp?.creditLimit ?? erpCredit?.limit),
      label: "Credit limit",
    },
    {
      commerce:
        credit && credit.balance !== undefined
          ? `balance ${credit.balance}`
          : null,
      erp: erpCredit
        ? `exposure ${erpCredit.exposure} · available ${erpCredit.available}`
        : null,
      label: "Credit position",
    },
    {
      commerce: text(commerce?.legal_name),
      erp: text(erp?.legalName),
      label: "Legal name",
    },
    {
      commerce: text(commerce?.vat_tax_id),
      erp: text(erp?.vatTaxId),
      label: "VAT / tax id",
    },
    { commerce: null, erp: text(erp?.paymentTerms), label: "Payment terms" },
    {
      commerce: null,
      erp:
        Array.isArray(erp?.salesOrgs) && erp.salesOrgs.length > 0
          ? erp.salesOrgs.join(", ")
          : null,
      label: "Sales organisations",
    },
  ];
  return {
    erpHash: erp ? `#partners?open=${encodeURIComponent(erp.id)}` : null,
    found: { commerce: Boolean(commerce), erp: Boolean(erp) },
    key: String(companyId),
    kind: "company",
    rows,
  };
}
