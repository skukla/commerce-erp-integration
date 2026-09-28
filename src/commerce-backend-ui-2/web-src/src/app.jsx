import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";
import { CrashBoundary } from "#web/components/crash-boundary.jsx";
import { MainPage } from "#web/pages/main-page.jsx";
import { MoveStockPage } from "#web/pages/move-stock-page.jsx";
import { OrderPartsPage } from "#web/pages/order-parts-page.jsx";

createExtensionApp({
  menu: (
    <CrashBoundary>
      <MainPage />
    </CrashBoundary>
  ),
  metadata: {
    extensionId: config.metadata.id,
  },
  // The product grid's "Move stock between <ERP> warehouses" opens here (adminUi.product),
  // and the order view's "ERP parts" button (adminUi.order.viewButtons).
  routes: [
    {
      element: (
        <CrashBoundary>
          <MoveStockPage />
        </CrashBoundary>
      ),
      path: "move-stock",
    },
    {
      element: (
        <CrashBoundary>
          <OrderPartsPage />
        </CrashBoundary>
      ),
      path: "order-parts",
    },
  ],
});
