/* Which ERPs hold one order, with several ERPs (router/order-holders.js, AB-16h). */
import { resetOrderPartsClient, writeOrderParts } from "#lib/order-parts";
import { orderHolders } from "#router/order-holders";

import { fakeState } from "../box/state.js";
import { BOTH, CONTOSO } from "../lib/per-erp-harness.js";

beforeEach(() => resetOrderPartsClient(fakeState()));

const held = (holders) =>
  holders.map(({ entry, number }) => [entry.id, number]);

test("Given a routed order, Then its parts' ERPs hold it, in list order", async () => {
  await writeOrderParts("42", {
    parts: {
      contoso: { erpNumber: "0000002000" },
      erp: { status: "held" },
    },
  });
  expect(held(await orderHolders({}, BOTH, { incrementId: "42" }))).toEqual([
    ["contoso", "0000002000"],
  ]);
});

test("Given an order with an ERP number and no parts, Then it is the first ERP's", async () => {
  const holders = await orderHolders({}, BOTH, {
    extOrderId: "NW-0000001000",
    incrementId: "42",
  });
  expect(held(holders)).toEqual([["erp", "0000001000"]]);
});

test("Given no first ERP in the list, Then an unrouted number names no ERP", async () => {
  const holders = await orderHolders({}, [CONTOSO, { ...CONTOSO, id: "x" }], {
    extOrderId: "0000001000",
    incrementId: "42",
  });
  expect(holders).toEqual([]);
});

test("Given nothing names an ERP, Then no ERP is searched unless asked to", async () => {
  const byReference = vi.fn(async () => "0000001000");
  expect(
    await orderHolders({}, BOTH, { byReference, incrementId: "42" }),
  ).toEqual([]);
  expect(byReference).not.toHaveBeenCalled();
});
