/*
 * Who this app says it is to Commerce. Commerce knows an App Management app by its
 * `metadata.id`, and the library names the app's webhooks and events from it, so a second
 * copy on the same Commerce store needs an id and a menu of its own. Demo Builder tells a
 * copy its number at deploy (DEMO_BUILDER_COPY_NUMBER); the first copy is told nothing and
 * keeps the id it was installed with, which Commerce refuses to change.
 */

async function loadConfig(env) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  return (await import("../app.commerce.config.ts")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Given the app's identity in Commerce", () => {
  test("Then the first copy keeps the id and menu it was installed with", async () => {
    const config = await loadConfig({ DEMO_BUILDER_COPY_NUMBER: "" });

    expect(config.metadata.id).toBe("commerce-erp-integration");
    expect(config.adminUi.menu.id).toBe("erp_integration");
  });

  test("Then a second copy has an id and a menu of its own", async () => {
    const config = await loadConfig({ DEMO_BUILDER_COPY_NUMBER: "2" });

    expect(config.metadata.id).toBe("erp-integration-2");
    expect(config.adminUi.menu.id).toBe("erp_integration_2");
  });

  // The library counts a webhook as an app's when its name starts with the app's id (made
  // lower-case, non-letters to "_"). A copy whose id began with the first copy's would have
  // its webhooks deleted by the first copy's upgrade or removal.
  test("Then no copy's webhooks look like another copy's", async () => {
    const prefix = (id) => `${id.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_`;
    const ids = [
      (await loadConfig({ DEMO_BUILDER_COPY_NUMBER: "" })).metadata.id,
      (await loadConfig({ DEMO_BUILDER_COPY_NUMBER: "2" })).metadata.id,
      (await loadConfig({ DEMO_BUILDER_COPY_NUMBER: "12" })).metadata.id,
    ];

    for (const a of ids) {
      for (const b of ids.filter((other) => other !== a)) {
        expect(`${prefix(b)}erp_contract_price`.startsWith(prefix(a))).toBe(
          false,
        );
      }
    }
  });

  test("Then the id Demo Builder gives it is the id it declares", async () => {
    const config = await loadConfig({ DEMO_BUILDER_APP_ID: "contoso-erp" });

    expect(config.metadata.id).toBe("contoso-erp");
    expect(config.adminUi.menu.id).toBe("contoso_erp");
  });

  test("Then a given id wins over the copy number", async () => {
    const config = await loadConfig({
      DEMO_BUILDER_APP_ID: "contoso-erp",
      DEMO_BUILDER_COPY_NUMBER: "2",
    });

    expect(config.metadata.id).toBe("contoso-erp");
  });

  test("Then an id with anything Adobe refuses stops the build", async () => {
    await expect(
      loadConfig({ DEMO_BUILDER_APP_ID: "Contoso ERP" }),
    ).rejects.toThrow("DEMO_BUILDER_APP_ID");
  });

  test("Then a copy number that is not a number stops the build", async () => {
    await expect(
      loadConfig({ DEMO_BUILDER_COPY_NUMBER: "2; rm" }),
    ).rejects.toThrow("DEMO_BUILDER_COPY_NUMBER");
  });

  test("Then the menu is named after the ERP, so two ERPs can be told apart", async () => {
    const config = await loadConfig({ ERP_DISPLAY_NAME: "Northwind ERP" });

    expect(config.adminUi.menu.label).toBe("Northwind ERP");
    expect(config.adminUi.menu.pageTitle).toBe("Northwind ERP");
    expect(config.metadata.displayName).toBe("Northwind ERP");
  });

  test("Then with no ERP name the menu reads as before", async () => {
    const config = await loadConfig({ ERP_DISPLAY_NAME: "" });

    expect(config.adminUi.menu.label).toBe("ERP integration");
    expect(config.metadata.displayName).toBe("ERP integration");
  });
});
