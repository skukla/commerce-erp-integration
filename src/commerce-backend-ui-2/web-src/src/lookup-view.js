/*
 * The Lookup card's table (erp/lookup), kept apart from the React that draws it (as
 * history-view.js is). With one ERP, Commerce beside the ERP. With several, a product beside
 * the one ERP that owns it (the answer's `owner`), and a company beside each ERP (the answer's
 * `erps`), since a company can be a customer in several ERPs, each with its own number.
 */

const NOT_FOUND = " · not found";

/** A column's heading, marked when that side does not hold the record. */
const heading = (name, found) => (found ? name : `${name}${NOT_FOUND}`);

/** Several ERPs, a product: which ERP it belongs to, or why none was asked. */
function productNote(answer, erps) {
  if (answer.owner) {
    return `${answer.owner.name} owns this product.`;
  }
  const claims = (answer.owners ?? []).map(
    (id) => erps.find((e) => e.id === id)?.name ?? id,
  );
  return claims.length > 1
    ? `${claims.join(" and ")} both claim this product; fix the setup. No ERP was asked.`
    : "No ERP owns this product, so no ERP was asked.";
}

/** One ERP's answer (or a product's owner's): Commerce beside that ERP. */
function sideBySide(answer, erpName, note) {
  const rows = answer.rows.map((row) => ({
    cells: [row.commerce, row.erp],
    label: row.label,
  }));
  if (answer.erpHash) {
    rows.push({
      cells: [null, answer.erpHash],
      code: true,
      label: `In ${erpName}`,
    });
  }
  return {
    columns: [
      answer.key,
      heading("Commerce", answer.found.commerce),
      heading(erpName, answer.found.erp),
    ],
    note,
    rows,
  };
}

/** A company with several ERPs: Commerce beside each ERP. */
function companyAcross(answer) {
  const [first] = answer.erps;
  const rows = first.rows.map((row, index) => ({
    cells: [
      row.commerce,
      ...answer.erps.map((side) => side.rows[index]?.erp ?? null),
    ],
    label: row.label,
  }));
  if (answer.erps.some((side) => side.erpHash)) {
    rows.push({
      cells: [null, ...answer.erps.map((side) => side.erpHash ?? null)],
      code: true,
      label: "In the ERP",
    });
  }
  return {
    columns: [
      answer.key,
      heading("Commerce", first.found.commerce),
      ...answer.erps.map((side) => heading(side.erpName, side.found.erp)),
    ],
    note: null,
    rows,
  };
}

/**
 * @param {object} answer erp/lookup's answer
 * @param {string} erpName with one ERP, what it is called
 * @param {object[]|null} erps with several ERPs, the list (for names)
 * @returns {{ columns: string[], rows: Array<{ label: string, cells: Array<string|null>,
 *   code?: true }>, note: string|null }} a `code` row holds the ERP screen's address per ERP
 */
export function lookupTable(answer, erpName, erps) {
  if (answer.erps) {
    return companyAcross(answer);
  }
  if (!(erps && "owners" in answer)) {
    return sideBySide(answer, erpName, null);
  }
  const note = productNote(answer, erps);
  // With no owner no ERP was asked, so its column is not "not found", only empty.
  return answer.owner
    ? sideBySide(answer, answer.owner.name, note)
    : sideBySide(
        { ...answer, found: { ...answer.found, erp: true } },
        "ERP",
        note,
      );
}
