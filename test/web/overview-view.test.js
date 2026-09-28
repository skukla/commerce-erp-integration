/*
 * What the Admin page says about each ERP: the band's chip (its color, its name, whether it
 * answers), the Overview's card per ERP, and today's counts, which the page works out from the
 * Activity records it already reads.
 */
import { shortName } from "#web/history-view.js";
import {
  erpCard,
  erpColors,
  erpStatusLine,
  listedErps,
  PALETTES,
  todayCounts,
} from "#web/overview-view.js";

const UTC = "UTC";
const NOW = new Date("2026-09-28T15:00:00Z");

const NORTHWIND = {
  appearance: { logo: "cube", nav: "rail", palette: "teal" },
  counts: { businessPartners: 5, events: 0, products: 3, salesOrders: 3 },
  id: "erp",
  lastImportAt: "2026-09-28T14:06:00Z",
  lastWipeAt: "2026-09-28T14:04:00Z",
  name: "Northwind ERP",
  reachable: true,
};
const CONTOSO = {
  error: "Contoso ERP is in maintenance until 15:55 UTC.",
  id: "contoso",
  name: "Contoso ERP",
  reachable: false,
};

describe("Given the ERPs erp/status lists", () => {
  test("Then several ERPs are the list as it is", () => {
    expect(listedErps({ erp: {}, erps: [NORTHWIND, CONTOSO] })).toStrictEqual([
      NORTHWIND,
      CONTOSO,
    ]);
  });

  test("Then one ERP is its health, named by its display name", () => {
    const [one] = listedErps({
      erp: {
        appearance: { palette: "plum" },
        counts: { products: 9 },
        displayName: "Acme ERP",
        lastImportAt: "2026-09-28T09:00:00Z",
        reachable: true,
      },
    });
    expect(one).toMatchObject({
      appearance: { palette: "plum" },
      counts: { products: 9 },
      id: "erp",
      lastImportAt: "2026-09-28T09:00:00Z",
      name: "Acme ERP",
      reachable: true,
    });
    expect(listedErps({ erp: { reachable: false } })[0].name).toBe("the ERP");
  });

  test("Then a chip names the ERP without its trailing ERP", () => {
    expect(shortName("Northwind ERP")).toBe("Northwind");
    expect(shortName("SAP")).toBe("SAP");
  });
});

describe("Given each ERP's color", () => {
  test("Then an ERP's own palette colors it, as its screen does", () => {
    const colors = erpColors([
      { ...CONTOSO, appearance: { palette: "indigo" } },
      NORTHWIND,
    ]);
    expect(colors.contoso).toStrictEqual({ ...PALETTES.indigo, from: "erp" });
    expect(colors.erp).toStrictEqual({ ...PALETTES.teal, from: "erp" });
  });

  test("Then an ERP that does not say takes the next free color in list order", () => {
    const colors = erpColors([
      CONTOSO,
      NORTHWIND,
      { id: "third", name: "Third ERP" },
    ]);
    // Contoso says nothing: teal is the first, but Northwind's own; so indigo.
    expect(colors.contoso.color).toBe(PALETTES.indigo.color);
    expect(colors.contoso.from).toBe("list");
    expect(colors.third.color).toBe(PALETTES.bronze.color);
  });

  test("Then two ERPs dressed alike are still told apart", () => {
    const colors = erpColors([
      NORTHWIND,
      { ...CONTOSO, appearance: { palette: "teal" } },
    ]);
    expect(colors.erp.color).toBe(PALETTES.teal.color);
    expect(colors.contoso.color).not.toBe(PALETTES.teal.color);
  });
});

describe("Given an ERP's state", () => {
  test("Then the band says Connected, or Not reachable and why", () => {
    expect(erpStatusLine(NORTHWIND)).toStrictEqual({
      card: "Connected",
      reachable: true,
      text: "Connected",
    });
    // The ERP's own reason names it; beside its name, the name is not said twice.
    expect(erpStatusLine(CONTOSO)).toStrictEqual({
      card: "Not reachable. In maintenance until 15:55 UTC.",
      reachable: false,
      text: "Not reachable · in maintenance until 15:55 UTC",
    });
    expect(
      erpStatusLine({ error: "the ERP answered 401", reachable: false }).card,
    ).toBe("Not reachable. The ERP answered 401.");
    expect(erpStatusLine({ reachable: false }).text).toBe("Not reachable");
  });
});

describe("Given the Overview's card for one ERP", () => {
  const history = [
    {
      direction: "from-erp",
      erpIds: ["contoso"],
      lastAt: "2026-09-28T14:51:00Z",
    },
    { direction: "from-erp", erpIds: ["erp"], lastAt: "2026-09-28T14:58:00Z" },
    { direction: "to-erp", erpIds: ["erp"], lastAt: "2026-09-28T14:59:00Z" },
  ];

  test("Then it holds the ERP's figures, its last update and when Demo Builder filled it", () => {
    expect(erpCard(NORTHWIND, history, NOW, UTC)).toStrictEqual({
      foot: "Filled by Demo Builder today at 2:06 PM · emptied today at 2:04 PM",
      inErp: "3 products · 5 business partners · 3 sales orders",
      lastUpdate: "2 minutes ago",
      waiting: "0",
    });
  });

  test("Then an ERP that gave no figures, nor sent anything, says so plainly", () => {
    expect(erpCard(CONTOSO, [], NOW, UTC)).toStrictEqual({
      foot: "Never filled by Demo Builder",
      inErp: "–",
      lastUpdate: "Nothing yet",
      waiting: "–",
    });
  });

  test("Then with one ERP every update from the ERP is its own", () => {
    const one = { ...NORTHWIND, counts: { products: 1 } };
    const fromIt = [{ direction: "from-erp", lastAt: "2026-09-28T14:00:00Z" }];
    expect(erpCard(one, fromIt, NOW, UTC, { onlyErp: true })).toMatchObject({
      inErp: "1 product",
      lastUpdate: "1 hour ago",
    });
  });
});

describe("Given today's Activity", () => {
  test("Then today's counts are worked out from the records of today", () => {
    const today = (extra) => ({ lastAt: "2026-09-28T10:00:00Z", ...extra });
    const counts = todayCounts(
      [
        today({ direction: "to-erp", kind: "order", outcome: "sent" }),
        today({ direction: "to-erp", kind: "order", outcome: "held" }),
        today({ direction: "from-erp", kind: "price", outcome: "applied" }),
        today({ direction: "from-erp", kind: "stock", outcome: "refused" }),
        today({ direction: "to-erp", kind: "shipped", outcome: "sent" }),
        today({ direction: "reset", kind: "reset", outcome: "done" }),
        {
          direction: "to-erp",
          kind: "order",
          lastAt: "2026-09-27T10:00:00Z",
          outcome: "sent",
        },
      ],
      NOW,
      UTC,
    );
    expect(counts).toStrictEqual({
      commerceSent: 1,
      erpApplied: 1,
      notThrough: 2,
      ordersSent: 1,
    });
  });
});
