/*
 * erp/prices-daily: the action a daily alarm trigger starts (ext.config.yaml, shortly after
 * midnight UTC). The ERP raises no event when a price line's start or end date arrives, so
 * this is what makes the date take effect: every ERP's prices in force are published again,
 * as erp/prices does. A publish is a replace, so a second run the same day changes nothing.
 * The trigger carries no Adobe sign-in and no HTTP method; the handler is tested, not the
 * trigger.
 */
import { readFileSync } from "node:fs";

vi.mock("#lib/erp", () => ({ erp: { inForce: vi.fn() } }));
vi.mock("#lib/erps", async (importOriginal) => ({
  ...(await importOriginal()),
  loadErps: vi.fn(),
}));
vi.mock("#lib/contract-prices", async (importOriginal) => ({
  ...(await importOriginal()),
  publishErpPrices: vi.fn(),
}));

import { publishErpPrices } from "#lib/contract-prices";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { main } from "#src/erp/prices-daily/index";

const ERP = (id, baseUrl) => ({
  adapter: "demo-erp",
  connection: { baseUrl },
  id,
  name: `${id} ERP`,
});

beforeEach(() => {
  loadErps.mockResolvedValue([
    ERP("acme", "https://a.example"),
    ERP("globex", "https://g.example"),
  ]);
  erp.inForce.mockResolvedValue({ data: { items: [] }, ok: true, status: 200 });
  publishErpPrices.mockResolvedValue({
    failed: [],
    removed: 1,
    skipped: [],
    unchanged: 2,
    written: 0,
  });
});
afterEach(() => vi.clearAllMocks());

describe("Given the daily alarm", () => {
  test("Then every ERP's prices in force are published, with the trigger's payload and no method", async () => {
    const res = await main({
      triggerName: "/ns/erp-prices-daily-timer",
      type: "scheduled",
    });
    expect(res.statusCode).toBe(200);
    expect(erp.inForce.mock.calls.map(([p]) => p.ERP_BASE_URL)).toEqual([
      "https://a.example",
      "https://g.example",
    ]);
    expect(publishErpPrices.mock.calls.map((c) => c[1].id)).toEqual([
      "acme",
      "globex",
    ]);
    expect(res.body).toMatchObject({
      erps: ["acme", "globex"],
      removed: 2,
      unchanged: 4,
      written: 0,
    });
  });

  test("Then a failure is an error answer, so the run is recorded as failed", async () => {
    loadErps.mockRejectedValueOnce(new Error("state down"));
    const res = await main({});
    expect(res.error.statusCode).toBe(500);
  });
});

const MAX_TRIGGERS_KEY = /^\s*maxTriggers:/mu;
const DAILY_NOT_WEB =
  /prices-daily:\n {2}function: \.\/prices-daily\/index\.js\n {2}web: 'no'/u;

describe("Given the schedule as deployed", () => {
  // Read as text: the trigger itself is Runtime's, but a rule naming a missing action, a
  // web action a timer cannot call, or a maxTriggers that ends the schedule would fail
  // silently after deploy.
  test("Then a daily alarm shortly after midnight UTC starts the non-web erp/prices-daily", () => {
    const ext = readFileSync(
      "src/commerce-extensibility-1/ext.config.yaml",
      "utf8",
    );
    expect(ext).toContain("feed: /whisk.system/alarms/alarm");
    expect(ext).toContain('cron: "10 0 * * *"');
    expect(ext).toContain("trigger: erp-prices-daily-timer");
    expect(ext).toContain("action: prices-daily");
    expect(ext).not.toMatch(MAX_TRIGGERS_KEY);
    const actions = readFileSync(
      "src/commerce-extensibility-1/actions/erp/actions.config.yaml",
      "utf8",
    );
    expect(actions).toMatch(DAILY_NOT_WEB);
  });
});
