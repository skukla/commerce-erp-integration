vi.mock("#lib/erp", () => ({
  erp: {
    health: vi.fn(),
    listOrders: vi.fn(() =>
      Promise.resolve({ data: { items: [] }, ok: true, status: 200 }),
    ),
    patchSettings: vi.fn(),
    reportSync: vi.fn(() => Promise.resolve({ ok: true, status: 200 })),
    wipe: vi.fn(),
  },
}));
vi.mock("#lib/ledger", () => ({
  readLedger: vi.fn(async () => [{ companyId: "7" }]),
  revertLedger: vi.fn(async () => ({ failed: [], reverted: 1 })),
}));
vi.mock("#lib/commerce", () => ({
  clearExtOrderId: vi.fn(),
  listCompanies: vi.fn(async () => []),
  listProducts: vi.fn(async () => []),
  listSources: vi.fn(async () => new Map()),
  listStock: vi.fn(async () => new Map()),
  setCompanyCreditLimit: vi.fn(),
  setCompanyStatus: vi.fn(),
}));
vi.mock("#lib/mirror", () => ({
  mirror: vi.fn(async () => ({
    counts: { companies: 0, products: 0 },
    partners: {},
    products: {},
  })),
  mirrorPartners: vi.fn(),
}));

const mockInvoke = vi.fn(async () => ({ activationId: "act-1" }));
vi.mock("openwhisk", () => ({
  default: () => ({ actions: { invoke: mockInvoke } }),
}));

import { readFileSync } from "node:fs";

import { erp } from "#lib/erp";
import { mirror } from "#lib/mirror";
import * as mirrorAction from "#src/erp/mirror/index";
import * as mirrorJob from "#src/erp/mirror-job/index";
import * as refreshJob from "#src/erp/refresh-partners-job/index";
import * as reset from "#src/erp/reset/index";
import * as setOffline from "#src/erp/set-offline/index";
import * as status from "#src/erp/status/index";

const CREDENTIAL_REFUSED =
  /^Commerce refused the integration's credential \(401\)/u;
const TIMER_RULE =
  /erp-refresh-on-timer:\n\s+trigger: erp-refresh-timer\n\s+action: refresh-partners-job\n/u;
const REFRESH_JOB_CONFIG =
  /^refresh-partners-job:\n {2}function: \.\/refresh-partners-job\/index\.js\n {2}web: 'no'/mu;

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
        data: { wiped: { products: 3 } },
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
    expect(res.body.wiped).toEqual({ products: 3 });
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

describe("Given the mirror action", () => {
  test("Then without background it mirrors inline and answers the counts", async () => {
    const res = await mirrorAction.main({ projectName: "Bodea" });
    expect(mirror).toHaveBeenCalledWith(
      expect.objectContaining({ projectName: "Bodea" }),
      expect.anything(),
      expect.anything(),
      "Bodea",
      expect.any(Function),
    );
    expect(res.statusCode).toBe(200);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("Then with background=true it records the sync as requested before starting the worker", async () => {
    const order = [];
    erp.reportSync.mockImplementationOnce((_p, step) => {
      order.push(`report:${step.state}`);
      return Promise.resolve({ ok: true });
    });
    mockInvoke.mockImplementationOnce(() => {
      order.push("invoke");
      return Promise.resolve({ activationId: "act-2" });
    });
    await mirrorAction.main({ background: "true" });
    expect(order).toEqual(["report:requested", "invoke"]);
  });

  test("Then with background=true it starts the worker without waiting and answers 202", async () => {
    // A query string arrives as a string.
    const res = await mirrorAction.main({
      background: "true",
      projectName: "Bodea",
    });
    expect(mockInvoke).toHaveBeenCalledWith({
      blocking: false,
      name: mirrorAction.MIRROR_JOB,
      params: { projectName: "Bodea" },
    });
    expect(mirror).not.toHaveBeenCalled();
    expect(res).toEqual({
      body: { activationId: "act-1", started: true },
      statusCode: 202,
    });
  });

  test("Then a worker that cannot be started is a 500 with the reason", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("namespace unavailable"));
    const res = await mirrorAction.main({ background: true });
    expect(res.error.statusCode).toBe(500);
    expect(JSON.stringify(res.error)).toContain("namespace unavailable");
  });
});

describe("Given the mirror worker", () => {
  test("Then it tells the ERP the sync is done once the mirror finishes", async () => {
    mirror.mockResolvedValueOnce({ counts: { companies: 0, products: 0 } });
    await mirrorJob.main({});
    expect(erp.reportSync).toHaveBeenLastCalledWith(expect.anything(), {
      state: "done",
    });
  });

  test("Then a failure reaches the ERP in words a person can act on", async () => {
    mirror.mockRejectedValueOnce(
      new Error(
        "Request failed with status code 401 Unauthorized: GET https://na1-sandbox.api.commerce.adobe.com/T/V1/products",
      ),
    );
    await mirrorJob.main({});
    const [, step] = erp.reportSync.mock.calls.at(-1);
    expect(step.state).toBe("failed");
    expect(step.error).toMatch(CREDENTIAL_REFUSED);
  });

  test("Then a progress report that cannot be delivered does not stop the mirror", async () => {
    erp.reportSync.mockRejectedValue(new Error("ERP unreachable"));
    mirror.mockResolvedValueOnce({ counts: { companies: 1, products: 2 } });
    expect(await mirrorJob.main({})).toEqual({
      counts: { companies: 1, products: 2 },
      ok: true,
    });
    erp.reportSync.mockReset();
    erp.reportSync.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200 }),
    );
  });

  test("Then it runs the same mirror and reports the counts", async () => {
    mirror.mockResolvedValueOnce({ counts: { companies: 2, products: 40 } });
    expect(await mirrorJob.main({})).toEqual({
      counts: { companies: 2, products: 40 },
      ok: true,
    });
  });

  test("Then a failed mirror is reported, not thrown", async () => {
    mirror.mockRejectedValueOnce(new Error("ERP import answered 401"));
    expect(await mirrorJob.main({})).toEqual({
      error: "ERP import answered 401",
      ok: false,
    });
  });

  test("Then its action name is the one the mirror action starts, and it is not a web action", () => {
    const config = readFileSync(
      "src/commerce-extensibility-1/actions/erp/actions.config.yaml",
      "utf8",
    );
    const [, name] = mirrorAction.MIRROR_JOB.split("/");
    expect(config).toMatch(
      new RegExp(
        `^${name}:\\n  function: ./${name}/index.js\\n  web: 'no'`,
        "mu",
      ),
    );
  });
});

describe("Given the partner refresh timer", () => {
  test("Then the timer starts the non-web worker, which needs no sign-in", () => {
    const ext = readFileSync(
      "src/commerce-extensibility-1/ext.config.yaml",
      "utf8",
    );
    expect(ext).toMatch(TIMER_RULE);
    const actions = readFileSync(
      "src/commerce-extensibility-1/actions/erp/actions.config.yaml",
      "utf8",
    );
    expect(actions).toMatch(REFRESH_JOB_CONFIG);
  });

  test("Then the worker refreshes partners and reports failures instead of throwing", async () => {
    const { mirrorPartners } = await import("#lib/mirror");
    mirrorPartners.mockResolvedValueOnce({
      companies: 4,
      partners: { updated: 4 },
    });
    expect(await refreshJob.main({})).toEqual({
      companies: 4,
      ok: true,
      partners: { updated: 4 },
    });
    mirrorPartners.mockRejectedValueOnce(new Error("Commerce 503"));
    expect(await refreshJob.main({})).toEqual({
      error: "Commerce 503",
      ok: false,
    });
  });
});

describe("Given a sync failure's words", () => {
  test("Then a missing association says to install again, and anything else keeps its own words", async () => {
    const { syncFailureText } = await vi.importActual("#lib/mirror-run");
    expect(
      syncFailureText(
        new Error(
          "No association record was found for this app. Re-associate the app to resolve this error.",
        ),
      ),
    ).toBe(
      "The integration is not connected to a Commerce instance. Install it into Commerce again from Demo Builder.",
    );
    expect(syncFailureText(new Error("ERP import answered 503: offline"))).toBe(
      "ERP import answered 503: offline",
    );
  });
});
