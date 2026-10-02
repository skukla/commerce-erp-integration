/*
 * The two company balance writes of the payment leg (AB-26s): a payment the ERP posted gives
 * the company its credit back (increaseBalance, operation type 4, Reimbursed), and a demo
 * reset takes it back (decreaseBalance, type 4). Both measured live on Justrite 2026-10-02:
 * each answers true and moves the company's available credit by the value; the history row
 * reads type 4 with the purchase order and the comment. The client is a stand-in recording
 * each request.
 */
const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({ post: mockPost })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  decreaseCompanyBalance,
  increaseCompanyBalance,
} from "#lib/company-balance";

const answer = (body) => ({ json: () => Promise.resolve(body) });

const MOVE = {
  comment: "Paid in Justrite ERP (payment 7000000001, invoice 0000000101)",
  currency: "USD",
  orderIncrement: "5000000002",
  purchaseOrder: "7000000001",
  value: 42.5,
};

const BODY = {
  comment: MOVE.comment,
  currency: "USD",
  operationType: 4,
  options: { order_increment: "5000000002", purchase_order: "7000000001" },
  value: 42.5,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a payment to reimburse to a company's credit", () => {
  test("Then increaseBalance is posted to the credit, as Reimbursed, naming the order and the payment", async () => {
    mockPost.mockReturnValue(answer(true));

    expect(await increaseCompanyBalance({}, 22, MOVE)).toBe(true);

    expect(mockPost).toHaveBeenCalledExactlyOnceWith(
      "companyCredits/22/increaseBalance",
      { json: BODY },
    );
  });
});

describe("Given a reimbursement to take back on a reset", () => {
  test("Then decreaseBalance is posted to the same credit, as Reimbursed, for the same value", async () => {
    mockPost.mockReturnValue(answer(true));

    expect(await decreaseCompanyBalance({}, 22, MOVE)).toBe(true);

    expect(mockPost).toHaveBeenCalledExactlyOnceWith(
      "companyCredits/22/decreaseBalance",
      { json: BODY },
    );
  });
});
