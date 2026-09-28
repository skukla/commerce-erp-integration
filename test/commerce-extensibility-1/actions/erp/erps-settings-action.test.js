/*
 * Per-ERP settings through the ERP-list action (Phase B slice B3b): an entry may carry its own
 * settings (PUT keeps them), and the Admin page saves one ERP's settings with PATCH, at the
 * ERP's defaults or at one website.
 */
import { resetErpsClient } from "#lib/erps";
import { main } from "#src/erp/erps/index";

const call = (method, body) => ({
  __ow_body: JSON.stringify(body),
  __ow_method: method,
});
const entry = (id, extra = {}) => ({
  adapter: "demo-erp",
  connection: { baseUrl: `https://${id}.example` },
  id,
  name: `${id} ERP`,
  ...extra,
});

beforeEach(() => {
  const store = new Map();
  resetErpsClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
});

const listed = async () => (await main({ __ow_method: "get" })).body.entries;

describe("Given ERP entries with their own settings", () => {
  test("Then PUT keeps an entry's settings and refuses one it cannot hold", async () => {
    const settings = { structure_order_prefix: "BRA" };
    expect(
      (
        await main(
          call("put", {
            entries: [entry("brand-a", { settings }), entry("brand-b")],
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await listed())[0].settings).toEqual(settings);
    const refused = await main(
      call("put", {
        entries: [entry("brand-a", { settings: { orders_send: false } })],
      }),
    );
    expect(refused.error.statusCode).toBe(400);
  });

  test("Then PATCH saves one ERP's settings, at its defaults or at a website, and null removes a value", async () => {
    await main(call("put", { entries: [entry("brand-a"), entry("brand-b")] }));
    let res = await main(
      call("patch", {
        id: "brand-b",
        values: { structure_order_prefix: "BRB" },
      }),
    );
    expect(res.statusCode).toBe(200);
    res = await main(
      call("patch", {
        id: "brand-b",
        values: { structure_sales_org: "2100" },
        website: "bodea",
      }),
    );
    expect(res.body.entry.settings).toEqual({
      structure_order_prefix: "BRB",
      websites: { bodea: { structure_sales_org: "2100" } },
    });
    await main(
      call("patch", {
        id: "brand-b",
        values: { structure_order_prefix: null },
      }),
    );
    const [a, b] = await listed();
    expect(a.settings).toBeUndefined();
    expect(b.settings).toEqual({
      websites: { bodea: { structure_sales_org: "2100" } },
    });
  });

  test("Then PATCH refuses an unknown ERP, a setting that is not an ERP's, and a list nobody stored", async () => {
    expect(
      (await main(call("patch", { id: "x", values: {} }))).error.statusCode,
    ).toBe(400);
    await main(call("put", { entries: [entry("brand-a"), entry("brand-b")] }));
    expect(
      (
        await main(
          call("patch", {
            id: "nobody",
            values: { structure_order_prefix: "X" },
          }),
        )
      ).error.statusCode,
    ).toBe(400);
    expect(
      (
        await main(
          call("patch", { id: "brand-a", values: { orders_send: false } }),
        )
      ).error.statusCode,
    ).toBe(400);
  });
});
