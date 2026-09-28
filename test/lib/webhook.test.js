import { readPayload } from "#lib/webhook";

describe("Given a web action's body", () => {
  test("Then the body is read raw, base64 or from params", () => {
    expect(readPayload({ __ow_body: JSON.stringify({ a: 1 }) })).toEqual({
      a: 1,
    });
    expect(
      readPayload({
        __ow_body: Buffer.from(JSON.stringify({ b: 2 })).toString("base64"),
      }),
    ).toEqual({ b: 2 });
    expect(readPayload({ c: 3 })).toEqual({ c: 3 });
    expect(readPayload({ __ow_body: "not json" })).toEqual({});
  });
});
