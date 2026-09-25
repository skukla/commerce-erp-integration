/*
 * The custom installation step that names this app's Commerce event provider in Commerce's
 * eventing configuration, which the installer (aio-commerce-lib-app 2.0.0) leaves blank.
 * Argument-pinned: the PUT's path and body are the whole behaviour, and a mocked client
 * cannot see a malformed call any other way.
 */
const put = vi.fn(() => ({ json: () => Promise.resolve(true) }));
vi.mock("#lib/commerce", () => ({
  commerceClient: vi.fn(() => Promise.resolve({ put })),
}));
vi.mock("@adobe/aio-commerce-lib-config", () => ({
  getSystemConfigByKey: vi.fn(),
}));

import { getSystemConfigByKey } from "@adobe/aio-commerce-lib-config";

import config from "../../app.commerce.config.ts";
import {
  FIRST_COPY_APP_ID,
  install,
  uninstall,
} from "../../src/installation/set-event-provider.js";

const context = { logger: { info: vi.fn() }, params: { p: 1 } };
const FIRST = { metadata: { id: FIRST_COPY_APP_ID } };
const SECOND = { metadata: { id: "erp-integration-2" } };

afterEach(() => vi.clearAllMocks());

describe("Given the app is installed", () => {
  test("Then the first copy writes its Commerce provider's id into Commerce eventing", async () => {
    getSystemConfigByKey.mockResolvedValue({
      providers: { commerce: { id: "prov-123" }, erp: { id: "other" } },
    });

    expect(await install(FIRST, context)).toStrictEqual({
      providerId: "prov-123",
    });
    expect(getSystemConfigByKey).toHaveBeenCalledWith("events");
    expect(put).toHaveBeenCalledExactlyOnceWith(
      "eventing/updateConfiguration",
      {
        json: { config: { provider_id: "prov-123" } },
      },
    );
  });

  test("Then a second copy leaves the field alone: one field per store, no way to read it", async () => {
    expect(await install(SECOND, context)).toStrictEqual({
      skipped: "not the first copy",
    });
    expect(put).not.toHaveBeenCalled();
  });

  test("Then a missing provider record fails the step rather than writing nothing silently", async () => {
    getSystemConfigByKey.mockResolvedValue(null);
    await expect(install(FIRST, context)).rejects.toThrow(
      "No Commerce event provider",
    );
    expect(put).not.toHaveBeenCalled();
  });
});

describe("Given the app is removed", () => {
  test("Then the first copy clears the field again", async () => {
    await uninstall(FIRST, context);
    expect(put).toHaveBeenCalledExactlyOnceWith(
      "eventing/updateConfiguration",
      {
        json: { config: { provider_id: "" } },
      },
    );
  });

  test("Then a second copy's removal does not touch it", async () => {
    await uninstall(SECOND, context);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("Given the app's configuration", () => {
  test("Then it declares the step, pointing at the script, and the first copy's id matches", () => {
    expect(config.installation.customInstallationSteps).toContainEqual(
      expect.objectContaining({
        script: "./src/installation/set-event-provider.js",
      }),
    );
    expect(FIRST_COPY_APP_ID).toBe("commerce-erp-integration");
  });
});
