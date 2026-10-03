/*
 * A product deleted in Commerce (AB-26y step 5): the integration records it in its history
 * and calls no ERP. A real ERP's material master is not deleted because a web shop dropped a
 * product. Products pair by SKU, so there is no key-map row to unlink (lib/key-map.js).
 */
import { fakeState } from "../../../../../box/state.js";

const state = fakeState();
vi.mock("@adobe/aio-lib-state", () => ({
  default: { init: async () => state },
}));

import { readHistory, resetHistoryClient } from "#lib/history";
import * as deleted from "#src/product/commerce/deleted/index";

const fetchSpy = vi.fn();

beforeEach(() => {
  state.reset();
  resetHistoryClient(state);
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Given a product deleted in Commerce", () => {
  test("Then it is recorded in the history as made in Commerce, and no ERP is called", async () => {
    const res = await deleted.main({
      data: { value: { id: 9, sku: "A1" } },
      id: "evt-1",
    });

    expect(res.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      attempts: 1,
      direction: "commerce",
      kind: "product-deleted",
      message:
        "Product A1 was deleted in Commerce. The ERP keeps it until its next reset",
      outcome: "done",
      ref: "A1",
    });
  });

  test("Then a redelivered delete updates its own row, and a SKU outside State's key alphabet is still recorded", async () => {
    const event = { data: { value: { sku: "Knit/Red 01" } } };
    await deleted.main(event);
    await deleted.main(event);

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ attempts: 2, ref: "Knit/Red 01" });
  });

  test("Then an event with no sku is refused and nothing is recorded", async () => {
    expect((await deleted.main({ data: { value: {} } })).error.statusCode).toBe(
      400,
    );
    expect(await readHistory()).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
