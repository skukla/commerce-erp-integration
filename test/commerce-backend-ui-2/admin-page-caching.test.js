/*
 * The Admin page's index.html is never kept by the browser.
 *
 * App Builder's static hosting sends no cache-control unless the app asks, and then a
 * browser picks its own lifetime from how old the file is. After the 2026-10-14 update on
 * Justrite the server held the new page while Chrome kept showing the old one for hours,
 * which read as a failed deploy. index.html is a few hundred bytes and names the hashed
 * bundles, so it alone is told to check every time; the bundles keep their caching.
 *
 * The rule lives in ext.config.yaml's `web` section. The CLI's upload (aio-lib-web
 * remote-storage `getResponseHeadersForFile`) matches `/*.html` against the built file, and
 * a `cache-control` there becomes the stored object's Cache-Control. The lib-app
 * pre-app-build hook keeps an existing `web` entry (`buildWeb` adds one only when absent).
 */
import { readFileSync } from "node:fs";

import { parse } from "yaml";

const config = parse(
  readFileSync(
    new URL("../../src/commerce-backend-ui-2/ext.config.yaml", import.meta.url),
    "utf8",
  ),
);

describe("Given the Admin page's static site", () => {
  test("Then its source folder is still web-src", () => {
    expect(config.web.src).toBe("web-src");
  });

  test("Then every HTML file is sent with no-cache, so an update shows on the next load", () => {
    expect(config.web["response-headers"]).toEqual({
      "/*.html": { "cache-control": "no-cache" },
    });
  });
});
