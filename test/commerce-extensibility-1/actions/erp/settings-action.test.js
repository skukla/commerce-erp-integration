/* The Admin page's settings action: GET a scope's page, PATCH changes at a scope. */
vi.mock("#lib/settings", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveSettings: vi.fn(async () => undefined),
    settingsPage: vi.fn(async (_params, scope) => ({
      scope: scope ?? "default",
    })),
  };
});
vi.mock("@adobe/aio-commerce-lib-config", () => ({
  byCodeAndLevel: vi.fn(),
  initialize: vi.fn(),
}));

import { saveSettings, settingsPage } from "#lib/settings";
import { main } from "#src/erp/settings/index";

const patch = (body) => ({
  __ow_body: JSON.stringify(body),
  __ow_method: "patch",
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Given the settings action", () => {
  test("Then GET answers Default Config's page when no scope is given", async () => {
    const res = await main({ __ow_method: "get" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ scope: "default" });
    expect(settingsPage).toHaveBeenCalledWith(expect.any(Object), undefined);
  });

  test("Then GET answers the chosen scope's page", async () => {
    const res = await main({ __ow_method: "get", scope: "w1" });
    expect(res.body).toStrictEqual({ scope: "w1" });
  });

  test("Then PATCH saves at the scope and answers the page as it now reads", async () => {
    const res = await main(
      patch({ scope: "w1", values: { orders_send: false } }),
    );
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith("w1", {
      orders_send: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toStrictEqual({ scope: "w1" });
  });

  test("Then PATCH refuses an unknown setting and saves nothing", async () => {
    const res = await main(patch({ values: { colour: true } }));
    expect(res.error.statusCode).toBe(400);
    expect(JSON.stringify(res.error.body)).toContain("colour is not a setting");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  test("Then another method is refused", async () => {
    const res = await main({ __ow_method: "delete" });
    expect(res.error.statusCode).toBe(400);
  });

  test("Then a failure is a server error with its reason", async () => {
    settingsPage.mockRejectedValueOnce(
      new Error("Commerce's websites could not be read: 401"),
    );
    const res = await main({ __ow_method: "get" });
    expect(res.error.statusCode).toBe(500);
    expect(JSON.stringify(res.error.body)).toContain("could not be read: 401");
  });
});
