/*
 * Company names for the Admin page's Activity. An ERP's company events (credit limit, block,
 * customer prices) name the ERP's own customer, not the Commerce company (contract version 3),
 * so a record reads "customer 100042: credit limit 25000". When the history is read, each such
 * record is given the Commerce company it is about, `company: { id, name }`: the key map pairs
 * the customer with the company, and Commerce names it. Each pair and each company is looked
 * up once per read, however many records name it. A record whose company cannot be found is
 * left as it was; the page then shows the customer number.
 */
import { SINGLE_ERP_ID } from "#lib/erps";

/** The kinds of ERP event that are about one company. */
const COMPANY_KINDS = new Set(["block", "contract", "credit"]);

/** One answer per key, asked once; a failed read is no answer. */
function once(cache, key, read) {
  if (!cache.has(key)) {
    cache.set(
      key,
      read().catch(() => null),
    );
  }
  return cache.get(key);
}

/**
 * @param {object[]} entries the history, as read
 * @param {{ companyOf: (partnerId: string, erpId: string) => Promise<string|null>,
 *   nameOf: (companyId: string) => Promise<string|undefined> }} readers the key map's pair for
 *   an ERP customer, and a Commerce company's name
 * @returns {Promise<object[]>} the history, company records named
 */
export function nameCompanies(entries, { companyOf, nameOf }) {
  const pairs = new Map();
  const names = new Map();
  const idOf = (data) => {
    if (data.companyId !== undefined && data.companyId !== null) {
      return Promise.resolve(String(data.companyId));
    }
    if (!data.partnerId) {
      return Promise.resolve(null);
    }
    const erpId = data.erpId ?? SINGLE_ERP_ID;
    const partnerId = String(data.partnerId);
    return once(pairs, `${erpId}|${partnerId}`, () =>
      companyOf(partnerId, erpId),
    );
  };
  return Promise.all(
    entries.map(async (entry) => {
      if (!(entry.direction === "from-erp" && COMPANY_KINDS.has(entry.kind))) {
        return entry;
      }
      const id = await idOf(entry.event?.data ?? {});
      if (!id) {
        return entry;
      }
      const name = await once(names, id, () => nameOf(id));
      return { ...entry, company: name ? { id, name } : { id } };
    }),
  );
}
