/*
 * Undo ONE ERP's writes on Commerce (AB-16c), leaving the other ERPs'. Products, tier prices
 * and the company status an older version wrote are that ERP's alone, so the ledger puts them
 * back from `before` (lib/ledger.js revertLedger). A company's credit is shared: every ERP's
 * limit, exposure and available credit live in one attribute set, and Commerce's credit limit is
 * their total (lib/erp-credit.js). Restoring `before` there would erase the other ERPs' credit,
 * so the ERP's own attributes come off the set as Commerce holds it now, and the limit becomes
 * what the remaining ERPs hold, or the ledgered `before` when none holds any.
 */
import { attributeCode, heldLimit, withoutErp } from "#lib/erp-credit";

/**
 * Whether a shared credit entry is the ERP's: it names the ERP, or (written before entries
 * named their ERP) the set it wrote carries the ERP's credit limit.
 */
function writtenBy(ledger, entry, erpId) {
  if (ledger.erpsOfEntry(entry).includes(erpId)) {
    return true;
  }
  const code = attributeCode(erpId, "credit_limit");
  return (
    Array.isArray(entry.after) &&
    entry.after.some((a) => a.attribute_code === code)
  );
}

/** The companies whose credit the ERP wrote, each with its ledgered credit limit entry. */
async function companiesOf(ledger, erpId) {
  const shared = (await ledger.readLedger()).filter((e) =>
    ledger.isSharedCredit(e),
  );
  const ids = new Set(
    shared.filter((e) => writtenBy(ledger, e, erpId)).map((e) => e.id),
  );
  return [...ids].map((id) => ({
    credit: shared.find((e) => e.id === id && e.field === "creditLimit"),
    id,
  }));
}

/** Take one ERP's credit off one company, then drop it from the company's entries. */
async function undoCompany(params, company, erpId, deps) {
  const { commerce, ledger } = deps;
  const found = await commerce.getCompany(params, company.id);
  const current = found?.custom_attributes ?? [];
  const kept = withoutErp(current, erpId);
  if (kept.length !== current.length) {
    await commerce.setCompanyCustomAttributes(params, company.id, kept);
  }
  const others = (deps.erps ?? []).filter((entry) => entry.id !== erpId);
  const limit = heldLimit(kept, others);
  if (company.credit) {
    const { before, creditId } = company.credit;
    await commerce.setCompanyCreditLimit(
      params,
      creditId,
      company.id,
      limit ?? before,
    );
  }
  await ledger.forgetCompanyErp(company.id, erpId, {
    restored: limit === null,
  });
}

/** Take one ERP's credit off every company it wrote. A company Commerce refuses keeps its entries. */
async function undoCompanies(params, erpId, deps) {
  const failed = [];
  let reverted = 0;
  for (const company of await companiesOf(deps.ledger, erpId)) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one ledger document, in order
      await undoCompany(params, company, erpId, deps);
      reverted += 1;
    } catch (error) {
      failed.push({ error: error.message, field: "credit", id: company.id });
    }
  }
  return { failed, reverted };
}

/**
 * Put back what one ERP wrote on Commerce: its own ledger entries, then its share of each
 * company's credit.
 * @param {object} params action params
 * @param {string} erpId the ERP
 * @param {object} writers the ledger's writers (lib/detach.js)
 * @param {object} deps `{ commerce: { getCompany, setCompanyCustomAttributes, setCompanyCreditLimit }, erps, ledger }`
 * @returns {Promise<{ reverted: number, failed: {id, field, error}[] }>}
 */
export async function revertErp(params, erpId, writers, deps) {
  const own = await deps.ledger.revertLedger(writers, erpId);
  const companies = await undoCompanies(params, erpId, deps);
  return {
    failed: [...own.failed, ...companies.failed],
    reverted: own.reverted + companies.reverted,
  };
}
