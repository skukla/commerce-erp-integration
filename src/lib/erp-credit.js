/*
 * Credit per ERP (design v1 §3.1; demo scope: the ERPs own credit limits). Each ERP's limit,
 * and its exposure and available credit when it sends them, live in company custom attributes
 * prefixed by the ERP id; Commerce's own company credit limit is the total across the ERPs.
 *
 * `POST V1/company/setCustomAttributes` may replace the whole set (the research on credit
 * options, .rptc/research/erp-company-credit-options/, found GraphQL's documented behaviour
 * is replace; REST's is unverified), so the set is read, changed and written whole. Both writes
 * are ledgered with what Commerce had before and the ERP that made them, so detach puts them
 * back, for every ERP or for one.
 */

const FIELDS = Object.freeze([
  ["credit_limit", "creditLimit"],
  ["exposure", "exposure"],
  ["available", "available"],
]);

/** An ERP's attribute code, in Commerce's attribute alphabet: erp_<id>_<field>. */
export function attributeCode(erpId, field) {
  return `erp_${String(erpId)
    .replace(/[^a-z0-9]+/giu, "_")
    .toLowerCase()}_${field}`;
}

function withErpValues(attributes, erpId, values) {
  const next = attributes.map((a) => ({ ...a }));
  for (const [field, key] of FIELDS) {
    const value = values[key];
    if (
      value === undefined ||
      value === null ||
      !Number.isFinite(Number(value))
    ) {
      continue;
    }
    const code = attributeCode(erpId, field);
    const existing = next.find((a) => a.attribute_code === code);
    if (existing) {
      existing.value = String(Number(value));
    } else {
      next.push({ attribute_code: code, value: String(Number(value)) });
    }
  }
  return next;
}

function totalLimit(attributes, erps) {
  return erps.reduce((sum, erp) => {
    const code = attributeCode(erp.id, "credit_limit");
    const found = attributes.find((a) => a.attribute_code === code);
    return sum + (found ? Number(found.value) || 0 : 0);
  }, 0);
}

/**
 * Write one ERP's credit onto the company and set Commerce's limit to the total.
 * @param {object} params action params
 * @param {{ companyId: string, erpId: string, creditLimit: number, exposure?: number, available?: number }} credit
 * @param {object} deps `{ erps, getCompany, setCompanyCustomAttributes, getCompanyCredit, setCompanyCreditLimit, recordCompanyWrite }`
 * @returns {Promise<{ total: number }>}
 */
export async function applyErpCredit(params, credit, deps) {
  const { companyId, erpId } = credit;
  const company = await deps.getCompany(params, companyId);
  const before = company?.custom_attributes ?? [];
  const after = withErpValues(before, erpId, credit);
  await deps.setCompanyCustomAttributes(params, companyId, after);
  await deps.recordCompanyWrite({
    after,
    before,
    companyId,
    erpId,
    field: "customAttributes",
  });
  const total = totalLimit(after, deps.erps);
  const record = await deps.getCompanyCredit(params, companyId);
  await deps.setCompanyCreditLimit(params, record.id, companyId, total);
  await deps.recordCompanyWrite({
    after: total,
    before: Number(record.credit_limit ?? 0),
    companyId,
    erpId,
    extra: { creditId: record.id },
    field: "creditLimit",
  });
  return { total };
}
