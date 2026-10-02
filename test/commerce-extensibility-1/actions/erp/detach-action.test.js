/*
 * erp/detach[?erp=<id>] (AB-16c): with `erp`, only that ERP is undone. An id not in the ERP
 * list is refused in words: undoing nothing, or everything, when one ERP was asked for would be
 * wrong either way. The answer names the ERP it undid, so a caller can tell a deployment that
 * honoured `erp` from an older one that ignored it and undid every ERP.
 */
vi.mock("#lib/detach", () => ({
  detach: vi.fn(async (params) => ({
    ...(params.erp ? { erp: params.erp } : {}),
    holds: { failed: [], released: 0 },
    orders: { cleared: 0, failed: [] },
    reverted: { failed: [], reverted: 0 },
  })),
}));
vi.mock("#lib/erps", () => ({ loadErps: vi.fn() }));

import * as companyBalance from "#lib/company-balance";
import { detach } from "#lib/detach";
import { readDetachRun, resetDetachRunsClient } from "#lib/detach-runs";
import { loadErps } from "#lib/erps";
import * as orderParts from "#lib/order-parts";
import * as action from "#src/erp/detach/index";

import { fakeState } from "../../../box/state.js";

const entry = (id) => ({
  adapter: "demo-erp",
  connection: { baseUrl: `https://${id}.example` },
  id,
  name: `${id} ERP`,
});
const ERPS = [entry("erp"), entry("contoso")];
/** What Runtime adds to a web action's params for a POST. */
const POST = { __ow_method: "post" };
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const post = (params = {}) => action.main({ ...POST, ...params });

let state;
beforeEach(() => {
  loadErps.mockResolvedValue(ERPS);
  state = fakeState();
  resetDetachRunsClient(state);
});
afterEach(() => {
  vi.clearAllMocks();
  resetDetachRunsClient();
});

describe("Given the detach action", () => {
  test("Then a listed ERP is undone alone, and the answer names it", async () => {
    const res = await post({ erp: "contoso" });
    expect(res.statusCode).toBe(200);
    expect(res.body.erp).toBe("contoso");
    expect(detach).toHaveBeenCalledWith(
      { ...POST, erp: "contoso" },
      expect.objectContaining({ erps: ERPS }),
    );
  });

  test("Then an ERP not in the list is refused in words, and nothing is undone", async () => {
    const res = await post({ erp: "fabrikam" });
    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "no ERP fabrikam in the list; the listed ERPs are erp, contoso",
    );
    expect(detach).not.toHaveBeenCalled();
  });

  test("Then without an ERP every ERP is undone, and the answer names none", async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty("erp");
    expect(detach).toHaveBeenCalledWith(POST, expect.anything());
  });

  test("Then detach is handed the company balance writer a payment's revert needs (AB-26s)", async () => {
    await post();
    expect(detach).toHaveBeenCalledWith(
      POST,
      expect.objectContaining({ balance: companyBalance }),
    );
  });
});

/*
 * erp/detach with closeOrders (AB-16n): the reset closes every order the ERPs hold before it wipes
 * them. It is a whole-reset act, so it cannot be asked of one ERP; a caller that asks for both is
 * refused in words rather than having one of the two silently dropped.
 */
describe("Given the detach action asked to close the orders", () => {
  test.each([[true], ["true"]])(
    "Then closeOrders %j reaches detach as true, with the per-order records",
    async (value) => {
      const res = await post({ closeOrders: value });
      expect(res.statusCode).toBe(200);
      expect(detach).toHaveBeenCalledWith(
        { ...POST, closeOrders: true },
        expect.objectContaining({ erps: ERPS, orderParts }),
      );
    },
  );

  test("Then closeOrders with one ERP is refused in words, and nothing is undone", async () => {
    const res = await post({ closeOrders: true, erp: "contoso" });
    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "closeOrders closes every order all the ERPs hold, so it cannot be asked for one ERP (erp=contoso); ask for one or the other",
    );
    expect(detach).not.toHaveBeenCalled();
  });

  test("Then without closeOrders detach is asked exactly as before", async () => {
    await post({ closeOrders: false });
    expect(detach).toHaveBeenCalledWith(POST, expect.anything());
  });
});

/*
 * A web action's HTTP answer is cut off at 60 seconds while the action runs on, so a caller
 * that names its run (`run`) can ask afterwards how it went (lib/detach-runs.js). Asking is a
 * GET, and a GET never detaches: before this the action ignored the method, so a GET ran one.
 */
describe("Given a detach a caller named a run for", () => {
  const RUN = "reset-2026-10-02_a1";
  const KEY = `detach-run-${RUN}`;
  const recorded = () => JSON.parse(state.store.get(KEY));

  test("Then the answer is the same as without one, and detach is not handed the run", async () => {
    const res = await post({ closeOrders: true, run: RUN });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      holds: { failed: [], released: 0 },
      orders: { cleared: 0, failed: [] },
      reverted: { failed: [], reverted: 0 },
    });
    expect(detach).toHaveBeenCalledExactlyOnceWith(
      { ...POST, closeOrders: true },
      expect.objectContaining({ erps: ERPS }),
    );
  });

  test("Then the run is recorded as running while detach works", async () => {
    let during;
    detach.mockImplementationOnce(() => {
      during = recorded();
      return Promise.resolve({
        orders: { cleared: 0 },
        reverted: { reverted: 0 },
      });
    });

    await post({ run: RUN });

    expect(during).toEqual({
      run: RUN,
      startedAt: expect.stringMatching(ISO_TIME),
      status: "running",
    });
  });

  test("Then once detach returns the record is done, carrying the body the POST answered", async () => {
    const res = await post({ erp: "contoso", run: RUN });

    const record = recorded();
    expect(record).toEqual({
      finishedAt: expect.any(String),
      result: res.body,
      run: RUN,
      startedAt: expect.any(String),
      status: "done",
    });
    expect(record.result.erp).toBe("contoso");
  });

  test("Then when detach throws the POST answers 500 as before and the record says why", async () => {
    detach.mockRejectedValueOnce(new Error("Commerce answered 503"));

    const res = await post({ run: RUN });

    expect(res.error.statusCode).toBe(500);
    expect(recorded()).toEqual({
      error: "Commerce answered 503",
      finishedAt: expect.any(String),
      run: RUN,
      startedAt: expect.any(String),
      status: "failed",
    });
  });

  test.each([["short"], ["has a space"], ["../erps"], [""]])(
    "Then a run id %j is refused, and nothing is undone or recorded",
    async (run) => {
      const res = await post({ run });

      expect(res.error.statusCode).toBe(400);
      expect(res.error.body.message).toBe(
        "run is an id of 8 to 64 letters, digits, hyphens and underscores",
      );
      expect(detach).not.toHaveBeenCalled();
      expect(state.store.size).toBe(0);
    },
  );

  test("Then a detach refused before it starts leaves no record", async () => {
    const res = await post({ erp: "fabrikam", run: RUN });

    expect(res.error.statusCode).toBe(400);
    expect(state.store.size).toBe(0);
  });

  test("Then a detach with no run records nothing", async () => {
    await post({ closeOrders: true });

    expect(state.store.size).toBe(0);
  });
});

describe("Given a caller asking how a named detach went", () => {
  const RUN = "reset-2026-10-02_a1";
  const get = (params = {}) => action.main({ __ow_method: "get", ...params });

  test("Then GET with its run answers the record, and detaches nothing", async () => {
    const posted = await post({ closeOrders: true, run: RUN });
    detach.mockClear();
    loadErps.mockClear();

    const res = await get({ run: RUN });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(await readDetachRun(RUN));
    expect(res.body).toMatchObject({
      result: posted.body,
      run: RUN,
      status: "done",
    });
    expect(detach).not.toHaveBeenCalled();
    expect(loadErps).not.toHaveBeenCalled();
  });

  test("Then a run nobody started is a 404, and detaches nothing", async () => {
    const res = await get({ run: "never-started" });

    expect(res.error.statusCode).toBe(404);
    expect(res.error.body.message).toBe("no detach run never-started");
    expect(detach).not.toHaveBeenCalled();
  });

  test("Then GET without a run is refused, saying what GET is for, and detaches nothing", async () => {
    const res = await get({ closeOrders: "true" });

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "detach answers GET only as detach?run=<id>, which reads how the detach POSTed with that run went; POST runs a detach",
    );
    expect(detach).not.toHaveBeenCalled();
  });

  test("Then GET with a run id that cannot be one is refused", async () => {
    const res = await get({ run: "../erps" });

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "run is an id of 8 to 64 letters, digits, hyphens and underscores",
    );
  });
});

describe("Given the detach action called by any method but POST", () => {
  test.each([
    [{ __ow_method: "put" }, "detach does not answer PUT"],
    [{ __ow_method: "delete" }, "detach does not answer DELETE"],
    [
      {},
      "detach answers GET only as detach?run=<id>, which reads how the detach POSTed with that run went; POST runs a detach",
    ],
  ])("Then %j detaches nothing", async (params, said) => {
    const res = await action.main({ ...params, closeOrders: true });

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(said);
    expect(detach).not.toHaveBeenCalled();
  });
});
