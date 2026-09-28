/* A part's status from its send: a refusal keeps the part open, never dropped. */
import { FINAL_OUTCOMES, partStatusOf } from "#lib/order-parts";

describe("Given the outcome of sending a part", () => {
  test("Then a refused part is failed and marked refused, so it can be sent again", () => {
    const status = partStatusOf({ outcome: "dropped" });
    expect(status).toStrictEqual({ refused: true, status: "failed" });
    expect(FINAL_OUTCOMES).not.toContain(status.status);
  });

  test("Then any other outcome is the part's status as it came", () => {
    expect(partStatusOf({ outcome: "sent" })).toStrictEqual({ status: "sent" });
    expect(partStatusOf({ outcome: "held" })).toStrictEqual({ status: "held" });
  });
});
