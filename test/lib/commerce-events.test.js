import { describe, expect, test } from "vitest";

import { COMMERCE_EVENTS, originOf, withEventId } from "#lib/commerce-events";

/*
 * The origin an ERP write carries is in the ERP's words (its contract version 16): this system
 * and the document the change was about, never Commerce's event vocabulary.
 */
describe("Given the origin an ERP write carries", () => {
  test("Then it names this system and the document, with its number, and carries the delivered event's id", () => {
    expect(
      originOf(
        COMMERCE_EVENTS.productSaved,
        { data: {}, id: "ca67f792-f56e-45f3-ba7c-7c97302bcc00" },
        "A1",
      ),
    ).toEqual({
      document: "product A1",
      eventId: "ca67f792-f56e-45f3-ba7c-7c97302bcc00",
      system: "Adobe Commerce",
    });
  });

  test("Then without an id or a number it still names the system and the document, rather than inventing either", () => {
    expect(originOf(COMMERCE_EVENTS.orderSaved, { data: {} })).toEqual({
      document: "order",
      system: "Adobe Commerce",
    });
    expect(originOf(COMMERCE_EVENTS.shipmentSaved, undefined, 900)).toEqual({
      document: "shipment 900",
      system: "Adobe Commerce",
    });
    expect(
      JSON.stringify(originOf(COMMERCE_EVENTS.stockItemSaved)),
    ).not.toContain("observer.");
  });

  test("Then an origin made before the event's id was known takes it on", () => {
    const origin = originOf(COMMERCE_EVENTS.productSaved, undefined, "A1");
    expect(withEventId(origin, { id: "e-1" })).toEqual({
      ...origin,
      eventId: "e-1",
    });
    expect(withEventId(origin, {})).toEqual(origin);
  });
});
