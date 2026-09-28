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
import {
  Button,
  ButtonGroup,
  Heading,
  InlineAlert,
  ProgressCircle,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
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
      <main className="erp-loading">
        <ProgressCircle aria-label="Loading" isIndeterminate />
      </main>
    );
  }
  return (
    <main>
      {trouble && (
        <InlineAlert variant="negative">
          <Heading>Something went wrong</Heading>
          <Text>{trouble}</Text>
        </InlineAlert>
      )}
      {page && (
        <OrderParts api={api} onError={setError} onReload={load} page={page} />
      )}
      <ButtonGroup>
        <Button onPress={back} variant="secondary">
          Back to the order
        </Button>
      </ButtonGroup>
    </main>
  );
}
