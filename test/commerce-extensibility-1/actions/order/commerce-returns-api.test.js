/*
 * The Commerce calls returns and credit memos make (returns-design.md §3, slices D to F): a
 * credit memo of some lines, a return read and written back whole, and a comment on a return.
 * The client is a stand-in recording each request, so the method, path and body are asserted.
 */
const { mockGet, mockPost, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
}));
vi.mock("@adobe/aio-commerce-lib-app", () => ({
  getCommerceClient: vi.fn(async () => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
  })),
}));
vi.mock("@adobe/aio-commerce-sdk/auth", () => ({
  resolveImsAuthParams: vi.fn(() => ({})),
}));

import {
  addReturnComment,
  getReturn,
  refundOrderItems,
  updateReturn,
} from "#src/order/commerce-order-api-client";

const answer = (body) => ({ json: () => Promise.resolve(body) });

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given a credit memo of some of an order's lines", () => {
  test("Then it is POST order/{id}/refund, offline, shipping 0, stock untouched, and answers the credit memo id", async () => {
    // Measured 2026-10-02: Commerce answers the new credit memo's id as a JSON string.
    mockPost.mockReturnValueOnce(answer("7"));

    const id = await refundOrderItems(
      {},
      31,
      [{ order_item_id: 38, qty: 2 }],
      "Credited in Accuform ERP (credit memo 9500000001)",
    );

    expect(id).toBe("7");
    expect(mockPost).toHaveBeenCalledExactlyOnceWith("order/31/refund", {
      json: {
        appendComment: true,
        arguments: {
          adjustment_negative: 0,
          adjustment_positive: 0,
          extension_attributes: { return_to_stock_items: [] },
          shipping_amount: 0,
        },
        comment: {
          comment: "Credited in Accuform ERP (credit memo 9500000001)",
          is_visible_on_front: 0,
        },
        items: [{ order_item_id: 38, qty: 2 }],
        notify: false,
      },
    });
  });
});

describe("Given a return", () => {
  test("Then it is read with GET returns/{id}", async () => {
    mockGet.mockReturnValueOnce(answer({ entity_id: 4, increment_id: "R1" }));

    expect(await getReturn({}, 4)).toEqual({
      entity_id: 4,
      increment_id: "R1",
    });
    expect(mockGet).toHaveBeenCalledExactlyOnceWith("returns/4");
  });

  test("Then it is written with PUT returns/{id}, the return wrapped as rmaDataObject", async () => {
    mockPut.mockReturnValueOnce(answer({}));
    const rma = { entity_id: 4, increment_id: "R1", items: [], status: "x" };

    await updateReturn({}, 4, rma);

    expect(mockPut).toHaveBeenCalledExactlyOnceWith("returns/4", {
      json: { rmaDataObject: rma },
    });
  });

  // The field names are the RMA comment's own (admin, customer_notified, visible_on_front):
  // the order comment's is_admin / is_customer_notified answer 400 "IsAdmin is not supported"
  // (Justrite sandbox, 2026-10-02; this body read back as written).
  test("Then a comment is POST returns/{id}/comments, for staff only", async () => {
    mockPost.mockReturnValueOnce(answer(true));

    await addReturnComment({}, 4, "Sent to Accuform ERP as return order 1");

    expect(mockPost).toHaveBeenCalledExactlyOnceWith("returns/4/comments", {
      json: {
        data: {
          admin: true,
          comment: "Sent to Accuform ERP as return order 1",
          customer_notified: false,
          rma_entity_id: 4,
          visible_on_front: false,
        },
      },
    });
  });
});
