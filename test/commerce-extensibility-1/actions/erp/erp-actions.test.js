vi.mock("#lib/erp", () => ({
  erp: { health: vi.fn() },
}));
vi.mock("#lib/ledger", () => ({
  readLedger: vi.fn(async () => [{ companyId: "7" }]),
}));

import { erp } from "#lib/erp";
import * as status from "#src/erp/status/index";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the status action", () => {
  test("Then it reports the ERP's health and the ledger size", async () => {
    erp.health.mockResolvedValue({
      data: { displayName: "Acme ERP", ok: true },
      ok: true,
      status: 200,
    });
    const res = await status.main({ ERP_BASE_URL: "https://erp.example/api" });
    expect(res.statusCode).toBe(200);
    expect(res.body.erp).toMatchObject({
      displayName: "Acme ERP",
      reachable: true,
    });
    expect(res.body.ledger).toEqual({ entries: 1 });
  });
  // A deployment from before AB-16c ignores detach's `erp` and undoes EVERY ERP, so Demo
  // Builder asks this first and never sends a one-ERP reset to a deployment that lacks it.
  test("Then it says detach can undo one ERP", async () => {
    erp.health.mockResolvedValue({ data: {}, ok: true, status: 200 });
    const res = await status.main({});
    expect(res.body.detachesPerErp).toBe(true);
  });
  // AB-16n: a deployment from before it ignores detach's `closeOrders` and leaves every order
  // open, so Demo Builder asks this before a reset that means to close them.
  test("Then it says detach can close the orders on a reset", async () => {
    erp.health.mockResolvedValue({ data: {}, ok: true, status: 200 });
    const res = await status.main({});
    expect(res.body.closesOrdersOnReset).toBe(true);
  });
  test("Then an unreachable ERP is reported, not thrown", async () => {
    erp.health.mockRejectedValue(new Error("ERP_BASE_URL is not set"));
    const res = await status.main({});
    expect(res.body.erp).toEqual({
      error: "ERP_BASE_URL is not set",
      ok: false,
      reachable: false,
    });
  });
});
