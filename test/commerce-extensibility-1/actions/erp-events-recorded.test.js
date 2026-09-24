/*
 * Every ERP event handler records how its events ended (lib/erp-event-history.js). A
 * handler added without the wrapper would silently leave the Admin screen's history.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS = "src/commerce-extensibility-1/actions";
const WRAPPED = /const main = recordingErpEvent\("[a-z-]+", handle\);/u;

function eventHandlers() {
  return readdirSync(ACTIONS)
    .filter((area) => readdirSync(join(ACTIONS, area)).includes("external"))
    .flatMap((area) =>
      readdirSync(join(ACTIONS, area, "external"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          join(ACTIONS, area, "external", entry.name, "index.js"),
        ),
    );
}

describe("Given the ERP event handlers", () => {
  test("Then there are the nine the ERP's contract names", () => {
    expect(eventHandlers()).toHaveLength(9);
  });

  test.each(eventHandlers())("Then %s records its events", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(WRAPPED);
  });
});
