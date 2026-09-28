/* The adapter contract: every ERP adapter exports sendPart and readOutcome (design v1 §2). */
import { assertAdapter } from "#adapters/contract";
import * as demoErp from "#adapters/demo-erp/index";
import * as example from "#adapters/example/index";

describe("Given the ERP adapter contract", () => {
  test("Then the demo ERP's adapter and the example skeleton both implement it", () => {
    expect(assertAdapter(demoErp, "demo-erp")).toBe(demoErp);
    expect(assertAdapter(example, "example")).toBe(example);
  });

  test("Then an adapter missing a function is refused by name", () => {
    expect(() => assertAdapter({ sendPart: () => null }, "half")).toThrow(
      "half does not implement readOutcome",
    );
    expect(() => assertAdapter(undefined)).toThrow(
      "adapter does not implement sendPart",
    );
  });

  test("Then the example adapter says what to implement instead of sending anything", () => {
    expect(() => example.sendPart({}, { erp: { id: "sap-1" } })).toThrow(
      "implement sendPart for sap-1",
    );
    expect(example.readOutcome({})).toBeNull();
  });
});
