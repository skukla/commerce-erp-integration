/*
 * The learnings ledger names the test that pins each lesson. A test renamed or deleted
 * without the ledger saying so is a lesson quietly dropped, so every name it cites must
 * still exist in the suite.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const LEDGER = readFileSync(
  join(ROOT, "docs/live-validation-learnings.md"),
  "utf8",
);

function testFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return testFiles(path);
    }
    return name.endsWith(".test.js") ? [path] : [];
  });
}

const SUITE = testFiles(join(ROOT, "test"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** The backticked names that start like a test title ("Then …" or "partners …"). */
const CITED = [...LEDGER.matchAll(/`((?:Then |partners )[^`]+)`/gu)].map(
  (m) => m[1],
);

describe("Given the live-validation learnings ledger", () => {
  test("Then it cites at least one pinning test per dated lesson", () => {
    expect(CITED.length).toBeGreaterThanOrEqual(5);
  });

  test.each(CITED)("Then the test it names still exists: %s", (title) => {
    expect(SUITE).toContain(title);
  });
});
