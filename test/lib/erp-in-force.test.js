/*
 * The ERP's prices in force (contract version 6: GET contracts/in-force, optionally
 * ?partnerId=), asked like the ERP's other routes: at the ERP's address, with the IMS token.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  getImsAuthProvider: () => ({
    getHeaders: async () => ({ Authorization: "Bearer t" }),
  }),
  resolveImsAuthParams: () => ({ clientId: "c", imsOrgId: "o" }),
}));

import { erp, resetErpTokenCache } from "#lib/erp";

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ items: [] }),
}));

beforeEach(() => {
  resetErpTokenCache();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("Given the ERP's prices in force", () => {
  test("Then every customer's are asked of contracts/in-force, or one customer's by partnerId", async () => {
    const params = { ERP_BASE_URL: "https://erp.example/api/v1/web/erp/" };
    expect(await erp.inForce(params)).toEqual({
      data: { items: [] },
      ok: true,
      status: 200,
    });
    await erp.inForce(params, "C 21");
    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init.method]),
    ).toEqual([
      ["https://erp.example/api/v1/web/erp/contracts/in-force", "GET"],
      [
        "https://erp.example/api/v1/web/erp/contracts/in-force?partnerId=C%2021",
        "GET",
      ],
    ]);
  });
});
