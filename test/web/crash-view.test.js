/* What the Admin page shows when it crashes, instead of a blank frame. */
import { crashReport } from "#web/crash-view.js";

describe("Given the Admin page crashed while drawing", () => {
  test("Then it says so in plain words and that the integration keeps working", () => {
    const report = crashReport(new Error("boom"));
    expect(report.title).toBe("This page hit an error");
    expect(report.body).toBe(
      "The integration keeps running: orders and updates still cross. Reload the page to try again.",
    );
  });

  test("Then the details carry the error's stack, for whoever fixes it", () => {
    const error = new Error("boom");
    expect(crashReport(error).details).toBe(error.stack);
  });

  test("Then something thrown that is not an Error still has details", () => {
    expect(crashReport("plain text").details).toBe("plain text");
    expect(crashReport(undefined).details).toBe("No details were given.");
  });
});
