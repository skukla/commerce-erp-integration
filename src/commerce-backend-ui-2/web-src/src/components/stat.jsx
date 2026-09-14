/** One figure with its label. */
export function Stat({ label, value }) {
  return (
    <div className="erp-stat">
      <small>{label}</small>
      <strong>{String(value)}</strong>
    </div>
  );
}
