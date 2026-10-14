/*
 * Commerce's Dashboard layout, for the Overview (owner, 2026-10-14: the ERPs grid was overkill).
 * Read from its source (magento/magento2 2.4-develop, Magento_Backend module/pages/
 * _dashboard.less and backend _tables.less, 2026-10-14) and drawn in styles/admin-skin.css:
 *
 * - AdminDashboardRow: blocks side by side in equal columns, 35 px apart, as the Dashboard sets
 *   its small lists. (Its narrow-left, wide-right split squeezed the log's six columns, so a
 *   wide table goes under the row instead, seen 2026-10-14.)
 *
 * Each block is an AdminSection, its figures AdminFacts.
 */

/** Blocks side by side, in equal columns. */
export function AdminDashboardRow({ children }) {
  return <div className="adm-dashboard-row">{children}</div>;
}
