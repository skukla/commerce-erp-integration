/*
 * A product saved in Commerce shows under Activity as what it told the ERP (2026-10-13).
 * Before, nothing recorded it: a product renamed in Commerce reached its ERP and never
 * showed. The sender is the real one; the ERP client and Commerce reads are faked.
 */
import { fakeState } from "../../../../../box/state.js";

const state = fakeState();
vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => state },
}));
vi.mock("#lib/erp", () => ({ erp: { importRecords: vi.fn() } }));
vi.mock("#lib/owner-params", () => ({
  ownerParams: vi.fn(async (params) => ({ params })),
}));
vi.mock("#lib/commerce", () => ({
  productAttributes: vi.fn(async () => ({})),
  sourceCodesOf: vi.fn(async () => []),
  warehousesOfSku: vi.fn(async () => []),
  websiteCodesOf: vi.fn(async () => []),
}));

import { erp } from "#lib/erp";
import { readHistory, resetHistoryClient } from "#lib/history";
import { noteProductWrite, resetOwnWritesClient } from "#lib/own-writes";
import { ownerParams } from "#lib/owner-params";
import * as action from "#src/product/commerce/updated/index";

const saveOf = (name) => ({
  data: {
    value: {
      created_at: "2024-01-01 00:00:00",
      name,
      price: "499.000000",
      sku: "51BSCU-BLBK",
      updated_at: "2026-10-02 16:06:34",
    },
  },
  ERP_DISPLAY_NAME: "Demo ERP",
});

beforeEach(() => {
  vi.clearAllMocks();
  state.reset();
  resetHistoryClient(state);
  resetOwnWritesClient(fakeState());
  erp.importRecords.mockResolvedValue({ data: {}, ok: true, status: 200 });
});
afterEach(() => resetOwnWritesClient());

describe("Given a product saved in Commerce", () => {
  test("Then Activity names the ERP told and the new name, one row however often it is saved", async () => {
    await action.main(saveOf("Cabinet (Admin)"));
    await action.main(saveOf("Cabinet (Admin 2)"));

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      attempts: 2,
      direction: "to-erp",
      kind: "product-changed",
      message:
        'Product 51BSCU-BLBK: told Demo ERP its name ("Cabinet (Admin 2)") and price.',
      outcome: "sent",
      ref: "51BSCU-BLBK",
    });
  });

  test("Then an ERP that refuses it shows as failed, with the ERP's answer", async () => {
    erp.importRecords.mockResolvedValue({
      data: { errorMessage: "unknown SKU" },
      ok: false,
      status: 422,
    });

    await action.main(saveOf("Cabinet (Admin)"));

    const [row] = await readHistory();
    expect(row).toMatchObject({
      kind: "product-changed",
      message: "Product 51BSCU-BLBK: not sent to the ERP: unknown SKU",
      outcome: "failed",
    });
  });

  test("Then a product another ERP owns is sent nowhere and leaves no row", async () => {
    ownerParams.mockResolvedValueOnce({ skip: "owned by another ERP" });

    await action.main(saveOf("Cabinet (Admin)"));

    expect(erp.importRecords).not.toHaveBeenCalled();
    expect(await readHistory()).toHaveLength(0);
  });

  test("Then the save of the integration's own write leaves no row", async () => {
    await noteProductWrite("51BSCU-BLBK", {
      name: "Cabinet (test)",
      price: 499,
    });

    await action.main(saveOf("Cabinet (test)"));

    expect(await readHistory()).toHaveLength(0);
  });
});
