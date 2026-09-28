/*
 * The Settings tab's fields as its controls show them: what loaded, with this visit's edits on
 * top. At a website a value set wider is inherited ("Use Default Value" ticked); an ERP's own
 * settings show as its own, and what it does not set as the integration's ("Same as All ERPs").
 * With several ERPs, an ERP that does not say which products it owns shows "Not set": its owner
 * attribute decides, not the integration's setting.
 */
import { erpFields, integrationFields } from "#web/settings-fields.js";

const PAGE = {
  fields: [
    { default: true, label: "Send", name: "orders_send", type: "boolean" },
    { default: "1000", label: "Org", name: "structure_sales_org", type: "text" },
    { default: "all", label: "Owns", name: "structure_owns", type: "list" },
    {
      default: "",
      label: "Prefix",
      name: "structure_order_prefix",
      type: "text",
    },
  ],
  values: [
    {
      name: "orders_send",
      origin: { code: "global", level: "global" },
      value: true,
    },
    {
      name: "structure_sales_org",
      origin: { code: "bodea", level: "website" },
      value: "1100",
    },
    {
      name: "structure_owns",
      origin: { code: "global", level: "global" },
      value: "all",
    },
    {
      name: "structure_order_prefix",
      origin: { code: "global", level: "global" },
      value: "",
    },
  ],
};

describe("Given the integration's fields at a website", () => {
  test("Then a value set wider is inherited, one set here is the website's, and an edit decides", () => {
    const fields = integrationFields(PAGE, {}, "website");
    expect(fields.get("orders_send")).toMatchObject({
      inherited: true,
      value: true,
    });
    expect(fields.get("structure_sales_org")).toMatchObject({
      inherited: false,
      value: "1100",
    });
    const edited = integrationFields(
      PAGE,
      { orders_send: false, structure_sales_org: null },
      "website",
    );
    expect(edited.get("orders_send")).toMatchObject({
      inherited: false,
      value: false,
    });
    expect(edited.get("structure_sales_org")).toMatchObject({ inherited: true });
  });

  test("Then at Default Config nothing is inherited", () => {
    expect(
      integrationFields(PAGE, {}, "global").get("orders_send").inherited,
    ).toBe(false);
  });
});

describe("Given one ERP's fields among several", () => {
  const values = [
    { name: "structure_sales_org", own: false, value: "1000" },
    { name: "structure_owns", own: false, value: "all" },
    { name: "structure_order_prefix", own: true, value: "CON" },
  ];

  test("Then what it does not set is the integration's, and shows as Same as All ERPs", () => {
    expect(erpFields(PAGE, values, {}).get("structure_sales_org")).toMatchObject(
      { inherited: true, value: "1000" },
    );
    expect(
      erpFields(PAGE, values, {}).get("structure_order_prefix"),
    ).toMatchObject({ inherited: false, value: "CON" });
  });

  test("Then ownership it does not set shows Not set, not the integration's", () => {
    expect(erpFields(PAGE, values, {}).get("structure_owns")).toMatchObject({
      inherited: false,
      value: "",
    });
    expect(
      erpFields(PAGE, values, { structure_owns: "sources" }).get(
        "structure_owns",
      ).value,
    ).toBe("sources");
    expect(
      erpFields(PAGE, values, { structure_owns: null }).get("structure_owns")
        .value,
    ).toBe("");
  });
});
