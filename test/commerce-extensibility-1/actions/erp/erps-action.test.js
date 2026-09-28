/* The ERP-list action: GET reads the list; PUT replaces it (Demo Builder, when an ERP is added or removed). */
import { resetErpsClient } from "#lib/erps";
import { main } from "#src/erp/erps/index";

const put = (body) => ({
  __ow_body: JSON.stringify(body),
  __ow_method: "put",
});
const ENTRY = {
  adapter: "demo-erp",
  connection: { baseUrl: "https://a.example/api/v1/web/demo-erp" },
  id: "erp",
  name: "Northwind ERP",
};

beforeEach(() => {
  const store = new Map();
  resetErpsClient({
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  });
});

describe("Given the ERP-list action", () => {
  test("Then GET answers the single ERP from the settings, and says nothing is stored", async () => {
    const res = await main({
      __ow_method: "get",
      ERP_BASE_URL: "https://x.example",
      ERP_DISPLAY_NAME: "Acme ERP",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.stored).toBe(false);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ id: "erp", name: "Acme ERP" });
  });

  test("Then PUT stores the list and GET reads it back", async () => {
    const res = await main(put({ entries: [ENTRY] }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ entries: 1 });
    const read = await main({ __ow_method: "get" });
    expect(read.body).toEqual({ entries: [ENTRY], stored: true });
  });

  test("Then a malformed PUT is refused and nothing is stored", async () => {
    const res = await main(put({ entries: [{ ...ENTRY, adapter: "sap" }] }));
    expect(res.statusCode ?? res.error?.statusCode).toBe(400);
    expect((await main({ __ow_method: "get" })).body.stored).toBe(false);
  });

  test("Then another method is refused", async () => {
    const res = await main({ __ow_method: "delete" });
    expect(res.statusCode ?? res.error?.statusCode).toBe(400);
  });
});
