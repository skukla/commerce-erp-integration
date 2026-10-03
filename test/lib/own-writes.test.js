/*
 * lib/own-writes: the name and price this integration wrote to a Commerce product for an ERP
 * event, remembered for two minutes so the save event that write raises is not imported back
 * into the ERP (AB-62, Justrite 2026-10-02: a late echo of a first rename undid a second).
 */
import {
  isOwnProductWrite,
  noteProductWrite,
  OWN_WRITE_TTL_SECONDS,
  resetOwnWritesClient,
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
