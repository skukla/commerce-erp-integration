/*
 * What the Move stock page says (erp/move-stock), kept apart from the React that renders it
 * (as history-view.js is). With several ERPs a move goes to each product's owning ERP, so the
 * page names each ERP and what it was told, and the products no one ERP owns.
 */

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * @param {number} count the products selected
 * @param {string} erpName with one ERP, its name
 * @param {string[]} [erpNames] with several ERPs, every ERP's name
 * @returns {string} the page's first line
 */
export function moveIntro(count, erpName, erpNames) {
  const selected = `${plural(count, "product", "products")} selected.`;
  if (erpNames?.length > 1) {
    return `${selected} The move is made in Commerce and sent at once to the ERP that owns each product (${erpNames.join(" or ")}).`;
  }
  return `${selected} The move is made in Commerce and sent to ${erpName} at once.`;
}

/**
 * @param {{ moved: string[], told?: Array<{ name: string, skus: string[] }>,
 *   untold?: string[] }} answer the move's answer
 * @param {string} erpName with one ERP, its name
 * @returns {string} what the move did
 */
export function movedSummary(answer, erpName) {
  const moved = plural(answer.moved.length, "product", "products");
  if (!answer.told) {
    return `${moved} moved, and ${erpName} has the new quantities.`;
  }
  const told = answer.told.map(
    (group) =>
      `${group.name} has the new quantities of ${plural(group.skus.length, "product", "products")} (${group.skus.join(", ")}).`,
  );
  const untold =
    answer.untold?.length > 0
      ? [`No ERP owns ${answer.untold.join(", ")}, so no ERP was told.`]
      : [];
  return [`${moved} moved.`, ...told, ...untold].join(" ");
}
