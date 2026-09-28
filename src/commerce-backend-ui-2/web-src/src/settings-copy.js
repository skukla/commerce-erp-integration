/*
 * The words and shapes of the Settings tab (components/settings-tab.jsx), from the owner-approved
 * mockup (preview/mockups/settings.html): each setting's label, short help and the longer text
 * behind its ⓘ, the two lists' choices, which cards each view holds, and the read-only
 * Connection card. The controls' values are settings-view.js's.
 */

const PREFIX_LENGTH = 4;
const NOT_LETTERS = /[^A-Z0-9]/gu;

/** The first letters and digits of an ERP's name, as the integration derives a prefix. */
export function derivedPrefix(name) {
  return (
    String(name ?? "")
      .toUpperCase()
      .replace(NOT_LETTERS, "")
      .slice(0, PREFIX_LENGTH) || "ERP"
  );
}

/** Each setting's words; `erp` is the ERP shown, or null for every ERP. */
const TEXT = {
  orders_confirm_status: () => ({
    help: "Leave empty to add a note only.",
    label: "Order status when the ERP confirms",
    more: "A status to set on the Commerce order when the ERP confirms it. Create it at Stores › Settings › Order Status and assign it to the Pending state (not as its default). No status can move an order to Processing; Commerce does that itself when the order is invoiced or shipped.",
  }),
  orders_hold_offline: () => ({
    help: "Send them when it’s back, instead of dropping them.",
    label: "Hold orders while the ERP is offline",
    more: "An order placed while the ERP is offline is sent when the ERP is back (tried again for up to a day). When off, such an order is not sent.",
  }),
  orders_send: () => ({
    help: "Create each order in the ERP and bring its order number back.",
    label: "Send orders to the ERP",
    more: "Orders placed on this website are created in the ERP, and the ERP’s order number is written back. With several ERPs, an order is split: each ERP gets only the lines for the products it owns.",
  }),
  structure_order_prefix: (erp) => {
    const prefix = derivedPrefix(erp?.name);
    return {
      help: `Shown in Commerce as ${prefix}-0000001013.`,
      label: "Prefix on ERP order numbers",
      more: `Put in front of the ERP order number written onto Commerce orders, so two ERPs on one store tell their orders apart. One to six capital letters or digits. Empty: the first four letters of the ERP’s name (${prefix}).`,
      placeholder: `${prefix} (from the name)`,
    };
  },
  structure_owns: (erp) => ({
    help: "Which products this ERP sells and ships.",
    label: "Products this ERP owns",
    more: `All products: every product (one ERP only). Inventory sources: the products stocked in the sources named below. Attribute: the products whose attribute names this ERP.${erp ? ` When not set: products whose erp_owner is ${erp.id}.` : ""}`,
  }),
  structure_owns_attribute: (erp) => {
    const example = `erp_owner=${erp?.id ?? "ACME"}`;
    return {
      help: `An attribute and value, as ${example}.`,
      label: "Product attribute",
      more: "A product attribute and the value that names this ERP. Used with “Products whose attribute names this ERP”.",
      placeholder: example,
    };
  },
  structure_owns_sources: () => ({
    help: "Source codes, comma-separated.",
    label: "Inventory sources",
    more: "The inventory source codes this ERP ships from, as default, east. Used with “Products in these inventory sources”.",
  }),
  structure_sales_org: (erp) => ({
    help: "The ERP’s code for this website’s sales, e.g. 1000.",
    label: "Sales organization",
    more: `Four letters or digits, like an SAP sales organization. Orders from this website${erp ? " to this ERP" : ""} carry it.${erp ? "" : " An ERP that sets its own uses that instead."}`,
  }),
  structure_sales_org_name: (erp) => ({
    help: "What the ERP calls it. Empty: the website’s name.",
    label: "Sales organization name",
    more: `What ${erp ? "this ERP" : "the ERP"} calls that sales organization. When empty, the ERP prints the website’s name.`,
    placeholder: "The website’s name",
  }),
};

/**
 * @param {string} name a setting
 * @param {{ id: string, name: string }|null} erp the ERP shown, or null for every ERP
 * @returns {{ label: string, help: string, more: string, placeholder?: string }}
 */
export function settingText(name, erp) {
  return TEXT[name]?.(erp) ?? { help: "", label: name, more: "" };
}

/**
 * The confirm status's list: a note only, then each Pending status by its label and code. A
 * value set before that is not among them is kept, and says so. Null when Commerce's statuses
 * could not be read (the page then offers a text box).
 * @param {Array<{ value: string, label: string }>|null} statuses erp/settings `confirmStatuses`
 * @param {string} current the value shown
 */
export function confirmStatusOptions(statuses, current) {
  if (!Array.isArray(statuses)) {
    return null;
  }
  const options = [
    { label: "Empty (note only)", value: "" },
    ...statuses.map((s) => ({
      label: `${s.label} (${s.value})`,
      value: s.value,
    })),
  ];
  if (current && !statuses.some((s) => s.value === current)) {
    options.push({
      label: `${current} (not a Pending status)`,
      value: current,
    });
  }
  return options;
}

const OWNS = [
  { label: "All products", value: "all" },
  { label: "Products in these inventory sources", value: "sources" },
  { label: "Products whose attribute names this ERP", value: "attribute" },
];

/**
 * Which products an ERP owns: with several ERPs an ERP may leave it unset, which is its owner
 * attribute naming its id (router/ownership.js).
 * @param {{ id: string }|null} erp the ERP shown, or null for the one ERP of an install
 */
export function ownsOptions(erp) {
  return erp
    ? [{ label: `Not set: erp_owner is ${erp.id}`, value: "" }, ...OWNS]
    : OWNS;
}

/**
 * The cards a view holds, in order.
 * @param {{ several: boolean, erp: boolean, atDefault: boolean }} view several ERPs or one;
 *   one ERP picked or every ERP; Default Config or a website
 * @returns {string[]}
 */
export function cardsAt({ atDefault, erp, several }) {
  const products = atDefault ? "products" : "websiteNote";
  if (several && erp) {
    return ["salesOrg", "connection", products];
  }
  if (several) {
    return atDefault
      ? ["orders", "salesOrg", "erpList"]
      : ["orders", "salesOrg"];
  }
  return ["orders", "salesOrg", products, "connection"];
}

const KINDS = { "demo-erp": "Demo ERP" };
const SHOWN = 4;

/** "7c1e…42af" */
const shortId = (id) =>
  id.length > SHOWN * 2 ? `${id.slice(0, SHOWN)}…${id.slice(-SHOWN)}` : id;

/**
 * The read-only Connection card: set by Demo Builder, never the secret.
 * @param {object} entry the ERP's entry (erp/erps, its credential redacted)
 */
export function connectionFacts(entry) {
  const auth = entry.connection?.auth;
  const credential = auth
    ? `Its own · client id ${shortId(String(auth.clientId ?? ""))}${auth.hasSecret ? " · secret stored" : ""}`
    : "The integration’s own";
  return {
    address: entry.connection?.baseUrl ?? "–",
    credential,
    id: entry.id,
    kind: KINDS[entry.adapter] ?? entry.adapter,
    name: entry.name,
  };
}
