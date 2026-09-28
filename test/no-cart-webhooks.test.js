/*
 * No ERP is asked on a cart change (the ERP programme's pricing rule, owner 2026-09-28):
 * contract prices are synced ahead into each company's shared catalog (erp/prices), and a
 * discount limit is the ERP's to enforce on the order. So the app registers no cart
 * webhook, deploys no webhook action, and offers no switch for either. What Commerce is
 * told comes from the generated manifest, which is what the running app installs.
 */
import { existsSync, readFileSync } from "node:fs";

import schema from "../src/commerce-configuration-1/.generated/configuration-schema.json" with {
  type: "json",
};
import manifest from "../src/commerce-extensibility-1/.generated/app.commerce.manifest.json" with {
  type: "json",
};

describe("Given the app as Commerce installs it", () => {
  test("Then it registers no webhook", () => {
    expect(manifest.webhooks ?? []).toEqual([]);
  });

  test("Then no pricing switch is left in the settings", () => {
    const names = [
      ...manifest.businessConfig.schema.map((s) => s.name),
      ...schema.map((s) => s.name),
    ];
    expect(names).toContain("orders_send");
    expect(names.filter((n) => n.startsWith("pricing_"))).toEqual([]);
  });

  test("Then no cart webhook action is deployed", () => {
    const ext = readFileSync(
      "src/commerce-extensibility-1/ext.config.yaml",
      "utf8",
    );
    expect(ext).toContain("erp:");
    expect(ext).not.toContain("./actions/webhook/");
    expect(existsSync("src/commerce-extensibility-1/actions/webhook")).toBe(
      false,
    );
    expect(existsSync("src/lib/cart-quotes.js")).toBe(false);
  });
});
