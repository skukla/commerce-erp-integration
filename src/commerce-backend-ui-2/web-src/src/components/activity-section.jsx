/*
 * What crossed between Commerce and the ERP and how it ended, with Retry on what did not get
 * through, and one order followed end to end.
 */
import { Heading } from "@react-spectrum/s2";

import { History } from "#web/components/history.jsx";
import { OrderTrace } from "#web/components/order-trace.jsx";

export function ActivitySection({ api, erpName, erps, onError }) {
  return (
    <section aria-labelledby="erp-activity-heading" className="erp-section">
      <Heading id="erp-activity-heading" level={2}>
        Activity
      </Heading>
      <History api={api} erpName={erpName} erps={erps} onError={onError} />
      <OrderTrace api={api} erpName={erpName} onError={onError} />
    </section>
  );
}
