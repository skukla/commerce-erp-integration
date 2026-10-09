/*
 * The placement webhook (plugin.sales.api.order_management.place, before): the live credit
 * and availability checks as the order is placed. Blocks only on a definitive credit "no";
 * fails open on everything else, because a down ERP must not stop a checkout.
 *
 * The collaborators are mocked at the module seam; the ARGUMENTS to the ERP are asserted,
 * because a mock answers the same whatever it is handed — the path, the body and which ERP's
 * base URL the call targets are the contract under test.
 */
import {
  exceptionOperation,
  ok,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";

vi.mock("#lib/erp", () => ({ erpRequest: vi.fn() }));
vi.mock("#lib/erps", () => ({
  listErps: vi.fn(() => []),
  loadErps: vi.fn(async () => [
    {
      connection: { baseUrl: "https://acme.example" },
      id: "acme",
      name: "ACME ERP",
    },
  ]),
}));
vi.mock("#lib/key-map", () => ({ erpCustomerOf: vi.fn(async () => "C1") }));
const websiteCodeOf = vi.fn(async (_p, storeId) =>
  Number(storeId) === 2 ? "eu" : "base",
);
vi.mock("#lib/order-deps", () => ({
  orderSyncDeps: () => ({
    companyIdOf: vi.fn(async () => "7"),
    ownsSku: vi.fn(async () => true),
    // Present on the real deps: the placement split must not use it (one read per variant).
    variantsOf: vi.fn(async () => ({ parentSku: null, skus: [] })),
    websiteCodeOf,
  }),
}));
// The batched ownership readers (lib/ownership-readers.js): one Commerce search for the
// order's SKUs. ACME has no ownership setting, so the default rule applies: it owns a product
// whose erp_owner is its id (router/ownership.js), read from these answers.
const readers = {
  expect: vi.fn(),
  productAttributes: vi.fn(async () => ({ erp_owner: "acme" })),
  sourceCodesOf: vi.fn(async () => []),
};
vi.mock("#lib/ownership-readers", () => ({ ownershipReaders: () => readers }));

import { erpRequest } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { main, PLACEMENT_DEADLINE_MS } from "#src/webhook/placement/index";

const ALLOW = ok(successOperation());
const order = (extra = {}) => ({
  order: {
    base_currency_code: "USD",
    customer_id: 5,
    items: [
      { base_price: 100, item_id: 1, qty_ordered: 2, sku: "A1" },
      {
        base_price: 10,
        item_id: 2,
        parent_item_id: 1,
        qty_ordered: 2,
        sku: "A1-child",
      },
    ],
    ...extra,
  },
});
const answer = (data) => ({ data, ok: true, status: 200 });

/** Route each ERP call by its action: credit to `partners`, availability to `products`. */
function erpAnswers({ credit, availability }) {
  erpRequest.mockImplementation((_params, action) => {
    if (action === "partners") {
      return typeof credit === "function" ? credit() : answer(credit);
    }
    return typeof availability === "function"
      ? availability()
      : answer({ lines: availability });
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

test("an approved company order places, and the ERP was asked the right questions", async () => {
  erpAnswers({
    availability: [{ canPromiseNow: true, sku: "A1" }],
    credit: { reason: null, status: "approved" },
  });
  const res = await main(order());
  expect(res).toEqual(ALLOW);
  const { calls } = erpRequest.mock;
  const credit = calls.find(([, action]) => action === "partners");
  const avail = calls.find(([, action]) => action === "products");
  // Which ERP: the call targets ACME's own base URL, not the deploy-time default.
  expect(credit[0].ERP_BASE_URL).toBe("https://acme.example");
  expect(credit[2]).toMatchObject({
    body: { currency: "USD", net: 200 },
    method: "POST",
    path: "/C1/credit-check",
  });
  // The net is the parent line only; the child travels with it and is not double-counted.
  expect(avail[2]).toMatchObject({
    body: { lines: [{ qty: 2, sku: "A1" }] },
    path: "/availability",
  });
});

test("an over-limit order is refused with the ERP's reason, shown to the shopper", async () => {
  erpAnswers({
    availability: [],
    credit: {
      reason: "Credit limit USD 1,000.00 exceeded by USD 100.00",
      status: "held",
    },
  });
  const res = await main(order());
  expect(res).toEqual(
    ok(exceptionOperation("Credit limit USD 1,000.00 exceeded by USD 100.00")),
  );
});

test("an ERP that times out does not stop the order (fail-open)", async () => {
  erpAnswers({
    availability: () => Promise.reject(new Error("aborted")),
    credit: () => Promise.reject(new Error("aborted")),
  });
  expect(await main(order())).toEqual(ALLOW);
});

test("an ERP that answers an error status does not stop the order", async () => {
  erpAnswers({
    availability: () => ({ data: {}, ok: false, status: 503 }),
    credit: () => ({ data: {}, ok: false, status: 500 }),
  });
  expect(await main(order())).toEqual(ALLOW);
});

test("a payload with no order lines places without asking any ERP", async () => {
  expect(await main({ order: { customer_id: 5 } })).toEqual(ALLOW);
  expect(erpRequest).not.toHaveBeenCalled();
});

test("a guest order asks no credit question but still asks availability", async () => {
  erpAnswers({ availability: [], credit: { status: "approved" } });
  const res = await main(order({ customer_id: null }));
  expect(res).toEqual(ALLOW);
  const actions = erpRequest.mock.calls.map(([, action]) => action);
  expect(actions).toEqual(["products"]);
});

test("the observer form of the payload (order nested under data) is read too", async () => {
  erpAnswers({ availability: [], credit: { status: "approved" } });
  const res = await main({ data: order() });
  expect(res).toEqual(ALLOW);
  expect(erpRequest).toHaveBeenCalled();
});

test("the order's SKUs are named to the batched readers, so ownership is one Commerce search", async () => {
  erpAnswers({ availability: [], credit: { status: "approved" } });
  await main(order());
  expect(readers.expect).toHaveBeenCalledWith(["A1", "A1-child"]);
});

test("with an ERP owning the products sold on a website, the order's website decides which ERP is asked (AB-64)", async () => {
  loadErps.mockResolvedValue([
    {
      connection: { baseUrl: "https://us.example" },
      id: "us",
      name: "US ERP",
      settings: { structure_owns: "websites", structure_owns_websites: "base" },
    },
    {
      connection: { baseUrl: "https://eu.example" },
      id: "eu",
      name: "EU ERP",
      settings: { structure_owns: "websites", structure_owns_websites: "eu" },
    },
  ]);
  erpAnswers({ availability: [], credit: { status: "approved" } });
  await main(order({ store_id: 2 }));
  expect(websiteCodeOf).toHaveBeenCalledWith(expect.anything(), 2);
  const asked = [
    ...new Set(erpRequest.mock.calls.map(([p]) => p.ERP_BASE_URL)),
  ];
  expect(asked).toEqual(["https://eu.example"]);
  // No product read: the order's website answered.
  expect(readers.productAttributes).not.toHaveBeenCalled();
});

test("with a catch-all ERP (all) and an attribute ERP, a tagged product is asked of the attribute ERP alone (owner, 2026-10-09)", async () => {
  loadErps.mockResolvedValue([
    {
      connection: { baseUrl: "https://justrite.example" },
      id: "justrite",
      name: "Justrite ERP",
      settings: { structure_owns: "all" },
    },
    {
      connection: { baseUrl: "https://accuform.example" },
      id: "accuform",
      name: "Accuform ERP",
      settings: {
        structure_owns: "attribute",
        structure_owns_attribute: "erp_owner=accuform",
      },
    },
  ]);
  readers.productAttributes.mockResolvedValueOnce({ erp_owner: "accuform" });
  erpAnswers({ availability: [], credit: { status: "approved" } });
  const res = await main(order());
  expect(res).toEqual(ALLOW);
  const asked = [
    ...new Set(erpRequest.mock.calls.map(([p]) => p.ERP_BASE_URL)),
  ];
  expect(asked).toEqual(["https://accuform.example"]);
});

test("checks that outrun the deadline let the order through before Commerce gives up (AB-55)", async () => {
  vi.useFakeTimers();
  try {
    // Nothing ever answers: the Commerce reads before the ERP calls have no timeout of their
    // own, and on a slow store they ran past Commerce's 10 s (measured 2026-10-02: 16 s).
    loadErps.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = main(order());
    await vi.advanceTimersByTimeAsync(PLACEMENT_DEADLINE_MS);
    expect(await pending).toEqual(ALLOW);
    expect(PLACEMENT_DEADLINE_MS).toBeLessThan(10_000);
  } finally {
    vi.useRealTimers();
  }
});

test("a failure inside the checks themselves fails open", async () => {
  loadErps.mockRejectedValueOnce(new Error("state unreadable"));
  expect(await main(order())).toEqual(ALLOW);
});
