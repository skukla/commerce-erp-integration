/*
 * No ERP is asked on a cart change (the ERP programme's pricing rule, owner 2026-09-28):
 * contract prices are synced ahead into each company's shared catalog (erp/prices), and a
 * discount limit is the ERP's to enforce on the order. So the app registers no cart webhook
 * and offers no pricing switch. The same rule names the ONE thing asked live: as the order is
 * placed, each owning ERP is asked once about credit and availability (AB-19, AB-20) — so the
 * app registers exactly one webhook, on order placement, and its one webhook action is that.
 * What Commerce is told comes from the generated manifest, which is what the running app
 * installs.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import schema from "../src/commerce-configuration-1/.generated/configuration-schema.json" with {
  type: "json",
};
import manifest from "../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

const PLACEMENT = "plugin.sales.api.order_management.place";

describe("Given the app as Commerce installs it", () => {
  test("Then it registers exactly one webhook, on order placement, and none on the cart", () => {
    const hooks = manifest.webhooks ?? [];
    expect(hooks.map((h) => h.webhook.webhook_method)).toEqual([PLACEMENT]);
    expect(hooks[0].webhook.webhook_type).toBe("before");
    expect(hooks[0].runtimeAction).toBe("webhook/placement");
    // The removed cart hooks stay gone: nothing on the totals collector.
    expect(
      hooks.filter((h) => h.webhook.webhook_method.includes("totals_collector")),
    ).toEqual([]);
  });

  test("Then no pricing switch is left in the settings", () => {
    const names = [
      ...manifest.businessConfig.schema.map((s) => s.name),
      ...schema.map((s) => s.name),
    ];
    expect(names).toContain("orders_send");
    expect(names.filter((n) => n.startsWith("pricing_"))).toEqual([]);
  });

  test("Then the only webhook action deployed is the placement one; the cart ones are gone", () => {
    const ext = readFileSync(
      "src/commerce-extensibility-1/ext.config.yaml",
      "utf8",
    );
    expect(ext).toContain("erp:");
    expect(ext).toContain("./actions/webhook/actions.config.yaml");
    expect(readdirSync("src/commerce-extensibility-1/actions/webhook").sort()).toEqual(
      ["actions.config.yaml", "placement"],
    );
    expect(existsSync("src/lib/cart-quotes.js")).toBe(false);
  });
});
