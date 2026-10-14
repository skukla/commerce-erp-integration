/*
 * A tab's refresh, at the top right of what it updates, the way Admin grids keep their own
 * controls beside the grid (owner, 2026-10-14). It sat in the page band until then, next to the
 * price-publish line, and read as "refresh the prices". It reads the integration's data again
 * (status and Activity), never the whole Admin page: a page reload reconnects the Admin and
 * starts over on Overview.
 */
import Refresh from "@react-spectrum/s2/icons/Refresh";
import { Text } from "@react-spectrum/s2/Text";

import { AdminButton } from "#web/components/admin/admin-button.jsx";

/**
 * @param {object} props
 * @param {boolean} props.busy the page is reading itself again
 * @param {string} props.updated when it was last read, as "just now", "2 minutes ago"
 * @param {() => void} props.onRefresh read it again
 * @param {boolean} [props.disabled] off (Settings with unsaved changes)
 */
export function AdminRefresh({ busy, disabled = false, onRefresh, updated }) {
  return (
    <span className="adm-refresh">
      <span className="adm-muted">Updated {updated}</span>
      {/* While it reads it says so, and is off. A spinner squeezed in beside the word broke
          the button's layout (seen in the parts gallery, 2026-10-14). */}
      <AdminButton isDisabled={busy || disabled} onPress={onRefresh}>
        <Refresh />
        <Text>{busy ? "Refreshing" : "Refresh"}</Text>
      </AdminButton>
    </span>
  );
}
