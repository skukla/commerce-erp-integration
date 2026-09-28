/*
 * The page the order view's "ERP parts" button opens (adminUi.order.viewButtons): the order's
 * parts, read by the Commerce order id the button hands over. How it looks is OrderParts,
 * which the local preview renders against stand-in data.
 */
import {
  useHostConnection,
  useIms,
  useOrderViewButtonContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { Alert, Spinner } from "#web/components/controls.jsx";
import { OrderParts } from "#web/components/order-parts.jsx";

export function OrderPartsPage() {
  const { data: ims, error: imsError } = useIms();
  const { data: context, error: contextError } = useOrderViewButtonContext();
  const { actions: host } = useHostConnection();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const orderId = context?.orderId;

  const load = useCallback(async () => {
    if (!(api && orderId)) {
      return;
    }
    try {
      setPage(await api.orderParts(orderId));
    } catch (e) {
      setError(e.message);
    }
  }, [api, orderId]);
  useEffect(() => {
    load();
  }, [load]);
  const back = useCallback(() => host?.close(), [host]);

  const trouble = imsError?.message ?? contextError?.message ?? error;
  if (!(page || trouble)) {
    return (
      <div className="erp-loading">
        <Spinner label="Loading" />
      </div>
    );
  }
  return (
    <main className="erp-subpage">
      {trouble && <Alert title="Something went wrong">{trouble}</Alert>}
      {page && (
        <OrderParts api={api} onError={setError} onReload={load} page={page} />
      )}
      <div className="actions">
        <button className="btn btn-secondary" onClick={back} type="button">
          Back to the order
        </button>
      </div>
    </main>
  );
}
