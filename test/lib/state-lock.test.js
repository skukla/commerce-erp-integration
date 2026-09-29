/*
 * The lease lock over App Builder State: one taker holds it until it releases, a second waits,
 * and it is always released — the guard that stops two writers of one State document clobbering
 * each other (AB-16g). Deterministic: the wait between tries is a no-op the test controls.
 */
import { releaseLock, takeLock, withStateLock } from "#lib/state-lock";

function memoryClient() {
  const store = new Map();
  return {
    delete: vi.fn((k) => {
      store.delete(k);
      return Promise.resolve();
    }),
    get: vi.fn((k) =>
      Promise.resolve(store.has(k) ? { value: store.get(k) } : undefined),
    ),
    put: vi.fn((k, v) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
}

const NO_WAIT = () => Promise.resolve();

describe("Given a free lock", () => {
  test("Then a taker gets a token, a second waits and is refused, and a release frees it", async () => {
    const client = memoryClient();
    const first = await takeLock(client, "k", { attempts: 1, wait: NO_WAIT });
    expect(first).toEqual(expect.any(String));

    const second = await takeLock(client, "k", { attempts: 1, wait: NO_WAIT });
    expect(second).toBeNull();

    await releaseLock(client, "k", first);
    const third = await takeLock(client, "k", { attempts: 1, wait: NO_WAIT });
    expect(third).toEqual(expect.any(String));
  });
});

describe("Given a held lock", () => {
  test("Then release ignores a token that does not hold it", async () => {
    const client = memoryClient();
    const token = await takeLock(client, "k", { attempts: 1, wait: NO_WAIT });
    await releaseLock(client, "k", "not-the-token");
    // Still held by the real token, so a fresh take is refused.
    expect(
      await takeLock(client, "k", { attempts: 1, wait: NO_WAIT }),
    ).toBeNull();
    await releaseLock(client, "k", token);
    expect(await takeLock(client, "k", { attempts: 1, wait: NO_WAIT })).toEqual(
      expect.any(String),
    );
  });
});

describe("Given withStateLock", () => {
  test("Then it runs the critical section and frees the lock afterwards", async () => {
    const client = memoryClient();
    const ran = await withStateLock(
      client,
      "k",
      () => Promise.resolve("done"),
      {
        attempts: 1,
        wait: NO_WAIT,
      },
    );
    expect(ran).toBe("done");
    // Freed: a later take succeeds.
    expect(await takeLock(client, "k", { attempts: 1, wait: NO_WAIT })).toEqual(
      expect.any(String),
    );
  });

  test("Then it frees the lock even when the critical section throws", async () => {
    const client = memoryClient();
    await expect(
      withStateLock(client, "k", () => Promise.reject(new Error("boom")), {
        attempts: 1,
        wait: NO_WAIT,
      }),
    ).rejects.toThrow("boom");
    expect(await takeLock(client, "k", { attempts: 1, wait: NO_WAIT })).toEqual(
      expect.any(String),
    );
  });

  test("Then it refuses to run the section when the lock stays taken", async () => {
    const client = memoryClient();
    await takeLock(client, "k", { attempts: 1, wait: NO_WAIT });
    const fn = vi.fn(() => Promise.resolve());
    await expect(
      withStateLock(client, "k", fn, { attempts: 1, wait: NO_WAIT }),
    ).rejects.toThrow('could not take the lock "k"');
    expect(fn).not.toHaveBeenCalled();
  });
});
