/*
 * A Commerce return reaches the ERP as a return order (contract version 13: POST returns),
 * asked like the ERP's other routes: at the ERP's address, with the IMS token.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  getImsAuthProvider: () => ({
    getHeaders: async () => ({ Authorization: "Bearer t" }),
  }),
  resolveImsAuthParams: () => ({ clientId: "c", imsOrgId: "o" }),
}));

import { erp, resetErpTokenCache } from "#lib/erp";

import contract from "../../contract/erp-contract.json" with { type: "json" };

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 201,
  text: async () => JSON.stringify({ number: "8000000001" }),
}));

beforeEach(() => {
  resetErpTokenCache();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("Given a return order for the ERP", () => {
  test("Then it is POST returns with the body as given, and the ERP's answer comes back", async () => {
    const body = {
      commerceReturnId: "4",
      commerceReturnIncrementId: "000000004",
      lines: [{ commerceItemId: 38, qty: 2, reason: "damaged" }],
      orderNumber: "0000001000",
      origin: { event: "observer.rma_save_commit_after" },
    };
    const params = { ERP_BASE_URL: "https://erp.example/api/v1/web/erp" };

    expect(await erp.fromCommerce.sendReturn(params, body)).toEqual({
      data: { number: "8000000001" },
      ok: true,
      status: 201,
    });
    const [[url, init]] = fetchMock.mock.calls;
    expect([url, init.method, JSON.parse(init.body)]).toEqual([
      "https://erp.example/api/v1/web/erp/returns",
      "POST",
      body,
    ]);
    // The body's keys are the ones the ERP's contract asks for.
    expect(Object.keys(body).sort()).toEqual(
      [...contract.returns.request].sort(),
    );
  });
});
