/*
 * A company's credit balance in the fake Commerce (fake-commerce.js): the two writes of the
 * payment leg (lib/company-balance.js), over the store's company credits. Shapes are the ones
 * measured live on Justrite 2026-10-02: each answers true; increaseBalance raises the balance
 * (and so the available credit) by the value, decreaseBalance lowers it by the same.
 */
// biome-ignore-all lint/suspicious/useAwait: a fake Commerce answers promises without waiting on anything; the real clients are async and callers await them

/**
 * @param {{ db: () => object, record: Function }} store the fake's own database (a getter: a
 *   reset replaces it) and write log
 */
export function createFakeBalance({ db, record }) {
  const credit = (creditId) => {
    const found = [...db().credits.values()].find(
      (c) => c.id === Number(creditId),
    );
    if (!found) {
      const error = new Error(`company credit ${creditId} not found`);
      error.response = { statusCode: 404 };
      throw error;
    }
    return found;
  };
  const move = (kind, sign) => async (_p, creditId, m) => {
    const c = credit(creditId);
    c.balance = Math.round((c.balance + sign * m.value) * 100) / 100;
    record(kind, { creditId: Number(creditId), ...m });
    return true;
  };
  return {
    decreaseCompanyBalance: move("decreaseBalance", -1),
    increaseCompanyBalance: move("increaseBalance", 1),
  };
}
