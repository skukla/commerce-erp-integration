/*
 * An inbound ERP event is a signal; the handler reads the record back from the ERP (lib/
 * erp-current.js, and the hold handler's rule M2). With several ERPs that read goes to the
 * ERP the event came from (lib/erps.js eventErpId), at its own address and signed with its own
 * credential (AB-16h). Before, every read-back reached the first ERP whatever sent the event.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
  (await import("../../../lib/per-erp-harness.js")).mintPerClient(original),
);
vi.mock("#lib/erp-event-history", () => ({
  recordingErpEvent: (_kind, handle) => handle,
}));
vi.mock("#lib/commerce-before", () => ({
  nameOf: vi.fn(async () => undefined),
  priceOf: vi.fn(async () => undefined),
  quantityOf: vi.fn(async () => undefined),
}));
vi.mock("#src/product/external/updated/sender", () => ({
  sendData: vi.fn(async () => ({ success: true })),
}));
vi.mock("#src/stock/external/updated/sender", () => ({
  sendData: vi.fn(async () => ({ success: true })),
}));
vi.mock("#src/order/commerce-order-api-client", () => ({
  addComment: vi.fn(async () => undefined),
}));
vi.mock("#router/combined-status", () => ({
  applyCombinedStatus: vi.fn(async () => ({ action: "none" })),
  setWholeOrderHold: vi.fn(async () => undefined),
}));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async (_params, sku) => ({
    erp_owner: sku.startsWith("C") ? "contoso" : "erp",
  })),
  sourceCodesOf: vi.fn(async () => []),
}));

import { resetErpTokenCache } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { main as orderHold } from "#src/order/external/hold/index";
import { main as productUpdated } from "#src/product/external/updated/index";
import { sendData as productSent } from "#src/product/external/updated/sender";
import { main as stockUpdated } from "#src/stock/external/updated/index";
import { sendData as stockSent } from "#src/stock/external/updated/sender";

import { fakeState } from "../../../box/state.js";
import { BOTH, CONTOSO, erpFetch, OWN } from "../../../lib/per-erp-harness.js";

const PRODUCT = {
  listPrice: 12,
  name: "Now",
  type: "simple",
  warehouses: [{ code: "main", quantity: 7 }],
};
const line = (sku) => ({ outOfStock: false, quantity: 1, sku, source: "main" });

let erp;
beforeEach(() => {
  resetErpTokenCache();
  erp = erpFetch(() => ({ body: PRODUCT }));
  vi.stubGlobal("fetch", erp.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  resetErpsClient();
});

const stored = (list) =>
  resetErpsClient({ get: async () => ({ value: JSON.stringify(list) }) });
const reads = () => erp.calls.map(({ client, url }) => ({ client, url }));

describe("Given a product event and two ERPs", () => {
  beforeEach(() => stored(BOTH));

  test("Then the product is read back from the ERP the event names, with its own credential", async () => {
    const res = await productUpdated({
      ...OWN,
      data: { erpId: "contoso", price: 1, sku: "S1" },
    });
    expect(res.statusCode).toBe(200);
    expect(reads()).toEqual([
      {
        client: "contoso-client",
        url: "https://b.example/api/v1/web/demo-erp/products/S1",
      },
    ]);
    // Commerce is still written with the integration's own params.
    expect(productSent.mock.calls[0][0].AIO_COMMERCE_AUTH_IMS_CLIENT_ID).toBe(
      "integration-client",
    );
  });

  test("Then an event naming no ERP is the first ERP's", async () => {
    await productUpdated({ ...OWN, data: { price: 1, sku: "S1" } });
    expect(reads()).toEqual([
      {
        client: "integration-client",
        url: "https://a.example/api/v1/web/demo-erp/products/S1",
      },
    ]);
  });

  test("Then an event naming an ERP not in the list is refused, and no ERP is asked", async () => {
    const res = await productUpdated({
      ...OWN,
      data: { erpId: "brand-z", price: 1, sku: "S1" },
    });
    expect(res.error.statusCode).toBe(400);
    expect(erp.calls).toEqual([]);
  });
});

describe("Given a product event and one ERP", () => {
  test("Then it is read back from the ERP the integration deployed with, as before", async () => {
    await productUpdated({ ...OWN, data: { price: 1, sku: "S1" } });
    expect(reads()).toEqual([
      {
        client: "integration-client",
        url: "https://a.example/api/v1/web/demo-erp/products/S1",
      },
    ]);
  });

  test("Then a stored list of one ERP is read from as before too", async () => {
    stored([CONTOSO]);
    await productUpdated({ ...OWN, data: { price: 1, sku: "S1" } });
    expect(reads()[0].url).toBe(
      "https://a.example/api/v1/web/demo-erp/products/S1",
    );
  });
});

describe("Given a stock event and two ERPs", () => {
  beforeEach(() => stored(BOTH));

  test("Then each product is read back from the ERP that owns it, with its own credential", async () => {
    const res = await stockUpdated({ ...OWN, data: [line("C1"), line("N1")] });
    expect(res.statusCode).toBe(200);
    expect(reads()).toEqual([
      {
        client: "contoso-client",
        url: "https://b.example/api/v1/web/demo-erp/products/C1",
      },
      {
        client: "integration-client",
        url: "https://a.example/api/v1/web/demo-erp/products/N1",
      },
    ]);
    expect(stockSent.mock.calls[0][0].data).toEqual([
      { outOfStock: false, quantity: 7, sku: "C1", source: "main" },
      { outOfStock: false, quantity: 7, sku: "N1", source: "main" },
    ]);
  });
});

describe("Given a stock event and one ERP", () => {
  test("Then it is read back from the ERP the integration deployed with, as before", async () => {
    await stockUpdated({ ...OWN, data: [line("C1")] });
    expect(reads()).toEqual([
      {
        client: "integration-client",
        url: "https://a.example/api/v1/web/demo-erp/products/C1",
      },
    ]);
  });
});

describe("Given a hold event", () => {
  const HOLD = {
    erpNumber: "0000001000",
    held: true,
    incrementId: "42",
    orderId: 5,
  };

  test("Then with two ERPs it is recorded on its ERP's part, and no ERP is read with the wrong params", async () => {
    stored(BOTH);
    resetOrderPartsClient(fakeState());
    await writeOrderParts("42", {
      parts: { contoso: { erpNumber: "0000001000", status: "sent" } },
    });
    const res = await orderHold({
      ...OWN,
      data: { ...HOLD, erpId: "contoso" },
    });
    expect(res.statusCode).toBe(200);
    expect(erp.calls).toEqual([]);
  });

  test("Then with one ERP the ERP is asked about its own order, as before (rule M2)", async () => {
    erp = erpFetch(() => ({ body: { creditStatus: "held" } }));
    vi.stubGlobal("fetch", erp.fetch);
    await orderHold({ ...OWN, data: HOLD });
    expect(reads()).toEqual([
      {
        client: "integration-client",
        url: "https://a.example/api/v1/web/demo-erp/orders/0000001000",
      },
    ]);
  });
});
