/* The key-map action: GET reads the map; PUT replaces it (Demo Builder, after each fill). */
vi.mock("#lib/key-map", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readKeyMap: vi.fn(async () => [
      { commerce: "12", erp: "C000102", kind: "customer" },
    ]),
    replaceKeyMap: vi.fn(async () => undefined),
  };
});

import { readKeyMap, replaceKeyMap } from "#lib/key-map";
import { main } from "#src/erp/keymap/index";

const put = (body) => ({ __ow_body: JSON.stringify(body), __ow_method: "put" });

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the key-map action", () => {
  test("Then GET answers the map", async () => {
    const res = await main({ __ow_method: "get" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      entries: [{ commerce: "12", erp: "C000102", kind: "customer" }],
    });
  });

  test("Then PUT replaces the map and answers how many rows it holds", async () => {
    const entries = [{ commerce: "12", erp: "C000102", kind: "customer" }];
    const res = await main(put({ entries }));
    expect(replaceKeyMap).toHaveBeenCalledWith(entries);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ entries: 1 });
  });

  test("Then a malformed PUT is refused and nothing is saved", async () => {
    const res = await main(
      put({ entries: [{ commerce: "x", erp: "C1", kind: "customer" }] }),
    );
    expect(res.statusCode ?? res.error?.statusCode).toBe(400);
    expect(replaceKeyMap).not.toHaveBeenCalled();
  });

  test("Then another method is refused", async () => {
    const res = await main({ __ow_method: "delete" });
    expect(res.statusCode ?? res.error?.statusCode).toBe(400);
    expect(readKeyMap).not.toHaveBeenCalled();
  });
});
