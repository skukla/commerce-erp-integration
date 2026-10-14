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

/**
 * Each setting's words; `erp` is the ERP shown, or null for every ERP. `help` is left out where
 * the label and control already say it, and `more` (behind ⓘ) holds only what cannot be
 * guessed, in a sentence (owner, 2026-10-13).
 */
const TEXT = {
  orders_confirm_status: () => ({
    help: "None adds a note only.",
    label: "Order status when the ERP confirms",
    more: "Create the status at Stores › Settings › Order Status and assign it to the Pending state; Commerce itself moves an order to Processing when it is invoiced or shipped.",
  }),
  orders_hold_offline: () => ({
    help: "Send them when it’s back, instead of dropping them.",
    label: "Hold orders while the ERP is offline",
    more: "A held order is tried again for up to a day.",
  }),
  orders_send: () => ({
    help: "Create each order in the ERP and bring its order number back.",
    label: "Send orders to the ERP",
    more: "With several ERPs, each ERP gets only the lines for the products it owns.",
  }),
  schedule_prices_enabled: () => ({
    help: "Each ERP’s prices in force, copied into Commerce.",
    label: "Publish ERP prices into the shared catalogs",
    more: "This run is what makes a price with a start or end date take effect.",
  }),
  schedule_prices_frequency: () => ({
    help: "",
    label: "How often",
    more: "All times are in the store timezone.",
  }),
  schedule_prices_minute: () => ({
    help: "",
    label: "Minute past the hour",
    more: "",
  }),
  schedule_prices_time: () => ({
    help: "24-hour time, e.g. 02:00.",
    label: "Time of day",
    more: "It runs within five minutes of this time.",
    placeholder: "02:00",
  }),
  schedule_prices_weekday: () => ({
    help: "",
    label: "Day of the week",
    more: "",
  }),
  schedule_timezone: () => ({
    help: "The schedules’ clock, e.g. America/Chicago.",
    label: "Store timezone",
    more: "An IANA name, such as America/Chicago, Europe/Berlin or UTC.",
    placeholder: "UTC",
  }),
  structure_order_prefix: (erp) => {
    const prefix = derivedPrefix(erp?.name);
    return {
      help: `Shown in Commerce as ${prefix}-0000001013.`,
      label: "Prefix on ERP order numbers",
      more: `One to six capital letters or digits; empty uses the first four letters of the ERP’s name (${prefix}).`,
      placeholder: prefix,
    };
  },
  structure_owns: (erp) => ({
    help: "",
    label: "Products this ERP owns",
    more: `All products: every product no other ERP claims by attribute (the catch-all). Websites: orders from those websites, except lines another ERP owns.${erp ? ` Default: products whose attribute names ${erp.id}.` : ""}`,
  }),
  structure_owns_attribute: (erp) => {
    const example = `erp_owner=${erp?.id ?? "ACME"}`;
    return {
      help: `An attribute and value, as ${example}.`,
      label: "Product attribute",
      more: "",
      placeholder: example,
    };
  },
  structure_owns_websites: () => ({
    help: "Website codes, comma-separated.",
    label: "Websites",
    more: "",
  }),
  structure_sales_org: (erp) => ({
    help: "The ERP’s code for this website’s sales, e.g. 1000.",
    label: "Sales organization",
    more: `Four letters or digits, like an SAP sales organization.${erp ? "" : " An ERP that sets its own uses that instead."}`,
  }),
  structure_sales_org_name: () => ({
    help: "What the ERP calls it. Empty: the website’s name.",
    label: "Sales organization name",
    more: "",
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
    { label: "None", value: "" },
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
  { label: "Products whose attribute names this ERP", value: "attribute" },
  { label: "Products sold on these websites", value: "websites" },
];

/**
 * Which products an ERP owns: with several ERPs an ERP may leave it unset, which is its owner
 * attribute naming its id (router/ownership.js).
 * @param {{ id: string }|null} erp the ERP shown, or null for the one ERP of an install
 */
export function ownsOptions(erp) {
  return erp
    ? [{ label: "Default (by product attribute)", value: "" }, ...OWNS]
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
      ? ["orders", "salesOrg", "schedules", "erpList"]
      : ["orders", "salesOrg"];
  }
  // The schedules are the whole integration's: set at Default Config only.
  const schedules = atDefault ? ["schedules"] : [];
  return ["orders", "salesOrg", products, "connection", ...schedules];
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
