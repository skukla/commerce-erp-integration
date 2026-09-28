/*
 * The Commerce reads the Admin page needs beyond the sync's own: the order statuses a merchant
 * can pick for "Order status when the ERP confirms", and companies found by name. The client is
 * a stand-in answering REST paths; the answers follow Adobe's Commerce as a Cloud Service REST
 * reference (GET /V1/order-statuses, GET /V1/company/), not yet captured live.
 */
const mockGet = vi.fn();
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ get: mockGet })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  findCompaniesByName,
  pendingOrderStatuses,
} from "#lib/commerce-admin-reads";

/** Every status with its state, as the reference's response sample shapes it. */
const STATUSES = [
  {
    default: true,
    label: "Pending",
    state: "new",
    status: "pending",
    visible_on_front: true,
  },
  {
    default: false,
    label: "Confirmed in ERP",
    state: "new",
    status: "erp_confirmed",
    visible_on_front: true,
  },
  {
    default: false,
    label: "Awaiting ERP review",
    state: "new",
    status: "erp_review",
    visible_on_front: false,
  },
  {
    default: true,
    label: "Processing",
    state: "processing",
    status: "processing",
    visible_on_front: true,
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given Commerce's order statuses", () => {
  test("Then the choices are the Pending state's statuses that are not its default, by label", async () => {
    mockGet.mockReturnValue({ json: () => Promise.resolve(STATUSES) });

    const choices = await pendingOrderStatuses({});

    expect(mockGet).toHaveBeenCalledWith("order-statuses");
    expect(choices).toStrictEqual([
      { label: "Awaiting ERP review", value: "erp_review" },
      { label: "Confirmed in ERP", value: "erp_confirmed" },
    ]);
  });

  test("Then an answer that is not a list is no choices, not an error", async () => {
    mockGet.mockReturnValue({ json: () => Promise.resolve({ message: "?" }) });
    expect(await pendingOrderStatuses({})).toStrictEqual([]);
  });
});

describe("Given a company name to find", () => {
  test("Then Commerce is searched by a part of the name, and each match is its id and name", async () => {
    mockGet.mockReturnValue({
      json: () =>
        Promise.resolve({
          items: [
            { company_name: "Kukla Studios", id: 4 },
            { company_name: "Kukla Studios West", id: 9 },
          ],
          total_count: 2,
        }),
    });

    const found = await findCompaniesByName({}, "  kukla ");

    const [path, options] = mockGet.mock.calls[0];
    expect(path).toBe("company/");
    expect(options.searchParams).toMatchObject({
      "searchCriteria[filter_groups][0][filters][0][condition_type]": "like",
      "searchCriteria[filter_groups][0][filters][0][field]": "company_name",
      "searchCriteria[filter_groups][0][filters][0][value]": "%kukla%",
    });
    expect(found).toStrictEqual([
      { id: "4", name: "Kukla Studios" },
      { id: "9", name: "Kukla Studios West" },
    ]);
  });

  test("Then the search's own wildcards in a name are taken as plain text, not patterns", async () => {
    mockGet.mockReturnValue({ json: () => Promise.resolve({ items: [] }) });

    await findCompaniesByName({}, "100%_off");

    const [, options] = mockGet.mock.calls[0];
    expect(
      options.searchParams["searchCriteria[filter_groups][0][filters][0][value]"],
    ).toBe("%100off%");
  });
});
