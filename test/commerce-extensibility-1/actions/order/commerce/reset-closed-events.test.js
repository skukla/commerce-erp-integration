/*
 * The one reset rule's writes reach no ERP (owner, 2026-10-30). The reset marks every order it
 * closes in State before its first Commerce write (lib/order-parts.js markClosedByReset); each
 * Commerce event its writes raise is then answered here without a word to any ERP:
 *
 * - order saved (a cancel, a refund that closes the order, a hold released, a note, the ERP
 *   number cleared): order-commerce/changed (order-commerce/created has its own test,
 *   created-reset-closed.test.js);
 * - invoice saved (Commerce may save the invoice a refund credits): order-commerce/invoiced;
 * - shipment saved (the reset ships nothing; a closed order shipped later in Admin):
 *   order-commerce/shipped;
 * - return saved (the reset closes the order's open returns): order-commerce/return-saved;
 * - credit memo saved: no handler at all, which the last test pins.
 *
 * Each has an unmarked control, so the guard is shown to stand in front of the path it guards.
 */
import { readFileSync } from "node:fs";

vi.mock("#lib/history", () => ({
  recordCommerceChange: vi.fn(async () => undefined),
}));
vi.mock("#router/part-changes", () => ({
  orderChangeToParts: vi.fn(async () => null),
}));
vi.mock("#router/part-fulfilment", () => ({
  fulfilmentFromCommerce: vi.fn(async () => null),
}));
vi.mock("#lib/checkout-invoice", () => ({
  checkoutInvoiceOf: vi.fn(async () => null),
}));
vi.mock("#lib/commerce-changes", () => {
  const sent = { message: "told the ERP", outcome: "sent", statusCode: 200 };
  return {
    invoiceFromCommerce: vi.fn(async () => sent),
    mine: vi.fn(),
    orderChangeFromCommerce: vi.fn(async () => sent),
    shipmentFromCommerce: vi.fn(async () => sent),
  };
});
vi.mock("#router/return-pieces", () => ({
  returnToErps: vi.fn(async () => ({
    message: "sent",
    outcome: "sent",
    statusCode: 200,
  })),
}));
vi.mock("#src/order/commerce-order-api-client", () => ({
  getInvoice: vi.fn(),
  // Order 55 is the one the reset closed; 56 is any other.
  getOrder: vi.fn(async (_p, id) => ({
    entity_id: id,
    increment_id: `0000000${id}`,
  })),
  getReturn: vi.fn(async (_p, id) => ({
    entity_id: id,
    order_id: id === 7 ? 55 : 56,
    status: "closed",
  })),
}));

import {
  invoiceFromCommerce,
  orderChangeFromCommerce,
  shipmentFromCommerce,
} from "#lib/commerce-changes";
import { markClosedByReset, resetOrderPartsClient } from "#lib/order-parts";
import { orderChangeToParts } from "#router/part-changes";
import { fulfilmentFromCommerce } from "#router/part-fulfilment";
import { returnToErps } from "#router/return-pieces";
import * as changed from "#src/order/commerce/changed/index";
import * as invoiced from "#src/order/commerce/invoiced/index";
import * as returnSaved from "#src/order/commerce/return-saved/index";
import * as shipped from "#src/order/commerce/shipped/index";

import { fakeState } from "../../../../box/state.js";

const CLOSED = "000000055";
const SILENT = `order ${CLOSED} was closed by the demo reset on 2026-10-30; it is not sent to any ERP.`;
const event = (value) => ({ data: { value } });

beforeEach(async () => {
  resetOrderPartsClient(fakeState());
  await markClosedByReset(CLOSED, "2026-10-30");
});
afterEach(() => {
  resetOrderPartsClient();
  vi.clearAllMocks();
});

describe("Given an order saved by the reset (a cancel, a refund, a hold released, a note)", () => {
  test("Then order-commerce/changed tells no ERP, not even a split order's", async () => {
    const res = await changed.main(
      event({ _isNew: false, increment_id: CLOSED, state: "closed" }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe(SILENT);
    expect(orderChangeToParts).not.toHaveBeenCalled();
    expect(orderChangeFromCommerce).not.toHaveBeenCalled();
  });

  test("Then any other order's save is told as before", async () => {
    await changed.main(
      event({ _isNew: false, increment_id: "000000056", state: "canceled" }),
    );
    expect(orderChangeFromCommerce).toHaveBeenCalledTimes(1);
  });
});

describe("Given an invoice saved on an order the reset closed", () => {
  test("Then order-commerce/invoiced tells no ERP", async () => {
    const res = await invoiced.main(
      event({ entity_id: 900, increment_id: "900", order_id: 55, state: 2 }),
    );
    expect(res.body.message).toBe(SILENT);
    expect(fulfilmentFromCommerce).not.toHaveBeenCalled();
    expect(invoiceFromCommerce).not.toHaveBeenCalled();
  });

  test("Then an invoice on any other order is told as before", async () => {
    await invoiced.main(
      event({ entity_id: 901, increment_id: "901", order_id: 56, state: 2 }),
    );
    expect(invoiceFromCommerce).toHaveBeenCalledTimes(1);
  });
});

describe("Given a shipment saved on an order the reset closed", () => {
  test("Then order-commerce/shipped tells no ERP", async () => {
    const res = await shipped.main(
      event({ entity_id: 902, items: [], order_id: 55 }),
    );
    expect(res.body.message).toBe(SILENT);
    expect(fulfilmentFromCommerce).not.toHaveBeenCalled();
    expect(shipmentFromCommerce).not.toHaveBeenCalled();
  });

  test("Then a shipment on any other order is told as before", async () => {
    await shipped.main(event({ entity_id: 903, items: [], order_id: 56 }));
    expect(shipmentFromCommerce).toHaveBeenCalledTimes(1);
  });
});

describe("Given a return saved (closed) by the reset", () => {
  test("Then order-commerce/return-saved sends no ERP its piece", async () => {
    const res = await returnSaved.main(
      event({ entity_id: 7, order_id: 55, status: "closed" }),
    );
    expect(res.body.message).toBe(SILENT);
    expect(returnToErps).not.toHaveBeenCalled();
  });

  test("Then a return on any other order goes on to the ERPs as before", async () => {
    await returnSaved.main(event({ entity_id: 8, order_id: 56 }));
    expect(returnToErps).toHaveBeenCalledTimes(1);
  });
});

describe("Given the reset's credit memos", () => {
  test("Then no Commerce event of a credit memo is subscribed to, so a refund's credit memo reaches no handler", () => {
    const config = readFileSync(
      new URL("../../../../../app.commerce.config.ts", import.meta.url),
      "utf8",
    );
    const subscribed = [
      ...config.matchAll(/name: "(observer\.[a-z_]+)"/gu),
    ].map(([, name]) => name);
    // Positive control: the order and return saves the guards above answer are subscribed.
    expect(subscribed).toEqual(
      expect.arrayContaining([
        "observer.sales_order_save_commit_after",
        "observer.sales_order_invoice_save_after",
        "observer.sales_order_shipment_save_after",
        "observer.rma_save_commit_after",
      ]),
    );
    expect(subscribed.filter((name) => name.includes("creditmemo"))).toEqual(
      [],
    );
  });
});
