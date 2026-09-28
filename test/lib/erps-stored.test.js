/*
 * The ERP list kept in App Builder State (slice B3a): Demo Builder writes it when an SC adds
 * or removes an ERP; the integration reads it on every order. Nothing stored = today's single
 * ERP from the deployed settings, so an existing install keeps working unchanged.
 */
import {
  erpsProblem,
  loadErps,
  readStoredErps,
  replaceErps,
  resetErpsClient,
  SINGLE_ERP_ID,
} from "#lib/erps";

function memoryState() {
  const store = new Map();
  return {
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    put: vi.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
}

const PARAMS = {
  ERP_BASE_URL: "https://ns.example/api/v1/web/demo-erp",
  ERP_DISPLAY_NAME: "Northwind ERP",
};
const TWO = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example/api/v1/web/demo-erp" },
    id: "erp",
    name: "Northwind ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example/api/v1/web/demo-erp" },
    id: "demo-erp-2",
    name: "Contoso ERP",
  },
];

beforeEach(() => {
  resetErpsClient(memoryState());
});

describe("Given nothing stored", () => {
  test("Then the list is today's single ERP from the deployed settings", async () => {
    expect(await readStoredErps()).toEqual([]);
    expect(await loadErps(PARAMS)).toStrictEqual([
      {
        adapter: "demo-erp",
        connection: { baseUrl: PARAMS.ERP_BASE_URL },
        id: SINGLE_ERP_ID,
        name: "Northwind ERP",
      },
    ]);
  });
});

describe("Given a list Demo Builder stored", () => {
  test("Then it is the list, in order, and a second store replaces it whole", async () => {
    await replaceErps(TWO);
    expect(await loadErps(PARAMS)).toEqual(TWO);
    await replaceErps([TWO[1]]);
    expect(await loadErps(PARAMS)).toEqual([TWO[1]]);
  });
});

describe("Given a list to check before it is stored", () => {
  test("Then a well-formed list has no problem", () => {
    expect(erpsProblem(TWO)).toBeNull();
  });

  test.each([
    ["not a list", { erps: TWO }, "entries is a list"],
    ["an empty list", [], "at least one ERP"],
    ["an id that is not a slug", [{ ...TWO[0], id: "Northwind ERP" }], "id"],
    ["a missing name", [{ ...TWO[0], name: " " }], "name"],
    ["an unknown kind of ERP", [{ ...TWO[0], adapter: "sap" }], "adapter"],
    [
      "a connection that is not an https address",
      [{ ...TWO[0], connection: { baseUrl: "ftp://x" } }],
      "connection",
    ],
    [
      "one id twice",
      [TWO[0], { ...TWO[1], id: "erp" }],
      "id erp is used twice",
    ],
    [
      "one name twice, whatever its case",
      [TWO[0], { ...TWO[1], name: "northwind erp" }],
      "name",
    ],
  ])("Then %s is refused", (_label, entries, words) => {
    expect(erpsProblem(entries)).toContain(words);
  });
});
