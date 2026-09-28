/*
 * No log line prints an action's whole params: they carry the integration's IMS client secret
 * (AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS), and paramsForErp's carry an added ERP's own
 * (AB-16a). A log of params goes through stringParameters (lib/utils.js), which hides every
 * key naming a secret or a token.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { stringParameters } from "#lib/utils";

const RAW_PARAMS_IN_A_LOG =
  /logger\.\w+\([^;]*JSON\.stringify\(\s*(params|erpParams|target)\s*\)/u;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "web-src" || entry.name.startsWith(".")
        ? []
        : sourceFiles(path);
    }
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

describe("Given the actions' logs", () => {
  test("Then none prints an action's whole params", () => {
    const files = sourceFiles("src");
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) =>
      RAW_PARAMS_IN_A_LOG.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  test("Then the check would see one (control)", () => {
    expect(
      RAW_PARAMS_IN_A_LOG.test(
        'logger.debug("Start sending data: " + JSON.stringify(params));',
      ),
    ).toBe(true);
  });

  test("Then params printed through stringParameters hide the IMS secret", () => {
    const printed = stringParameters({
      AIO_COMMERCE_AUTH_IMS_CLIENT_ID: "client",
      AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: ["fake-test-secret-not-a-secret"],
    });
    expect(printed).toContain("client");
    expect(printed).not.toContain("fake-test-secret-not-a-secret");
  });
});
