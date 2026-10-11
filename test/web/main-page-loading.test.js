/*
 * The Admin page keeps a spinner up for its whole first read.
 *
 * The Admin UI library (@adobe/aio-commerce-lib-admin-ui 1.1.0) draws the page through a
 * TanStack router Outlet, and the root route's Outlet wraps the page in a Suspense whose
 * fallback is the router's pending component: none is set, so it is null. A page that suspends
 * there shows NOTHING, not the library's "Connecting to Commerce Admin" spinner (measured
 * 2026-10-11: blank for the whole wait). So the page must bring its own boundary.
 *
 * Rendered on the server, a suspended page with a boundary of its own emits that boundary's
 * fallback; with none, the render throws. Both are what these tests read.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@adobe/aio-commerce-lib-admin-ui/web", () => ({ useIms: vi.fn() }));
vi.mock("@react-spectrum/s2/ProgressCircle", () => ({
  ProgressCircle: (props) =>
    createElement("span", { "data-progress": props["aria-label"] }),
}));
// A first read that never answers: the page stays in its wait.
vi.mock("#web/first-read.js", () => ({
  readFirst: () => new Promise(() => undefined),
}));

// The page's api takes its address from the frame it runs in (api.js).
vi.stubGlobal("window", { location: { origin: "https://app.test" } });

const { useIms } = await import("@adobe/aio-commerce-lib-admin-ui/web");
const { MainPage } = await import("#web/pages/main-page.jsx");

describe("Given the Admin page waiting for its first read", () => {
  test("Then it draws the full-page spinner itself", () => {
    useIms.mockReturnValue({
      data: { imsOrgId: "org", imsToken: "token" },
      error: undefined,
    });

    const html = renderToString(createElement(MainPage));

    expect(html).toContain('class="page-loading"');
    expect(html).toContain('data-progress="Loading the integration"');
  });
});

describe("Given the Admin handed over no credentials", () => {
  test("Then the page says so and reads nothing", () => {
    useIms.mockReturnValue({
      data: undefined,
      error: new Error("no IMS credentials"),
    });

    const html = renderToString(createElement(MainPage));

    expect(html).toContain("The integration’s page could not load");
    expect(html).toContain("no IMS credentials");
    expect(html).not.toContain("page-loading");
  });
});
