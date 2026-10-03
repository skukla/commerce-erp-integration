/*
 * lib/own-writes: the name and price this integration wrote to a Commerce product for an ERP
 * event, remembered for two minutes so the save event that write raises is not imported back
 * into the ERP (AB-62, Justrite 2026-10-02: a late echo of a first rename undid a second).
 */
import {
  ERP_ECHO_TTL_SECONDS,
  isErpEcho,
  isOwnProductWrite,
  noteProductWrite,
  OWN_WRITE_TTL_SECONDS,
  resetOwnWritesClient,
  sentToErp,
} from "#lib/own-writes";

import { fakeState } from "../box/state.js";

let state;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T16:06:34Z"));
  state = fakeState();
  resetOwnWritesClient(state);
});
afterEach(() => {
  vi.useRealTimers();
  resetOwnWritesClient();
});

const HASHED_KEY = /^own-write-product\.[0-9a-f]{64}$/u;
const ERP_KEY = /^own-write-erp\.[0-9a-f]{64}$/u;
const later = (seconds) => vi.advanceTimersByTime(seconds * 1000);

describe("Given a product write the integration made", () => {
  test("Then a save carrying the same name and price is its own", async () => {
    await noteProductWrite("A1", { name: "Trouser (test)", price: 12 });
    expect(
      await isOwnProductWrite("A1", { name: "Trouser (test)", price: 12 }),
    ).toBe(true);
  });

  test("Then a save whose name or price differs, or that is another product's, is not", async () => {
    await noteProductWrite("A1", { name: "Trouser (test)", price: 12 });
    expect(await isOwnProductWrite("A1", { name: "Trouser", price: 12 })).toBe(
      false,
    );
    expect(
      await isOwnProductWrite("A1", { name: "Trouser (test)", price: 13 }),
    ).toBe(false);
    expect(
      await isOwnProductWrite("B2", { name: "Trouser (test)", price: 12 }),
    ).toBe(false);
  });

  test("Then nothing is its own before any write", async () => {
    expect(await isOwnProductWrite("A1", { name: "Trouser", price: 10 })).toBe(
      false,
    );
  });

  test("Then every echo inside two minutes is its own, not only the first", async () => {
    await noteProductWrite("A1", { name: "Trouser (test)", price: 12 });
    const echo = { name: "Trouser (test)", price: 12 };
    expect(await isOwnProductWrite("A1", echo)).toBe(true);
    later(22);
    expect(await isOwnProductWrite("A1", echo)).toBe(true);
    later(60);
    expect(await isOwnProductWrite("A1", echo)).toBe(true);
  });

  test("Then an earlier write is still its own after a later one to the same product", async () => {
    await noteProductWrite("A1", { name: "Trouser (test)", price: 12 });
    later(14);
    await noteProductWrite("A1", { name: "Trouser", price: 12 });
    expect(
      await isOwnProductWrite("A1", { name: "Trouser (test)", price: 12 }),
    ).toBe(true);
    expect(await isOwnProductWrite("A1", { name: "Trouser", price: 12 })).toBe(
      true,
    );
  });

  test("Then after two minutes the same values are a change made in Commerce", async () => {
    expect(OWN_WRITE_TTL_SECONDS).toBe(120);
    await noteProductWrite("A1", { name: "Trouser (test)", price: 12 });
    later(119);
    expect(
      await isOwnProductWrite("A1", { name: "Trouser (test)", price: 12 }),
    ).toBe(true);
    later(2);
    expect(
      await isOwnProductWrite("A1", { name: "Trouser (test)", price: 12 }),
    ).toBe(false);
  });

  test("Then the record is kept in State for two minutes, under a key State accepts for any SKU", async () => {
    const put = vi.spyOn(state, "put");
    await noteProductWrite("51BSCU/BL BK", { name: "Cabinet", price: 99.5 });
    expect(put).toHaveBeenCalledTimes(1);
    const [key, value, options] = put.mock.calls[0];
    expect(key).toMatch(HASHED_KEY);
    expect(JSON.parse(value)).toEqual({ at: "2026-10-02T16:06:34.000Z" });
    expect(options).toEqual({ ttl: 120 });
    expect(
      await isOwnProductWrite("51BSCU/BL BK", { name: "Cabinet", price: 99.5 }),
    ).toBe(true);
  });

  test("Then Commerce's price as text is the same price", async () => {
    await noteProductWrite("A1", { name: "Trouser", price: 12.5 });
    expect(
      await isOwnProductWrite("A1", { name: "Trouser", price: "12.500000" }),
    ).toBe(true);
  });

  test("Then a write of the name alone (a configurable parent has no price) matches on the name, whatever price the save carries", async () => {
    await noteProductWrite("PARENT", { name: "Jacket (ERP)" });
    expect(
      await isOwnProductWrite("PARENT", { name: "Jacket (ERP)", price: 0 }),
    ).toBe(true);
    expect(
      await isOwnProductWrite("PARENT", { name: "Jacket", price: 0 }),
    ).toBe(false);
  });

  test("Then a write of both does not make a save with the same name and another price its own", async () => {
    await noteProductWrite("A1", { name: "Trouser", price: 12 });
    expect(await isOwnProductWrite("A1", { name: "Trouser", price: 15 })).toBe(
      false,
    );
  });

  test("Then a write that carried neither a name nor a price leaves no record", async () => {
    const put = vi.spyOn(state, "put");
    await noteProductWrite("A1", {});
    expect(put).not.toHaveBeenCalled();
  });
});

/*
 * AB-26y step 5 (ERP contract version 19): the ERP raises its events for every change, so a
 * change this integration sent it for a move made in Commerce comes back as the ERP's event.
 * The change is remembered before it is sent; its echo is recognised once, per ERP, document
 * and lines.
 */
describe("Given a change sent to an ERP for a move made in Commerce", () => {
  const SHIPMENT = {
    erpId: "erp",
    kind: "shipment",
    lines: [
      { customerLineReference: "1", qty: 5 },
      { customerLineReference: "2", qty: 4 },
    ],
    salesOrder: "0000001000",
  };
  const answered = (status) => () =>
    Promise.resolve({ data: {}, ok: status < 400, status });

  test("Then the ERP's event for it is its echo once, matched by ERP, sales order, kind and lines in any order", async () => {
    await sentToErp(SHIPMENT, answered(201));
    expect(
      await isErpEcho({ ...SHIPMENT, lines: [...SHIPMENT.lines].reverse() }),
    ).toBe(true);
    expect(await isErpEcho(SHIPMENT)).toBe(false);
  });

  test("Then another ERP's, another order's, another kind's or other lines' event is not", async () => {
    await sentToErp(SHIPMENT, answered(201));
    for (const other of [
      { ...SHIPMENT, erpId: "brand-b" },
      { ...SHIPMENT, salesOrder: "0000001001" },
      { ...SHIPMENT, kind: "invoice", lines: undefined },
      { ...SHIPMENT, lines: [{ customerLineReference: "1", qty: 5 }] },
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one lookup at a time
      expect(await isErpEcho(other)).toBe(false);
    }
    expect(await isErpEcho(SHIPMENT)).toBe(true);
  });

  test("Then two equal changes have two echoes", async () => {
    await sentToErp(SHIPMENT, answered(201));
    await sentToErp(SHIPMENT, answered(201));
    expect(await isErpEcho(SHIPMENT)).toBe(true);
    expect(await isErpEcho(SHIPMENT)).toBe(true);
    expect(await isErpEcho(SHIPMENT)).toBe(false);
  });

  test("Then the change is remembered before it is sent, so an echo delivered while the ERP answers is already known", async () => {
    let echoDuringSend;
    const res = await sentToErp(SHIPMENT, async () => {
      echoDuringSend = await isErpEcho(SHIPMENT);
      return { data: {}, ok: true, status: 201 };
    });
    expect(echoDuringSend).toBe(true);
    expect(res.status).toBe(201);
  });

  test.each([
    ["the ERP recorded nothing new (200)", "shipment", 200],
    ["the ERP refused it", "cancel", 400],
    ["the ERP was away", "hold", 503],
  ])("Then nothing is remembered when %s", async (_why, kind, status) => {
    const change = { ...SHIPMENT, kind };
    await sentToErp(change, answered(status));
    expect(await isErpEcho(change)).toBe(false);
  });

  test("Then a cancel, hold or release the ERP took (200) is remembered; an invoice only when the ERP made one (201)", async () => {
    const cancel = { erpId: "erp", kind: "cancel", salesOrder: "0000001000" };
    await sentToErp(cancel, answered(200));
    expect(await isErpEcho(cancel)).toBe(true);
    const invoice = { ...cancel, kind: "invoice" };
    await sentToErp(invoice, answered(200));
    expect(await isErpEcho(invoice)).toBe(false);
    await sentToErp(invoice, answered(201));
    expect(await isErpEcho(invoice)).toBe(true);
  });

  test("Then a send that throws remembers nothing and throws on", async () => {
    await expect(
      sentToErp(SHIPMENT, () => Promise.reject(new Error("network down"))),
    ).rejects.toThrow("network down");
    expect(await isErpEcho(SHIPMENT)).toBe(false);
  });

  test("Then the echo is known for as long as the ERP retries an undelivered event (ten one-minute retries), and not after", async () => {
    expect(ERP_ECHO_TTL_SECONDS).toBe(900);
    await sentToErp(SHIPMENT, answered(201));
    later(899);
    expect(await isErpEcho(SHIPMENT)).toBe(true);
    await sentToErp(SHIPMENT, answered(201));
    later(901);
    expect(await isErpEcho(SHIPMENT)).toBe(false);
  });

  test("Then the record sits in State under a hashed key with its own lifetime", async () => {
    const put = vi.spyOn(state, "put");
    await sentToErp(SHIPMENT, answered(201));
    const [key, value, options] = put.mock.calls[0];
    expect(key).toMatch(ERP_KEY);
    expect(JSON.parse(value)).toEqual({
      at: "2026-10-02T16:06:34.000Z",
      count: 1,
    });
    expect(options).toEqual({ ttl: 900 });
  });
});
