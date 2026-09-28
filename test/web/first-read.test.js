/*
 * What the Admin page reads before it draws anything: the ERPs' status, the settings (Commerce's
 * websites read again), the Activity records and the scheduled runs, all together.
 */
import { readFirst } from "#web/first-read.js";

function fakeApi(overrides = {}) {
  return {
    history: vi.fn(async () => ({ entries: [{ kind: "order" }] })),
    scheduled: vi.fn(async () => ({ scheduled: [{ id: "prices" }] })),
    settings: vi.fn(async () => ({ scopes: [] })),
    status: vi.fn(async () => ({ erp: { reachable: true } })),
    ...overrides,
  };
}

describe("Given the page opening", () => {
  test("Then everything it shows first is read together, the websites read again", async () => {
    const api = fakeApi();
    const read = await readFirst(api);
    expect(read).toStrictEqual({
      initial: {
        history: [{ kind: "order" }],
        runs: [{ id: "prices" }],
        settingsPage: { scopes: [] },
        status: { erp: { reachable: true } },
      },
      trouble: null,
    });
    expect(api.settings).toHaveBeenCalledWith(undefined, { refresh: true });
    expect(api.history).toHaveBeenCalledWith(false);
  });

  test("Then Activity that cannot be read leaves the page up, empty, with the reason", async () => {
    const api = fakeApi({
      history: vi.fn(async () => {
        throw new Error("State is down");
      }),
    });
    const read = await readFirst(api);
    expect(read.initial.history).toStrictEqual([]);
    expect(read.trouble).toBe("Activity could not be read: State is down");
  });

  test("Then a status that cannot be read is the page's failure", async () => {
    const api = fakeApi({
      status: vi.fn(async () => {
        throw new Error("401");
      }),
    });
    await expect(readFirst(api)).rejects.toThrow("401");
  });
});
