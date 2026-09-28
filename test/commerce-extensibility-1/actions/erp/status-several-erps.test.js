/*
 * erp/status with several ERPs (slice B7): the Admin page header names every listed ERP with
 * whether it answers. Each ERP is asked at its own address. With one ERP the answer is
 * unchanged: no list.
 */
vi.mock("#lib/erp", () => ({
  erp: { health: vi.fn() },
}));
vi.mock("#lib/ledger", () => ({
  readLedger: vi.fn(async () => []),
}));
vi.mock("#lib/erps", () => ({
  loadErps: vi.fn(),
}));

import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import * as status from "#src/erp/status/index";

const TWO = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

/** What an ERP's health carries during a maintenance window (contract version 8). */
const MAINTENANCE = {
  message: "Brand B ERP is in maintenance until 14:30 UTC.",
  until: "2026-09-28T14:30:00.000Z",
};

afterEach(() => vi.clearAllMocks());

describe("Given two ERPs in the list", () => {
  test("Then each is asked at its own address, and the answer lists each with whether it answers", async () => {
    loadErps.mockResolvedValue(TWO);
    erp.health.mockImplementation((params) =>
      params.ERP_BASE_URL === "https://a.example"
        ? Promise.resolve({ data: { ok: true }, ok: true, status: 200 })
        : Promise.reject(new Error("fetch failed")),
    );
    const res = await status.main({ ERP_BASE_URL: "https://a.example" });

    expect(res.body.erps).toStrictEqual([
      { id: "brand-a", name: "Brand A ERP", reachable: true },
      {
        error: "fetch failed",
        id: "brand-b",
        name: "Brand B ERP",
        reachable: false,
      },
    ]);
    expect(erp.health.mock.calls.map(([p]) => p.ERP_BASE_URL)).toEqual(
      expect.arrayContaining(["https://a.example", "https://b.example"]),
    );
  });

  test("Then an ERP that answers but refuses the integration is not reachable, and says why", async () => {
    // Bodea 2026-09-28: an ERP in another workspace answered 401 to every call and was shown
    // as answering, because the ERP client never throws on an HTTP error.
    loadErps.mockResolvedValue(TWO);
    erp.health.mockImplementation((params) =>
      Promise.resolve(
        params.ERP_BASE_URL === "https://a.example"
          ? { data: { ok: true }, ok: true, status: 200 }
          : {
              data: { error: "Technical account mismatch" },
              ok: false,
              status: 401,
            },
      ),
    );
    const res = await status.main({ ERP_BASE_URL: "https://a.example" });

    expect(res.body.erps[1]).toStrictEqual({
      error: "the ERP answered 401",
      id: "brand-b",
      name: "Brand B ERP",
      reachable: false,
    });
  });

  test("Then an ERP in maintenance answers its health but is not reachable, and says until when", async () => {
    // Contract version 8: health still answers during a maintenance window, and every other
    // route answers 503, so the integration cannot use the ERP until the window ends.
    loadErps.mockResolvedValue(TWO);
    erp.health.mockImplementation((params) =>
      Promise.resolve(
        params.ERP_BASE_URL === "https://a.example"
          ? { data: { maintenance: null, ok: true }, ok: true, status: 200 }
          : {
              data: { maintenance: MAINTENANCE, ok: true },
              ok: true,
              status: 200,
            },
      ),
    );
    const res = await status.main({ ERP_BASE_URL: "https://a.example" });

    expect(res.body.erps).toStrictEqual([
      { id: "brand-a", name: "Brand A ERP", reachable: true },
      {
        error: MAINTENANCE.message,
        id: "brand-b",
        name: "Brand B ERP",
        reachable: false,
      },
    ]);
  });

  test("Then asked for one ERP in maintenance, its health is given, not reachable, with the reason", async () => {
    loadErps.mockResolvedValue(TWO);
    erp.health.mockResolvedValue({
      data: { displayName: "Brand B ERP", maintenance: MAINTENANCE, ok: true },
      ok: true,
      status: 200,
    });
    const res = await status.main({ erp: "brand-b" });

    expect(res.body.erp).toStrictEqual({
      displayName: "Brand B ERP",
      error: MAINTENANCE.message,
      maintenance: MAINTENANCE,
      ok: false,
      reachable: false,
      status: 200,
    });
  });

  test("Then asked for one ERP, the health is that ERP's, asked at its address", async () => {
    loadErps.mockResolvedValue(TWO);
    erp.health.mockImplementation((params) =>
      Promise.resolve({
        data: { displayName: params.ERP_BASE_URL, ok: true },
        ok: true,
        status: 200,
      }),
    );
    const res = await status.main({
      ERP_BASE_URL: "https://a.example",
      erp: "brand-b",
    });

    expect(res.body.erp).toMatchObject({
      displayName: "https://b.example",
      reachable: true,
    });
    expect(res.body.erpBaseUrl).toBe("https://b.example");
  });

  test("Then asked for one ERP that refuses the integration, it is not reachable and the refusal is given", async () => {
    // Adobe's caller check answers `error`, not the ERP's own `errorMessage` (Bodea 2026-09-28).
    loadErps.mockResolvedValue(TWO);
    erp.health.mockResolvedValue({
      data: { error: "Technical account mismatch" },
      ok: false,
      status: 401,
    });
    const res = await status.main({ erp: "brand-b" });

    expect(res.body.erp).toStrictEqual({
      error: "Technical account mismatch",
      ok: false,
      reachable: false,
      status: 401,
    });
  });

  // The Admin page's Overview shows each ERP's own figures, so each listed ERP carries what its
  // health answered: its counts and when it was last filled and wiped.
  test("Then each listed ERP carries its own figures, when its health gives them", async () => {
    loadErps.mockResolvedValue(TWO);
    erp.health.mockImplementation((params) =>
      Promise.resolve(
        params.ERP_BASE_URL === "https://a.example"
          ? {
              data: {
                counts: { products: 120, salesOrders: 4 },
                lastImportAt: "2026-09-28T09:00:00Z",
                lastWipeAt: null,
                ok: true,
              },
              ok: true,
              status: 200,
            }
          : {
              data: {
                counts: { products: 30 },
                maintenance: MAINTENANCE,
                ok: true,
              },
              ok: true,
              status: 200,
            },
      ),
    );
    const res = await status.main({ ERP_BASE_URL: "https://a.example" });

    expect(res.body.erps).toStrictEqual([
      {
        counts: { products: 120, salesOrders: 4 },
        id: "brand-a",
        lastImportAt: "2026-09-28T09:00:00Z",
        lastWipeAt: null,
        name: "Brand A ERP",
        reachable: true,
      },
      {
        counts: { products: 30 },
        error: MAINTENANCE.message,
        id: "brand-b",
        name: "Brand B ERP",
        reachable: false,
      },
    ]);
  });

  test("Then an ERP list that cannot be read still answers the deployed ERP's health, with no list", async () => {
    loadErps.mockRejectedValue(new Error("State is down"));
    erp.health.mockResolvedValue({ data: { ok: true }, ok: true, status: 200 });
    const res = await status.main({});
    expect(res.statusCode).toBe(200);
    expect(res.body.erp.reachable).toBe(true);
    expect(res.body.erps).toBeUndefined();
  });
});

describe("Given one ERP in the list", () => {
  test("Then the answer has no list, as before", async () => {
    loadErps.mockResolvedValue([TWO[0]]);
    erp.health.mockResolvedValue({ data: { ok: true }, ok: true, status: 200 });
    const res = await status.main({});
    expect(res.body.erps).toBeUndefined();
    expect(erp.health).toHaveBeenCalledTimes(1);
  });
});
