/*
 * A titled section of a screen, as the Admin's record pages draw one (Magento_Sales _order.less
 * .admin__page-section-title, read 2026-10-14): a 20 px title over a #ccc rule, the section's
 * own actions at the right of that line, then its content.
 */

/**
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.actions] the section's own: a count, a refresh, a link
 */
export function AdminSection({ actions, children, title }) {
  return (
    <section className="adm-section">
      <div className="adm-section-head">
        <h2 className="adm-section-title">{title}</h2>
        {actions && <div className="adm-section-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
