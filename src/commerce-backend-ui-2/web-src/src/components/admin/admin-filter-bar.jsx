/*
 * The Commerce Admin grid's filter pattern, from Spectrum 2 parts (owner, 2026-10-14), laid out
 * and sized by the Admin's own values (Magento_Ui data-grid filters.less, read 2026-10-14): a
 * keyword search; a Filters button that opens a panel of fields above the grid, applied with
 * Apply Filters and dropped with Cancel; the filters in force as removable chips under
 * "Active filters", with Clear all; and the grid's refresh on the right. The Admin SDK ships no
 * UI components (aio-commerce-lib-admin-ui 1.1.0: createExtensionApp and hooks), and the
 * Admin's own panel is its page's code, out of an app's reach, so the page draws its own.
 */
import { useCallback, useId, useState } from "react";

import { AdminButton } from "#web/components/admin/admin-button.jsx";
import { AdminRefresh } from "#web/components/admin/admin-refresh.jsx";

/** One filter in force, and its remove. */
function ActiveChip({ chip }) {
  return (
    <li className="adm-chip">
      {chip.label}
      <AdminButton
        label={`Remove ${chip.label}`}
        onPress={chip.onRemove}
        variant="tertiary">
        <span aria-hidden="true" className="adm-chip-remove">
          ×
        </span>
      </AdminButton>
    </li>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.search the keyword search (AdminSearch)
 * @param {React.ReactNode} props.fields the panel's fields, bound to a draft the caller holds
 * @param {() => void} props.onOpen the panel opens: the caller copies the filters into its draft
 * @param {() => void} props.onApply apply the draft
 * @param {Array<{ id: string, label: string, onRemove: () => void }>} props.active
 *   the filters in force, as chips
 * @param {() => void} props.onClearAll remove them all
 * @param {object} props.refresh the page's refresh (AdminRefresh's props)
 */
export function AdminFilterBar({
  active,
  fields,
  onApply,
  onClearAll,
  onOpen,
  refresh,
  search,
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggle = useCallback(() => {
    if (!open) {
      onOpen();
    }
    setOpen((was) => !was);
  }, [onOpen, open]);
  const cancel = useCallback(() => setOpen(false), []);
  const apply = useCallback(() => {
    onApply();
    setOpen(false);
  }, [onApply]);
  return (
    <div className="adm-filter-bar">
      {/* The Admin's grid header: the search on the left, the grid's actions on the right. */}
      <div className="adm-filter-row">
        {search}
        <AdminRefresh {...refresh} />
        <AdminButton
          aria-controls={panelId}
          aria-expanded={open}
          onPress={toggle}>
          Filters
        </AdminButton>
      </div>
      {open && (
        <section aria-label="Filters" className="adm-filter-panel" id={panelId}>
          <div className="adm-filter-fields">{fields}</div>
          <div className="adm-filter-actions">
            <AdminButton onPress={cancel} variant="tertiary">
              Cancel
            </AdminButton>
            <AdminButton onPress={apply} variant="secondary">
              Apply Filters
            </AdminButton>
          </div>
        </section>
      )}
      {active.length > 0 && (
        <div className="adm-active">
          <strong className="adm-active-title">Active filters:</strong>
          <ul className="adm-active-list">
            {active.map((chip) => (
              <ActiveChip chip={chip} key={chip.id} />
            ))}
          </ul>
          <AdminButton onPress={onClearAll} variant="tertiary">
            Clear all
          </AdminButton>
        </div>
      )}
    </div>
  );
}
