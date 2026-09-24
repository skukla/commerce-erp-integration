/*
 * The integration's settings over @adobe/aio-commerce-lib-config. The library is a
 * stand-in holding values per selector, so these tests cover what this module decides:
 * defaults, the container cache, falling back to Default Config, and reading Commerce's
 * websites before the first page load.
 */
const { store, tree, mockGetConfiguration, mockSetConfiguration, mockSync } =
  vi.hoisted(() => {
    const values = new Map();
    const scopes = { value: [] };
    return {
      mockGetConfiguration: vi.fn((selector) => {
        const key = JSON.stringify(selector);
        if (!values.has(key)) {
          return Promise.reject(new Error("INVALID_SCOPE"));
        }
        return Promise.resolve({
          config: Object.entries(values.get(key)).map(([name, value]) => ({
            name,
            origin: { code: "x", level: "website" },
            value,
          })),
          scope: { code: "x", id: "s", level: "website" },
        });
      }),
      mockSetConfiguration: vi.fn(async () => ({})),
      mockSync: vi.fn(async () => ({
        scopeTree: [...scopes.value, { code: "commerce", level: "commerce" }],
        synced: true,
      })),
      store: values,
      tree: scopes,
    };
  });
vi.mock("@adobe/aio-commerce-lib-config", () => ({
  byCodeAndLevel: (code, level) => ({ code, level }),
  byScopeId: (id) => ({ id }),
  byStoreViewId: (storeViewId) => ({ storeViewId }),
  getConfiguration: mockGetConfiguration,
  getScopeTree: vi.fn(async () => ({ scopeTree: tree.value })),
  initialize: vi.fn(),
  setConfiguration: mockSetConfiguration,
  syncCommerceScopes: mockSync,
}));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceInstance: vi.fn(async () => ({
    baseUrl: "https://commerce.example/api",
    env: "saas",
  })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({ strategy: "ims" })),
}));

import {
  clearSettingsCache,
  SETTING_DEFAULTS,
  saveProblem,
  saveSettings,
  settingScopes,
  settingsFor,
  settingsPage,
} from "#lib/settings";

const DEFAULT_KEY = JSON.stringify({ code: "global", level: "global" });
const storeView = (id) => JSON.stringify({ storeViewId: id });

beforeEach(() => {
  store.clear();
  tree.value = [{ code: "global", level: "global" }];
  clearSettingsCache();
  vi.useRealTimers();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the declared settings", () => {
  test("Then every switch defaults to on, and the structure fields to a single ERP selling everything as sales organisation 1000", () => {
    expect(SETTING_DEFAULTS).toStrictEqual({
      orders_hold_offline: true,
      orders_send: true,
      orders_status_on_confirm: true,
      pricing_contract_prices: true,
      pricing_discount_ceiling: true,
      structure_order_prefix: "",
      structure_owns: "all",
      structure_owns_attribute: "",
      structure_owns_sources: "",
      structure_sales_org: "1000",
      structure_sales_org_name: "",
    });
  });
});

describe("Given a checkout reading its settings", () => {
  test("Then a store view's values win over the defaults", async () => {
    store.set(storeView(2), { orders_send: false });
    const values = await settingsFor(2);
    expect(values).toStrictEqual({ ...SETTING_DEFAULTS, orders_send: false });
  });

  test("Then an unknown store view reads Default Config", async () => {
    store.set(DEFAULT_KEY, { pricing_contract_prices: false });
    const values = await settingsFor(9);
    expect(values.pricing_contract_prices).toBe(false);
    expect(mockGetConfiguration).toHaveBeenCalledTimes(2);
  });

  test("Then nothing readable answers the defaults, with a warning, never an error", async () => {
    const logger = { warn: vi.fn() };
    await expect(settingsFor(3, logger)).resolves.toStrictEqual(
      SETTING_DEFAULTS,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "settings unreadable, using defaults: INVALID_SCOPE",
    );
  });

  test("Then no store view reads Default Config only", async () => {
    store.set(DEFAULT_KEY, { orders_hold_offline: false });
    const values = await settingsFor(undefined);
    expect(values.orders_hold_offline).toBe(false);
    expect(mockGetConfiguration).toHaveBeenCalledExactlyOnceWith({
      code: "global",
      level: "global",
    });
  });

  test("Then a read is kept for a minute, then read again", async () => {
    vi.useFakeTimers();
    store.set(storeView(2), { orders_send: false });
    await settingsFor(2);
    store.set(storeView(2), { orders_send: true });
    expect((await settingsFor(2)).orders_send).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect((await settingsFor(2)).orders_send).toBe(true);
    expect(mockGetConfiguration).toHaveBeenCalledTimes(2);
  });

  test("Then a save in this container is read at once", async () => {
    store.set(storeView(2), { orders_send: false });
    await settingsFor(2);
    store.set(storeView(2), { orders_send: true });
    await saveSettings("s1", { orders_send: true });
    expect((await settingsFor(2)).orders_send).toBe(true);
  });
});

describe("Given the settings page", () => {
  test("Then the first load reads Commerce's websites with the store's address and credential", async () => {
    store.set(DEFAULT_KEY, {});
    const page = await settingsPage({ AIO: "params" });
    expect(mockSync).toHaveBeenCalledExactlyOnceWith({
      auth: { strategy: "ims" },
      config: { baseUrl: "https://commerce.example/api", flavor: "saas" },
    });
    expect(page.scopes.map((s) => s.level)).toStrictEqual([
      "global",
      "commerce",
    ]);
    expect(page.fields.map((f) => f.name)).toStrictEqual(
      Object.keys(SETTING_DEFAULTS),
    );
    expect(page.fields[0]).toStrictEqual({
      default: true,
      description:
        "Orders placed on this website are created in the ERP, and the ERP's order number is written back.",
      label: "Send orders to the ERP",
      name: "orders_send",
      type: "boolean",
    });
  });

  test("Then a later load uses the websites already read, unless asked to refresh", async () => {
    tree.value = [
      { code: "global", level: "global" },
      { code: "commerce", level: "commerce" },
    ];
    await settingScopes({});
    expect(mockSync).not.toHaveBeenCalled();
    await settingScopes({}, { refresh: true });
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  test("Then websites that cannot be read are an error", async () => {
    mockSync.mockResolvedValueOnce({
      error: "401",
      scopeTree: [],
      synced: false,
    });
    await expect(settingScopes({})).rejects.toThrow(
      "Commerce's websites could not be read: 401",
    );
  });

  test("Then a scope's values carry where each comes from", async () => {
    tree.value.push({ code: "commerce", level: "commerce" });
    store.set(JSON.stringify({ id: "w1" }), { orders_send: false });
    const page = await settingsPage({}, "w1");
    expect(page.values).toStrictEqual([
      {
        name: "orders_send",
        origin: { code: "x", level: "website" },
        value: false,
      },
    ]);
  });

  test("Then a save is sent as the library's list, at the chosen scope", async () => {
    await saveSettings("w1", {
      orders_send: false,
      pricing_contract_prices: null,
    });
    expect(mockSetConfiguration).toHaveBeenCalledExactlyOnceWith(
      {
        config: [
          { name: "orders_send", value: false },
          { name: "pricing_contract_prices", value: null },
        ],
      },
      { id: "w1" },
    );
  });

  test("Then Default Config is saved when no scope is given", async () => {
    await saveSettings(undefined, { orders_send: false });
    expect(mockSetConfiguration.mock.calls[0][1]).toStrictEqual({
      code: "global",
      level: "global",
    });
  });

  test.each([
    [undefined, "values must be an object of setting names"],
    [[], "values must be an object of setting names"],
    [{}, "nothing to save"],
    [{ colour: true }, "colour is not a setting"],
    [{ orders_send: "yes" }, "orders_send must be true, false or null"],
  ])("Then a save of %j is refused: %s", (values, problem) => {
    expect(saveProblem(values)).toBe(problem);
  });

  test("Then true, false and null are accepted", () => {
    expect(
      saveProblem({
        orders_hold_offline: null,
        orders_send: false,
        pricing_discount_ceiling: true,
      }),
    ).toBeNull();
  });
});

const FOUR_CHARS = /exactly four upper-case letters or digits/u;
const TEXT_OR_NULL = /must be text or null/u;
const PREFIX_WORDS = /one to six upper-case/u;
const ONE_OF_OWNS = /must be one of all, sources, attribute/u;
const ATTRIBUTE_WORDS = /attribute code and a value/u;
const BOOLEAN_WORDS = /true, false or null/u;

describe("Given the Structure settings (business-structure plan, step 02)", () => {
  test("Then a save takes a value of the setting's own type and refuses the rest, in words", async () => {
    const lib = await import("#lib/settings");
    expect(lib.saveProblem({ structure_sales_org: "2000" })).toBeNull();
    expect(lib.saveProblem({ structure_sales_org: "EU01" })).toBeNull();
    expect(lib.saveProblem({ structure_sales_org: "20" })).toMatch(FOUR_CHARS);
    expect(lib.saveProblem({ structure_sales_org: "" })).toMatch(FOUR_CHARS);
    expect(lib.saveProblem({ structure_sales_org: true })).toMatch(
      TEXT_OR_NULL,
    );
    expect(lib.saveProblem({ structure_sales_org: null })).toBeNull();
    expect(lib.saveProblem({ structure_order_prefix: "ACME" })).toBeNull();
    expect(lib.saveProblem({ structure_order_prefix: "" })).toBeNull();
    expect(lib.saveProblem({ structure_order_prefix: "acme-erp" })).toMatch(
      PREFIX_WORDS,
    );
    expect(lib.saveProblem({ structure_owns: "sources" })).toBeNull();
    expect(lib.saveProblem({ structure_owns: "everything" })).toMatch(
      ONE_OF_OWNS,
    );
    expect(
      lib.saveProblem({ structure_owns_sources: "default, east" }),
    ).toBeNull();
    expect(
      lib.saveProblem({ structure_owns_attribute: "erp_owner=ACME" }),
    ).toBeNull();
    expect(lib.saveProblem({ structure_owns_attribute: "erp_owner" })).toMatch(
      ATTRIBUTE_WORDS,
    );
    expect(lib.saveProblem({ orders_send: "yes" })).toMatch(BOOLEAN_WORDS);
  });
  test("Then every structure setting has a declared default, and the sales organisation defaults to 1000", async () => {
    const lib = await import("#lib/settings");
    expect(lib.SETTING_DEFAULTS.structure_sales_org).toBe("1000");
    expect(lib.SETTING_DEFAULTS.structure_owns).toBe("all");
    for (const name of [
      "structure_sales_org_name",
      "structure_order_prefix",
      "structure_owns_sources",
      "structure_owns_attribute",
    ]) {
      expect(lib.SETTING_DEFAULTS[name]).toBe("");
    }
  });
});
