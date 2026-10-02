/*
 * What the redesigned Settings tab shows beside each control (the owner-approved mockup's words):
 * a label, a short help line, the longer text behind the ⓘ, the choices of the two lists, the
 * cards each view holds, and the read-only Connection card.
 */
import appConfig from "#app.commerce.config";
import {
  cardsAt,
  confirmStatusOptions,
  connectionFacts,
  derivedPrefix,
  ownsOptions,
  settingText,
} from "#web/settings-copy.js";
import { erpValues } from "#web/settings-view.js";

const NON_BLANK = /\S/u;

describe("Given each setting's words", () => {
  test("Then every setting the app declares has a label, a help line and more to read", () => {
    for (const { name } of appConfig.businessConfig.schema) {
      const text = settingText(name, null);
      expect(text.label, name).toMatch(NON_BLANK);
      expect(text.help, name).toMatch(NON_BLANK);
      expect(text.more, name).toMatch(NON_BLANK);
    }
  });

  test("Then an ERP's own words name it: its prefix and its owner attribute", () => {
    const erp = { id: "northwind", name: "Northwind ERP" };
    expect(settingText("structure_order_prefix", erp)).toMatchObject({
      help: "Shown in Commerce as NORT-0000001013.",
      placeholder: "NORT (from the name)",
    });
    expect(settingText("structure_owns_attribute", erp)).toMatchObject({
      help: "An attribute and value, as erp_owner=northwind.",
      placeholder: "erp_owner=northwind",
    });
    expect(derivedPrefix("Contoso ERP")).toBe("CONT");
    expect(derivedPrefix("")).toBe("ERP");
  });
});

describe("Given the confirm status's choices", () => {
  const PENDING = [
    { label: "Awaiting ERP review", value: "erp_review" },
    { label: "Confirmed in ERP", value: "erp_confirmed" },
  ];

  test("Then the list is a note only, then each Pending status by its label and code", () => {
    expect(confirmStatusOptions(PENDING, "")).toStrictEqual([
      { label: "Empty (note only)", value: "" },
      { label: "Awaiting ERP review (erp_review)", value: "erp_review" },
      { label: "Confirmed in ERP (erp_confirmed)", value: "erp_confirmed" },
    ]);
  });

  test("Then a value set before that is not a Pending status is kept, and says so", () => {
    expect(confirmStatusOptions(PENDING, "processing").at(-1)).toStrictEqual({
      label: "processing (not a Pending status)",
      value: "processing",
    });
  });

  test("Then with no statuses read there is no list, and the page offers a text box", () => {
    expect(confirmStatusOptions(null, "")).toBeNull();
  });
});

describe("Given which products an ERP owns", () => {
  test("Then with several ERPs an ERP can leave it unset, which is its owner attribute", () => {
    expect(ownsOptions({ id: "contoso", name: "Contoso ERP" })).toStrictEqual([
      { label: "Not set: erp_owner is contoso", value: "" },
      { label: "All products", value: "all" },
      { label: "Products in these inventory sources", value: "sources" },
      { label: "Products whose attribute names this ERP", value: "attribute" },
    ]);
    expect(ownsOptions(null).map((o) => o.value)).toStrictEqual([
      "all",
      "sources",
      "attribute",
    ]);
  });
});

describe("Given the schedule settings' words (AB-38)", () => {
  test("Then the price publish says what it does in plain words", () => {
    expect(settingText("schedule_prices_enabled", null).label).toBe(
      "Publish ERP prices into the shared catalogs",
    );
    expect(settingText("schedule_timezone", null).label).toBe("Store timezone");
  });
});

// The schedules are the whole integration's (the heartbeat reads Default Config), so their
// card is shown at Default Config with every ERP, never at a website or for one ERP.
describe("Given the cards a view holds", () => {
  test.each([
    [
      { atDefault: true, erp: false, several: true },
      ["orders", "salesOrg", "schedules", "erpList"],
    ],
    [{ atDefault: false, erp: false, several: true }, ["orders", "salesOrg"]],
    [
      { atDefault: true, erp: true, several: true },
      ["salesOrg", "connection", "products"],
    ],
    [
      { atDefault: false, erp: true, several: true },
      ["salesOrg", "connection", "websiteNote"],
    ],
    [
      { atDefault: true, erp: false, several: false },
      ["orders", "salesOrg", "products", "connection", "schedules"],
    ],
    [
      { atDefault: false, erp: false, several: false },
      ["orders", "salesOrg", "websiteNote", "connection"],
    ],
  ])("Then %o holds %j", (view, cards) => {
    expect(cardsAt(view)).toStrictEqual(cards);
  });
});

describe("Given an ERP's connection", () => {
  test("Then it reads as its name, id, kind, address and credential, never the secret", () => {
    expect(
      connectionFacts({
        adapter: "demo-erp",
        connection: { baseUrl: "https://northwind.example" },
        id: "northwind",
        name: "Northwind ERP",
      }),
    ).toStrictEqual({
      address: "https://northwind.example",
      credential: "The integration’s own",
      id: "northwind",
      kind: "Demo ERP",
      name: "Northwind ERP",
    });
    expect(
      connectionFacts({
        adapter: "demo-erp",
        connection: {
          auth: {
            clientId: "7c1e0000000000000000000042af",
            hasSecret: true,
            orgId: "O@AdobeOrg",
          },
          baseUrl: "https://contoso.example",
        },
        id: "contoso",
        name: "Contoso ERP",
      }).credential,
    ).toBe("Its own · client id 7c1e…42af · secret stored");
  });
});

describe("Given an ERP's value at a website it does not set", () => {
  test("Then it is the ERP's own default, before the integration's", () => {
    const entry = {
      id: "contoso",
      settings: { structure_sales_org: "2000", websites: {} },
    };
    const values = erpValues(entry, "bodea", [
      { name: "structure_sales_org", value: "1000" },
    ]);
    expect(values.find((v) => v.name === "structure_sales_org")).toStrictEqual({
      name: "structure_sales_org",
      own: false,
      value: "2000",
    });
  });
});
