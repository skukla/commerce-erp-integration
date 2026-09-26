import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";
import { CrashBoundary } from "#web/components/crash-boundary.jsx";
import { MainPage } from "#web/pages/main-page.jsx";

createExtensionApp({
  menu: (
    <CrashBoundary>
      <MainPage />
    </CrashBoundary>
  ),
  metadata: {
    extensionId: config.metadata.id,
  },
});
