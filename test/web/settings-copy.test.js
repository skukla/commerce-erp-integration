/*
 * What the redesigned Settings tab shows beside each control (the owner-approved mockup's words):
 * a label, a short help line, the longer text behind the ⓘ, the choices of the two lists, the
 * cards each view holds, and the read-only Connection card.
 */
import appConfig from "#app.commerce.config";
import {
  confirmStatusOptions,
  connectionFacts,
  derivedPrefix,
  groupsAt,
  ownsOptions,
  settingText,
  systemValueOf,
} from "#web/settings-copy.js";
import { erpValues } from "#web/settings-view.js";

const NON_BLANK = /\S/u;

/** What "All products" means with several ERPs (owner, 2026-10-09): the catch-all. */
/** Where one sentence ends and the next begins. */
const SENTENCE_END = /[.;] /u;
const CATCH_ALL_WORDS =
  /^All products: every product no other ERP claims by attribute \(the catch-all/u;
/** Words of the one-ERP-only reading and the deleted sources mode. */
const DELETED_WORDS = /one ERP only|Inventory sources|or source/u;

describe("Given each setting's words", () => {
  // A help line or ⓘ text only where it adds to the label and control (owner, 2026-10-13).
  const LABEL_ONLY = ["schedule_prices_minute", "schedule_prices_weekday"];

  test("Then every setting the app declares has a label, and words beside it unless the label says it all", () => {
    for (const { name } of appConfig.businessConfig.schema) {
      const text = settingText(name, null);
      expect(text.label, name).toMatch(NON_BLANK);
      if (!LABEL_ONLY.includes(name)) {
        expect(`${text.help}${text.more}`, name).toMatch(NON_BLANK);
      }
    }
  });

  test("Then the ⓘ text is one sentence or two, never a paragraph", () => {
    for (const { name } of appConfig.businessConfig.schema) {
      const sentences = settingText(name, null).more.split(SENTENCE_END).length;
      expect(sentences, name).toBeLessThanOrEqual(2);
    }
  });

  test("Then an ERP's own words name it: its prefix and its owner attribute", () => {
    const erp = { id: "northwind", name: "Northwind ERP" };
    expect(settingText("structure_order_prefix", erp)).toMatchObject({
      help: "Shown in Commerce as NORT-0000001013.",
      placeholder: "NORT",
    });
    expect(settingText("structure_owns_attribute", erp)).toMatchObject({
      help: "An attribute and value, as erp_owner=northwind.",
      placeholder: "erp_owner=northwind",
    });
    expect(derivedPrefix("Contoso ERP")).toBe("CONT");
    expect(derivedPrefix("")).toBe("ERP");
  });

  test("Then the ownership choices say what All products means with several ERPs: the catch-all (owner, 2026-10-09)", () => {
    const erp = { id: "justrite", name: "Justrite ERP" };
    const { more } = settingText("structure_owns", erp);
    expect(more).toMatch(CATCH_ALL_WORDS);
    expect(more).not.toMatch(DELETED_WORDS);
    expect(more).toContain("Default: products whose attribute names justrite.");
  });
});

describe("Given the confirm status's choices", () => {
  const PENDING = [
    { label: "Awaiting ERP review", value: "erp_review" },
    { label: "Confirmed in ERP", value: "erp_confirmed" },
  ];

  test("Then the list is none (a note only), then each Pending status by its label and code", () => {
    expect(confirmStatusOptions(PENDING, "")).toStrictEqual([
      { label: "None", value: "" },
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
      { label: "Default (by product attribute)", value: "" },
      { label: "All products", value: "all" },
      { label: "Products whose attribute names this ERP", value: "attribute" },
      { label: "Products sold on these websites", value: "websites" },
    ]);
    expect(ownsOptions(null).map((o) => o.value)).toStrictEqual([
      "all",
      "attribute",
      "websites",
    ]);
    // Not "Websites", which beside the Scope picker read as a second scope.
    expect(settingText("structure_owns_websites", null)).toMatchObject({
      label: "Websites whose products this ERP owns",
    });
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

// The integration's groups, which every ERP shares; each ERP's own settings follow under its
// name (settings-view.js erpGroupNames). The schedules are read at Default Config only.
describe("Given the integration's groups a view holds", () => {
  test.each([
    [{ atDefault: true }, ["orders", "salesOrg", "schedules"]],
    [{ atDefault: false }, ["orders", "salesOrg"]],
  ])("Then %o holds %j", (view, groups) => {
    expect(groupsAt(view)).toStrictEqual(groups);
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
      // Commas, not middle dots (owner, 2026-10-14).
    ).toBe("Its own, client id 7c1e…42af, secret stored");
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

describe("Given a setting whose blank stands for a worked-out value", () => {
  test("Then the page shows that value: the ERP's prefix, the website's name, else none", () => {
    const context = {
      erp: { name: "Northwind ERP" },
      websiteName: "Bodea Website",
    };
    expect(systemValueOf("structure_order_prefix", context)).toBe("NORT");
    expect(systemValueOf("structure_sales_org_name", context)).toBe(
      "Bodea Website",
    );
    expect(
      systemValueOf("structure_sales_org_name", { erp: null }),
    ).toBeUndefined();
    expect(systemValueOf("orders_send", context)).toBeUndefined();
  });
});
