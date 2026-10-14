/*
 * A row of totals, as Commerce's own Dashboard draws its Revenue, Tax, Shipping and Quantity
 * (Magento_Backend module/pages/_dashboard.less .dashboard-totals, read 2026-10-14): each a
 * bold 13 px label over a 24 px semibold value, side by side in equal cells. A value that
 * reports a problem takes the Admin's error red. The one way the page shows a count.
 */

/**
 * @param {object} props
 * @param {string} props.label what the totals are about, for a screen reader
 * @param {Array<{ label: string, value: React.ReactNode, tone?: "bad", foot?: React.ReactNode }>}
 *   props.items each total; `foot` is a small line under its value
 */
export function AdminTotals({ items, label }) {
  return (
    <ul aria-label={label} className="adm-totals">
      {items.map((item) => (
        <li className="adm-totals-item" key={item.label}>
          <span className="adm-totals-label">{item.label}</span>
          <span
            className={
              item.tone === "bad"
                ? "adm-totals-value adm-totals-bad"
                : "adm-totals-value"
            }>
            {item.value}
          </span>
          {item.foot && <span className="adm-totals-foot">{item.foot}</span>}
        </li>
      ))}
    </ul>
  );
}
