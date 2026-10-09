/*
 * erp/prices (AB-26z): Demo Builder calls it after a fill, and it can be run again at any
 * time. It reads each ERP's prices in force (GET contracts/in-force, at that ERP's own
 * address) and publishes them into the companies' shared catalogs. A price in force has
 * dates and a Commerce tier price has none, so running it again is what adds a price whose
 * start arrives and removes one whose end has passed.
 */
vi.mock("#lib/erp", () => ({ erp: { inForce: vi.fn() } }));
vi.mock("#lib/erps", async (importOriginal) => ({
  ...(await importOriginal()),
  loadErps: vi.fn(),
}));
vi.mock("#lib/contract-prices", async (importOriginal) => ({
  ...(await importOriginal()),
  publishErpPrices: vi.fn(),
}));

import { readRun, resetRunsClient } from "#lib/action-runs";
import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { main } from "#src/erp/prices/index";

import { fakeState } from "../../../box/state.js";

const ERP = (id, baseUrl) => ({
  adapter: "demo-erp",
  connection: { baseUrl },
  id,
  name: `${id} ERP`,
});
const TWO = [
  ERP("acme", "https://a.example"),
  ERP("globex", "https://g.example"),
];
const ITEMS = {
  "https://a.example": [{ lines: [{ sku: "A1" }], partnerId: "C1" }],
  "https://g.example": [{ lines: [], partnerId: "C2" }],
};
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const post = (body = {}) => ({
  __ow_body: JSON.stringify(body),
  __ow_method: "post",
});
const counts = (n) => ({
  failed: [],
  removed: n,
  skipped: [{ erpId: "x", partnerId: "C9", reason: "no catalog" }],
  unchanged: 0,
  written: n,
});

let state;
beforeEach(() => {
  state = fakeState();
  resetRunsClient(state);
  loadErps.mockResolvedValue(TWO);
  erp.inForce.mockImplementation(async (params) => ({
    data: { items: ITEMS[params.ERP_BASE_URL] },
    ok: true,
    status: 200,
  }));
  publishErpPrices.mockResolvedValue(counts(1));
});
afterEach(() => {
  vi.clearAllMocks();
  resetRunsClient();
});

describe("Given erp/prices", () => {
  test("Then every ERP's prices in force are read at its own address and published for that ERP, and the counts add up", async () => {
    const res = await main(post());
    expect(res.statusCode).toBe(200);
    expect(erp.inForce.mock.calls.map(([p]) => p.ERP_BASE_URL)).toEqual([
      "https://a.example",
      "https://g.example",
    ]);
    expect(publishErpPrices).toHaveBeenCalledTimes(2);
    const [params, entry, items, deps] = publishErpPrices.mock.calls[0];
    expect(params.__ow_method).toBe("post");
    expect(entry.id).toBe("acme");
    expect(items).toEqual(ITEMS["https://a.example"]);
    expect(Object.keys(deps).sort()).toEqual([
      "commerceCompanyOf",
      "expectSkus",
      "ledger",
      "ownsSku",
      "tierPrices",
      "websiteIdsOf",
    ]);
    expect(res.body).toEqual({
      erps: ["acme", "globex"],
      failed: [],
      removed: 2,
      skipped: [
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
      ],
      unchanged: 0,
      written: 2,
    });
  });

  test("Then one ERP can be asked for by id, and an unknown id is refused", async () => {
    const res = await main(post({ erpId: "globex" }));
    expect(res.body.erps).toEqual(["globex"]);
    expect(publishErpPrices.mock.calls[0][1].id).toBe("globex");
    const unknown = await main(post({ erpId: "nope" }));
    expect(unknown.error.statusCode).toBe(400);
  });

  test("Then an ERP that does not answer is reported and nothing of its prices is touched; the others still publish", async () => {
    erp.inForce.mockImplementation(async (params) =>
      params.ERP_BASE_URL === "https://a.example"
        ? { data: {}, ok: false, status: 503 }
        : { data: { items: [] }, ok: true, status: 200 },
    );
    const res = await main(post());
    expect(publishErpPrices).toHaveBeenCalledTimes(1);
    expect(res.body.failed).toEqual([
      { erpId: "acme", error: "the ERP's prices in force answered 503" },
    ]);
  });

  test("Then only POST is answered", async () => {
    const res = await main({ __ow_method: "get" });
    expect(res.error.statusCode).toBe(400);
  });
});

/*
 * A web action's HTTP answer is cut off at 60 seconds while the action runs on, and a publish
 * of every company's prices can take longer (an ERP reset, 2026-10-09): Demo Builder then saw
 * "not yet ready" and could not tell whether the publish finished. As with erp/detach, a caller
 * that names its run (`run`) asks afterwards how it went (lib/action-runs.js); a GET never
 * publishes.
 */
describe("Given a price publish a caller named a run for", () => {
  const RUN = "fill-2026-10-09_b2";
  const KEY = `prices-run-${RUN}`;
  const recorded = () => JSON.parse(state.store.get(KEY));

  test("Then the answer is the same as without one", async () => {
    const res = await main(post({ run: RUN }));

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      erps: ["acme", "globex"],
      failed: [],
      removed: 2,
      skipped: [
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
        { erpId: "x", partnerId: "C9", reason: "no catalog" },
      ],
      unchanged: 0,
      written: 2,
    });
  });

  test("Then the run is recorded as running while the publish works", async () => {
    let during;
    publishErpPrices.mockImplementationOnce(() => {
      during = recorded();
      return Promise.resolve(counts(1));
    });

    await main(post({ run: RUN }));

    expect(during).toEqual({
      run: RUN,
      startedAt: expect.stringMatching(ISO_TIME),
      status: "running",
    });
  });

  test("Then once the publish returns the record is done, carrying the body the POST answered", async () => {
    const res = await main(post({ erpId: "globex", run: RUN }));

    expect(recorded()).toEqual({
      finishedAt: expect.any(String),
      result: res.body,
      run: RUN,
      startedAt: expect.any(String),
      status: "done",
    });
    expect(recorded().result.erps).toEqual(["globex"]);
  });

  test("Then the run can be named in the query as well as the body", async () => {
    await main({ __ow_method: "post", run: RUN });

    expect(recorded().status).toBe("done");
  });

  test("Then when the publish throws the POST answers 500 as before and the record says why", async () => {
    publishErpPrices.mockRejectedValueOnce(new Error("Commerce answered 503"));

    const res = await main(post({ run: RUN }));

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
    "Then a run id %j is refused, and nothing is published or recorded",
    async (run) => {
      const res = await main(post({ run }));

      expect(res.error.statusCode).toBe(400);
      expect(res.error.body.message).toBe(
        "run is an id of 8 to 64 letters, digits, hyphens and underscores",
      );
      expect(publishErpPrices).not.toHaveBeenCalled();
      expect(state.store.size).toBe(0);
    },
  );

  test("Then a publish refused before it starts leaves no record", async () => {
    const res = await main(post({ erpId: "nope", run: RUN }));

    expect(res.error.statusCode).toBe(400);
    expect(state.store.size).toBe(0);
  });

  test("Then a publish with no run records nothing", async () => {
    await main(post());

    expect(state.store.size).toBe(0);
  });
});

describe("Given a caller asking how a named price publish went", () => {
  const RUN = "fill-2026-10-09_b2";
  const get = (params = {}) => main({ __ow_method: "get", ...params });

  test("Then GET with its run answers the record, and publishes nothing", async () => {
    const posted = await main(post({ run: RUN }));
    publishErpPrices.mockClear();
    loadErps.mockClear();

    const res = await get({ run: RUN });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(await readRun("prices", RUN));
    expect(res.body).toMatchObject({
      result: posted.body,
      run: RUN,
      status: "done",
    });
    expect(publishErpPrices).not.toHaveBeenCalled();
    expect(loadErps).not.toHaveBeenCalled();
  });

  test("Then a run nobody started is a 404, and publishes nothing", async () => {
    const res = await get({ run: "never-started" });

    expect(res.error.statusCode).toBe(404);
    expect(res.error.body.message).toBe("no prices run never-started");
    expect(publishErpPrices).not.toHaveBeenCalled();
  });

  test("Then GET without a run is refused, saying what GET is for, and publishes nothing", async () => {
    const res = await get({ erpId: "acme" });

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "prices answers GET only as prices?run=<id>, which reads how the publish POSTed with that run went; POST publishes",
    );
    expect(publishErpPrices).not.toHaveBeenCalled();
  });

  test("Then GET with a run id that cannot be one is refused", async () => {
    const res = await get({ run: "../erps" });

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "run is an id of 8 to 64 letters, digits, hyphens and underscores",
    );
  });

  test.each([
    [{ __ow_method: "put" }, "prices does not answer PUT"],
    [{ __ow_method: "delete" }, "prices does not answer DELETE"],
  ])("Then %j publishes nothing", async (params, said) => {
    const res = await main(params);

    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(said);
    expect(publishErpPrices).not.toHaveBeenCalled();
  });
});
