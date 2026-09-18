import { describe, expect, test } from "vitest";

import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";

describe("Given the origin an ERP write carries", () => {
  test("Then it names the event and carries the delivered event's id", () => {
    expect(
      originOf(COMMERCE_EVENTS.productSaved, {
        data: {},
        id: "ca67f792-f56e-45f3-ba7c-7c97302bcc00",
      }),
    ).toEqual({
      event: "observer.catalog_product_save_commit_after",
      eventId: "ca67f792-f56e-45f3-ba7c-7c97302bcc00",
    });
  });

  test("Then without an id it still names the event, rather than inventing one", () => {
    expect(originOf(COMMERCE_EVENTS.orderSaved, { data: {} })).toEqual({
      event: "observer.sales_order_save_commit_after",
    });
    expect(originOf(COMMERCE_EVENTS.orderSaved)).toEqual({
      event: "observer.sales_order_save_commit_after",
    });
  });
});
