/*
 * Three changes made in Commerce that reached the ERP and showed nowhere under Activity until
 * 2026-10-14: a new product, a stock quantity, and a company. Each now leaves one row saying
 * what the ERP was told, or why it was not. The actions are the real ones; the ERP client and
 * Commerce's reads are faked, and State is in memory.
 */
import { fakeState } from "../../box/state.js";

const state = fakeState();
vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => state },
}));
vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/owner-params", () => ({
  ownerParams: vi.fn(async (params) => ({ params })),
}));
vi.mock("#lib/commerce", () => ({
  listWebsites: vi.fn(async () => [{ code: "bodea", id: 3, name: "Bodea" }]),
  productAttributes: vi.fn(async () => ({})),
  readCompanyRow: vi.fn(async () => ({
    blocked: false,
    creditLimit: 5000,
    id: 21,
    name: "Kukla Studios",
    websiteId: 3,
  })),
  skuForProductId: vi.fn(async () => "smartcable"),
  sourceCodesOf: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => [
    { code: "default", name: "Default Source", quantity: 1000 },
  ]),
  websiteCodesOf: vi.fn(async () => []),
}));
vi.mock("#lib/settings", () => ({ websiteSettings: vi.fn(async () => ({})) }));

import { erp } from "#lib/erp";
import { resetErpsClient } from "#lib/erps";
import { readHistory, resetHistoryClient } from "#lib/history";
import { resetKeyMapClient } from "#lib/key-map";
import { ownerParams } from "#lib/owner-params";
import { main as companySaved } from "#src/company/commerce/saved/index";
import { main as productCreated } from "#src/product/commerce/created/index";
import { main as stockSaved } from "#src/stock/commerce/updated/index";

const PARAMS = { ERP_DISPLAY_NAME: "Demo ERP" };
const NEW_PRODUCT = {
  ...PARAMS,
  data: {
    value: {
      created_at: "2026-10-14 09:00:00",
      name: "Smart cable",
      price: "12.500000",
      sku: "smartcable",
      updated_at: "2026-10-14 09:00:00",
    },
  },
};
const STOCK = {
  ...PARAMS,
  data: {
    value: { is_in_stock: true, item_id: 41, product_id: 57, qty: "1000" },
  },
};
const COMPANY = { ...PARAMS, data: { value: { id: 21 } } };
const REFUSED = {
  data: { errorMessage: "ERP is offline" },
  ok: false,
  status: 503,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.reset();
  resetHistoryClient(state);
  resetErpsClient(fakeState());
  resetKeyMapClient(fakeState());
  erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
});

describe("Given a product created in Commerce", () => {
  test("Then Activity says the ERP was told its name and price", async () => {
    await productCreated(NEW_PRODUCT);

    const [row] = await readHistory();
    expect(row).toMatchObject({
      direction: "to-erp",
      kind: "product-created",
      message:
        'Product smartcable: told Demo ERP its name ("Smart cable") and price.',
      outcome: "sent",
      ref: "smartcable",
      sent: ["name", "price"],
    });
  });

  test("Then a product another ERP owns leaves no row", async () => {
    ownerParams.mockResolvedValueOnce({ skip: "owned by another ERP" });

    await productCreated(NEW_PRODUCT);

    expect(await readHistory()).toHaveLength(0);
  });
});

describe("Given a stock quantity saved in Commerce", () => {
  test("Then Activity names each source's quantity the ERP was told", async () => {
    await stockSaved(STOCK);

    const [row] = await readHistory();
    expect(row).toMatchObject({
      kind: "stock-changed",
      outcome: "sent",
      ref: "smartcable",
      stock: [{ name: "Default Source", quantity: 1000 }],
    });
  });

  test("Then an ERP that refuses it shows as failed, with its answer", async () => {
    erp.importRecords.mockResolvedValue(REFUSED);

    await stockSaved(STOCK);

    const [row] = await readHistory();
    expect(row).toMatchObject({
      message: "Product smartcable: stock not sent to the ERP: ERP is offline",
      outcome: "failed",
    });
  });
});

describe("Given a company saved in Commerce", () => {
  test("Then Activity names it and the customer it is in the ERP", async () => {
    await companySaved(COMPANY);

    const [row] = await readHistory();
    expect(row).toMatchObject({
      company: { id: 21, name: "Kukla Studios" },
      customers: ["C21"],
      erpIds: ["erp"],
      kind: "company-saved",
      outcome: "sent",
      ref: "21",
    });
  });

  test("Then an ERP that refuses it shows as failed, and a redelivery as another try", async () => {
    erp.importRecords.mockResolvedValue(REFUSED);

    await companySaved(COMPANY);
    await companySaved(COMPANY);

    const [row] = await readHistory();
    expect(row).toMatchObject({
      attempts: 2,
      kind: "company-saved",
      message:
        "Company 21: not sent to the ERP: ERP import answered 503: ERP is offline",
      outcome: "failed",
    });
  });
});
