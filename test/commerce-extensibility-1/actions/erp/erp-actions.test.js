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
