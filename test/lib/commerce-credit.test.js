/*
 * The two company writes. Commerce refuses `PUT companyCredits/{id}` without the record's
 * `currency_code` ("currency_code is required") and refuses a company PUT that carries
 * only `{id, status}` ("No such entity with customerGroupId = null") — both measured
 * 2026-09-24 on ACCS, where they had failed the ERP's credit and block events AND detach's
 * revert with a 400 and a 404. Each writer now reads the record first and writes it whole.
 * The client is a stand-in recording each request.
 */
const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet, put: mockPut })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import { setCompanyCreditLimit, setCompanyStatus } from "#lib/commerce";

const answer = (body) => ({ json: () => Promise.resolve(body) });

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a company credit limit to write", () => {
  test("Then the PUT carries the record's currency code beside the limit", async () => {
    mockGet.mockReturnValue(
      answer({
        company_id: 21,
        credit_limit: 120_000,
        currency_code: "USD",
        id: 21,
      }),
    );
    mockPut.mockReturnValue(answer({ credit_limit: 150_000, id: 21 }));

    const result = await setCompanyCreditLimit({}, 21, "21", 150_000);

    expect(mockGet).toHaveBeenCalledWith("companyCredits/21");
    expect(mockPut).toHaveBeenCalledWith("companyCredits/21", {
      json: {
        creditLimit: {
          company_id: "21",
          credit_limit: 150_000,
          currency_code: "USD",
          id: 21,
        },
      },
    });
    expect(result).toEqual({ credit_limit: 150_000, id: 21 });
  });
});

describe("Given a company status to write", () => {
  test("Then the whole company is read and written back with the status changed", async () => {
    const company = {
      company_email: "a@b.example",
      company_name: "Kukla Studios",
      customer_group_id: 1,
      id: 21,
      status: 1,
      super_user_id: 44,
    };
    mockGet.mockReturnValue(answer(company));
    mockPut.mockReturnValue(answer({ ...company, status: 3 }));

    await setCompanyStatus({}, "21", 3);

    expect(mockGet).toHaveBeenCalledWith("company/21");
    expect(mockPut).toHaveBeenCalledWith("company/21", {
      json: { company: { ...company, id: "21", status: 3 } },
    });
  });
});
