/*
 * The Admin page's screens and its parts gallery, looked at by a machine (owner, 2026-10-14).
 *
 * The page's tests read its pure helpers; none renders it, so a part that changes its look, or
 * a screen that throws, passed every test. This builds the preview (the real components against
 * the stand-in records in preview/), opens each screen and the parts gallery (?page=parts) in
 * Playwright's own headless Chromium, and asserts per screen that the console is clean and that
 * its computed-style FINGERPRINT equals the one checked in, so a change to how anything looks
 * has to be accepted on purpose. The design is demo-erp's test/screens.test.js, with its
 * lessons: a pinned clock, locale and zone; the pointer parked; the web fonts loaded; a sample
 * taken only once three in a row agree; and a first mismatch loaded again before it fails.
 *
 * Re-accept after an intended change:
 *   UPDATE_ADMIN_FINGERPRINTS=1 npx vitest run test/web/admin-screens.test.js
 * and read the diff of test/fixtures/admin-fingerprints.json before committing it. The rows
 * behind each fingerprint are written to $TMPDIR/erp-admin-screen-rows, a mismatch's beside
 * them, for a diff.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIST = path.join(ROOT, "preview-dist");
const FIXTURE = path.join(ROOT, "test/fixtures/admin-fingerprints.json");
const ROWS_DIR = path.join(os.tmpdir(), "erp-admin-screen-rows");
const UPDATE = process.env.UPDATE_ADMIN_FINGERPRINTS === "1";
const VIEWPORT = { height: 900, width: 1440 };
/** The moment the stand-in records are timed from, so every time on screen is the same. */
const NOW = new Date("2026-10-14T15:00:00Z");
const BUILD_MS = 180_000;
const SCREEN_MS = 60_000;
const SAMPLE_GAP_MS = 300;
const SAMPLES = 16;

/** Each screen: its address, and anything to do before it is looked at. */
const SCREENS = [
  { name: "overview", search: "?section=overview" },
  { name: "activity", search: "?section=activity" },
  {
    act: (page) => page.getByRole("button", { name: "Filters" }).click(),
    name: "activity:filters-open",
    search: "?section=activity",
  },
  { name: "activity:one-erp", search: "?section=activity&one-erp" },
  { name: "settings", search: "?section=settings" },
  { name: "data-map", search: "?section=data-map" },
  { name: "parts", search: "?page=parts" },
];

/** Layout and look, not text: the same build and records give the same rows. */
const STYLE_PROPS = [
  "display",
  "position",
  "padding",
  "margin",
  "gap",
  "color",
  "background-color",
  "border-color",
  "border-width",
  "border-radius",
  "font-size",
  "font-weight",
  "opacity",
];

const TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
};

let server;
let base;
let browser;
let recorded = {};
const seen = {};

function serve() {
  return new Promise((resolve) => {
    server = http
      .createServer((req, res) => {
        let file = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
        if (file.endsWith("/")) {
          file += "index.html";
        }
        fs.readFile(file, (error, data) => {
          if (error) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type":
              TYPES[path.extname(file)] ?? "application/octet-stream",
          });
          res.end(data);
        });
      })
      .listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${server.address().port}/`;
        resolve();
      });
  });
}

beforeAll(async () => {
  execFileSync(
    "npx",
    ["parcel", "build", "--target", "preview", "--no-cache"],
    {
      cwd: ROOT,
      stdio: "ignore",
    },
  );
  await serve();
  browser = await chromium.launch();
  if (fs.existsSync(FIXTURE)) {
    recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  }
}, BUILD_MS);

afterAll(async () => {
  await browser?.close();
  server?.close();
  if (UPDATE || !fs.existsSync(FIXTURE)) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(
      FIXTURE,
      `${JSON.stringify({ ...recorded, ...seen }, null, 2)}\n`,
    );
  }
});

/** One screen, opened fresh, its console's complaints collected. */
async function open(screen) {
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "UTC",
    viewport: VIEWPORT,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  const problems = [];
  page.on("console", (m) => {
    if (m.type() === "error") {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}${screen.search}`);
  await page.waitForSelector(".erp-page", { timeout: SCREEN_MS });
  // Wait for the page's web fonts. Under load the font arrived after three samples had
  // already agreed on the fallback's text wrapping, so a table measured ~100 px shorter
  // and a screen failed in the full suite and passed alone (2026-10-14).
  await page.evaluate(() => document.fonts.ready);
  // Park the pointer on empty canvas: a control under it is drawn hovered.
  await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height - 4);
  if (screen.act) {
    await screen.act(page);
    await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height - 4);
  }
  return { context, page, problems };
}

/** The page's own classes (Spectrum's are generated and say nothing a style does not). */
const OURS = /^(adm|erp|band|tab|chip|badge|btn|map|dm|mg|ex|gallery)/u;

/** The screen as rows: each element's tag, our classes, chosen styles and rounded size. */
function rowsOf(page) {
  return page.evaluate(
    ({ props, source }) => {
      const ours = new RegExp(source, "u");
      return [...document.querySelectorAll(".erp-page, .erp-page *")].map(
        (el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const classes = [...el.classList]
            .filter((c) => ours.test(c))
            .join(".");
          return [
            el.tagName,
            classes,
            ...props.map((p) => cs.getPropertyValue(p)),
            Math.round(r.width),
            Math.round(r.height),
          ].join("|");
        },
      );
    },
    { props: STYLE_PROPS, source: OURS.source },
  );
}

const digest = (rows) =>
  crypto.createHash("sha256").update(rows.join("\n")).digest("hex");

/** The fingerprint once the screen has stopped moving: three samples in a row that agree. */
async function fingerprint(page) {
  let rows = await rowsOf(page);
  let agreed = 0;
  for (let i = 0; i < SAMPLES && agreed < 2; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: each sample must follow the last in time.
    await page.waitForTimeout(SAMPLE_GAP_MS);
    const again = await rowsOf(page);
    if (digest(again) === digest(rows)) {
      agreed += 1;
    } else {
      agreed = 0;
      rows = again;
    }
  }
  return { elements: rows.length, hash: digest(rows), rows };
}

const rowsFile = (name, suffix = "") =>
  path.join(ROWS_DIR, `${name.replace(":", "-")}${suffix}.txt`);

/** Whether a look matches the recorded one, keeping its rows on disk for a diff. */
function matches(name, look, suffix = "") {
  fs.mkdirSync(ROWS_DIR, { recursive: true });
  fs.writeFileSync(rowsFile(name, suffix), look.rows.join("\n"));
  const was = recorded[name];
  return (
    Boolean(was) && was.hash === look.hash && was.elements === look.elements
  );
}

/** Look at one screen: a first mismatch is loaded again; two in a row fail, or are taken. */
async function check(screen) {
  const first = await open(screen);
  const look = await fingerprint(first.page);
  await first.context.close();
  expect(first.problems, `${screen.name}: the console`).toStrictEqual([]);
  if (!recorded[screen.name] || matches(screen.name, look)) {
    seen[screen.name] = { elements: look.elements, hash: look.hash };
    return;
  }
  const second = await open(screen);
  const again = await fingerprint(second.page);
  await second.context.close();
  if (matches(screen.name, again, ".mismatch")) {
    seen[screen.name] = { elements: again.elements, hash: again.hash };
    return;
  }
  if (UPDATE && again.hash === look.hash) {
    seen[screen.name] = { elements: again.elements, hash: again.hash };
    return;
  }
  throw new Error(
    `${screen.name} looks different from its recorded fingerprint ` +
      `(${again.elements} elements, ${recorded[screen.name].elements} recorded). ` +
      `Rows: ${rowsFile(screen.name, ".mismatch")}. If the change is meant, re-accept with ` +
      "UPDATE_ADMIN_FINGERPRINTS=1 and read the fixture's diff.",
  );
}

describe("Given the Admin page's screens and its parts", () => {
  for (const screen of SCREENS) {
    test(
      `Then ${screen.name} renders cleanly and looks as recorded`,
      () => check(screen),
      SCREEN_MS * 2,
    );
  }
});
