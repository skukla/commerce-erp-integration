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

import { detach } from "#lib/detach";
import { loadErps } from "#lib/erps";
import * as action from "#src/erp/detach/index";

const entry = (id) => ({
  adapter: "demo-erp",
  connection: { baseUrl: `https://${id}.example` },
  id,
  name: `${id} ERP`,
});
const ERPS = [entry("erp"), entry("contoso")];

beforeEach(() => loadErps.mockResolvedValue(ERPS));
afterEach(() => vi.clearAllMocks());

describe("Given the detach action", () => {
  test("Then a listed ERP is undone alone, and the answer names it", async () => {
    const res = await action.main({ erp: "contoso" });
    expect(res.statusCode).toBe(200);
    expect(res.body.erp).toBe("contoso");
    expect(detach).toHaveBeenCalledWith(
      { erp: "contoso" },
      expect.objectContaining({ erps: ERPS }),
    );
  });

  test("Then an ERP not in the list is refused in words, and nothing is undone", async () => {
    const res = await action.main({ erp: "fabrikam" });
    expect(res.error.statusCode).toBe(400);
    expect(res.error.body.message).toBe(
      "no ERP fabrikam in the list; the listed ERPs are erp, contoso",
    );
    expect(detach).not.toHaveBeenCalled();
  });

  test("Then without an ERP every ERP is undone, and the answer names none", async () => {
    const res = await action.main({});
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty("erp");
    expect(detach).toHaveBeenCalledWith({}, expect.anything());
  });
});
