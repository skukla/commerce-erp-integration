/*
 * Facts about one thing, as the Admin's record pages list them (backend _tables.less
 * .admin__table-secondary, read 2026-10-14): a grey label, its value, every other row shaded.
 * With `sides`, one value column per side (Commerce, then each ERP), each headed. The sides
 * are fixed columns in a fixed order, so a cell is keyed by its place.
 */

/**
 * @param {object} props
 * @param {string} props.label what the facts are about, for a screen reader
 * @param {Array<{ label: React.ReactNode, key?: string, values: React.ReactNode[] }>} props.rows
 *   one value per side; a label that is not text (an ERP's name with its color) takes a `key`
 * @param {React.ReactNode[]} [props.sides] the value columns' headings; none for one column
 */
export function AdminFacts({ label, rows, sides }) {
  return (
    <table aria-label={label} className="adm-facts">
      {sides && (
        <thead>
          <tr>
            <td />
            {sides.map((side, index) => (
              <th key={index} scope="col">
                {side}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row) => (
          <tr key={row.key ?? row.label}>
            <th scope="row">{row.label}</th>
            {row.values.map((value, index) => (
              <td key={index}>{value}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
