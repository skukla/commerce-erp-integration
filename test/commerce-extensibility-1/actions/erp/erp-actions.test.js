vi.mock("#lib/erp", () => ({
  erp: { health: vi.fn(), patchSettings: vi.fn(), wipe: vi.fn() },
}));
vi.mock("#lib/ledger", () => ({
  readLedger: vi.fn(async () => [{ companyId: "7" }]),
  revertLedger: vi.fn(async () => ({ failed: [], reverted: 1 })),
}));
vi.mock("#lib/commerce", () => ({
  listCompanies: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listStock: vi.fn(async () => new Map()),
  setCompanyCreditLimit: vi.fn(),
  setCompanyStatus: vi.fn(),
}));
vi.mock("#lib/mirror", () => ({
  mirror: vi.fn(async () => ({
    counts: { companies: 0, products: 0 },
    materials: {},
    partners: {},
  })),
}));

import { erp } from "#lib/erp";
import { mirror } from "#lib/mirror";
import * as reset from "#src/erp/reset/index";
import * as setOffline from "#src/erp/set-offline/index";
import * as status from "#src/erp/status/index";

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the status action", () => {
  test("Then it reports the ERP's health and the ledger size", async () => {
    erp.health.mockResolvedValue({
      data: { displayName: "Acme ERP", offline: false, ok: true },
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

describe("Given the reset action", () => {
  test("Then it reverts, wipes and mirrors in that order", async () => {
    const calls = [];
    const { revertLedger } = await import("#lib/ledger");
    revertLedger.mockImplementation(() => {
      calls.push("revert");
      return Promise.resolve({ failed: [], reverted: 0 });
    });
    erp.wipe.mockImplementation(() => {
      calls.push("wipe");
      return Promise.resolve({
        data: { wiped: { materials: 3 } },
        ok: true,
        status: 200,
      });
    });
    mirror.mockImplementation(() => {
      calls.push("mirror");
      return Promise.resolve({ counts: { companies: 1, products: 3 } });
    });
    const res = await reset.main({});
    expect(calls).toEqual(["revert", "wipe", "mirror"]);
    expect(res.statusCode).toBe(200);
    expect(res.body.wiped).toEqual({ materials: 3 });
  });
  test("Then a failed wipe stops before the mirror", async () => {
    erp.wipe.mockResolvedValue({
      data: { errorMessage: "nope" },
      ok: false,
      status: 500,
    });
    const res = await reset.main({});
    expect(res.error.statusCode).toBe(500);
    expect(mirror).not.toHaveBeenCalled();
  });
});

describe("Given the set-offline action", () => {
  test("Then it forwards the flag to the ERP and refuses a non-boolean", async () => {
    erp.patchSettings.mockResolvedValue({
      data: { offline: true },
      ok: true,
      status: 200,
    });
    const res = await setOffline.main({
      __ow_body: JSON.stringify({ offline: true }),
    });
    expect(erp.patchSettings).toHaveBeenCalledWith(expect.anything(), {
      offline: true,
    });
    expect(res.body).toEqual({ offline: true });
    expect((await setOffline.main({ offline: "yes" })).error.statusCode).toBe(
      400,
    );
  });
});
