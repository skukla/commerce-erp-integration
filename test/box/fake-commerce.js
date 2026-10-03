/*
 * A Commerce store in memory, answering the calls this integration makes and recording
 * every write. Shapes follow the 2.4.9 REST definitions read for the composite-entity
 * research (2026-09-24): orders (sales-data-order-interface), shipments, companies,
 * company credits, source items. They are typed here from that read, NOT captured from a
 * live store; the API-inventory item (AB-26b) replaces them with live captures once a
 * credential exists, and any field a live capture contradicts is fixed here.
 */
// biome-ignore-all lint/suspicious/useAwait: a fake Commerce answers promises without waiting on anything; the real clients are async and callers await them

export const COMPANY_STATUS = {
  APPROVED: 1,
  BLOCKED: 3,
  PENDING: 0,
  REJECTED: 2,
};

import { createFakeBalance } from "./fake-commerce-balance.js";
import {
  createFakeReturns,
  INVOICED_LATER_AT,
} from "./fake-commerce-returns.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

function seed() {
  return {
    companies: new Map([
      [
        7,
        {
          company_email: "buyer@northwind.example",
          company_name: "Northwind Trading",
          customer_group_id: 2,
          id: 7,
          status: COMPANY_STATUS.APPROVED,
        },
      ],
    ]),
    creditMemos: [],
    credits: new Map([
      [
        7,
        {
          balance: 0,
          company_id: 7,
          credit_limit: 1000,
          currency_code: "USD",
          id: 42,
        },
      ],
    ]),
    // Company 7's own custom shared catalog, whose customer group Commerce names by code.
    customerGroups: new Map([[2, "Northwind Trading"]]),
    // The order's buyer: a user of company 7, as a real B2B order has (the ERP now knows
    // the buyer only through the integration's key map, never by email or group).
    customers: new Map([[3, { company_id: 7, id: 3 }]]),
    invoices: [],
    nextId: 900,
    orders: new Map([
      [
        55,
        {
          base_currency_code: "USD",
          base_grand_total: 140,
          created_at: "2026-09-24 10:00:00",
          customer_email: "buyer@northwind.example",
          customer_group_id: 2,
          customer_id: 3,
          entity_id: 55,
          ext_order_id: null,
          increment_id: "000000042",
          items: [
            {
              base_price: 10,
              item_id: 1,
              product_id: 101,
              qty_ordered: 12,
              sku: "A1",
            },
            {
              base_price: 5,
              item_id: 2,
              product_id: 102,
              qty_ordered: 4,
              sku: "B2",
            },
          ],
          state: "new",
          status: "pending",
          store_id: 1,
          updated_at: "2026-09-24 10:00:00",
        },
      ],
    ]),
    products: new Map([
      [
        "A1",
        { id: 101, name: "Trouser", price: 10, sku: "A1", type_id: "simple" },
      ],
      [
        "B2",
        { id: 102, name: "Shirt", price: 5, sku: "B2", type_id: "simple" },
      ],
    ]),
    returns: new Map(),
    sharedCatalogs: [{ customer_group_id: 2, id: 5, type: 0 }],
    shipments: [],
    sourceItems: new Map([
      ["A1|default", 50],
      ["A1|east", 20],
      ["B2|default", 9],
    ]),
    sources: new Map([
      ["default", "Default Source"],
      ["east", "East DC"],
    ]),
    // Tier prices by SKU|group code|quantity|website. The SC had already priced B2 in
    // Northwind's catalog before the ERP did, so a revert has a price to put back.
    tierPrices: new Map([
      [
        "B2|Northwind Trading|1|0",
        {
          customer_group: "Northwind Trading",
          price: 4.5,
          price_type: "fixed",
          quantity: 1,
          sku: "B2",
          website_id: 0,
        },
      ],
    ]),
  };
}

/**
 * Commerce's Order::canCancel(), for the states and quantities this fake keeps (Magento
 * 2.4-develop Sales/Model/Order.php): not cancelled, on hold, in payment review, complete or
 * closed, and some line still has a quantity to invoice.
 */
function canCancel(o) {
  if (
    ["canceled", "holded", "payment_review", "complete", "closed"].includes(
      o.state,
    )
  ) {
    return false;
  }
  return o.items.some(
    (i) =>
      Number(i.qty_ordered) -
        Number(i.qty_invoiced ?? 0) -
        Number(i.qty_canceled ?? 0) >
      0,
  );
}

/** What of a line is still to invoice: Commerce's OrderItem::getQtyToInvoice for a simple line. */
const qtyToInvoice = (i) =>
  Number(i.qty_ordered) -
  Number(i.qty_invoiced ?? 0) -
  Number(i.qty_canceled ?? 0);

/** Commerce's refusal of a REST call: the client throws, the way ky's HTTPError carries it. */
function refusal400(message) {
  const error = new Error(
    `Request failed with status code 400 Bad Request: ${message}`,
  );
  error.response = { status: 400, statusCode: 400 };
  return error;
}

/**
 * Why Commerce refuses POST order/{id}/invoice, or null when it invoices: its InvoiceOrder
 * service runs the CanInvoice validator (an order in payment review, on hold, canceled,
 * complete or closed, or with nothing left to invoice, refuses) and the invoice quantity
 * validator (a line asked for more than it has left). The rule is Magento 2.4's
 * (Sales/Model/Order/Validation/CanInvoice.php, InvoiceQuantityValidator.php); the words are
 * as read from that source, NOT captured from a live store.
 * @param {object} o the order
 * @param {Array<{order_item_id: number, qty: number}>} [items] the lines asked; none = all
 */
function invoiceRefusal(o, items) {
  if (
    ["payment_review", "holded", "canceled", "complete", "closed"].includes(
      o.state,
    )
  ) {
    return refusal400(
      `Invoice Document Validation Error(s):\nAn invoice cannot be created when an order has a status of ${o.status}`,
    );
  }
  if (!o.items.some((i) => qtyToInvoice(i) > 0)) {
    return refusal400(
      "Invoice Document Validation Error(s):\nThe order does not allow an invoice to be created.",
    );
  }
  const over = (items ?? []).find((asked) => {
    const line = o.items.find((i) => i.item_id === Number(asked.order_item_id));
    return line && Number(asked.qty) > qtyToInvoice(line);
  });
  if (over) {
    const line = o.items.find((i) => i.item_id === Number(over.order_item_id));
    return refusal400(
      `Invoice Document Validation Error(s):\nThe quantity to invoice must not be greater than the uninvoiced quantity for product SKU "${line.sku}".`,
    );
  }
  return null;
}

/**
 * The state Commerce gives an order after a shipment or an invoice: Complete once every line
 * is both invoiced and shipped in full, Processing until then.
 */
function fulfilmentState(o) {
  const done = o.items.every(
    (i) =>
      Number(i.qty_invoiced ?? 0) >= Number(i.qty_ordered) &&
      Number(i.qty_shipped ?? 0) >= Number(i.qty_ordered),
  );
  return done ? "complete" : "processing";
}

const tierKey = (r) =>
  `${r.sku}|${r.customer_group}|${Number(r.quantity)}|${Number(r.website_id)}`;

/** @returns {object} the fake store with `lib` (for #lib/commerce), the kit clients, event builders and `writes` */
export function createFakeCommerce() {
  let db = seed();
  const writes = [];
  const record = (kind, detail) => writes.push({ kind, ...detail });
  // The order save events Commerce raised for the writes below, oldest first: the box delivers
  // them to the order handlers the way I/O Events would.
  const orderSaves = [];
  const raiseOrderSave = (value) =>
    orderSaves.push({
      data: { value: { ...clone(value), _isNew: false } },
      type: "observer.sales_order_save_commit_after",
    });
  const order = (id) => {
    const o = db.orders.get(Number(id));
    if (!o) {
      const error = new Error(`order ${id} not found`);
      error.response = { statusCode: 404 };
      throw error;
    }
    return o;
  };

  const lib = {
    COMPANY_STATUS,
    clearExtOrderId: async (_p, orderId) => {
      order(orderId).ext_order_id = "";
      record("clearExtOrderId", { orderId: String(orderId) });
      // A sparse save: its event carries only the field written (measured 2026-09-25).
      raiseOrderSave({ ext_order_id: "" });
      return {};
    },
    customerCompanyId: async (_p, customerId) => {
      const companyId = db.customers.get(Number(customerId))?.company_id;
      return companyId === undefined ? null : String(companyId);
    },
    findOrderByIncrementId: async (_p, incrementId) => {
      const o = [...db.orders.values()].find(
        (x) => x.increment_id === String(incrementId),
      );
      return o
        ? {
            entityId: o.entity_id,
            extOrderId: o.ext_order_id || null,
            payment: clone(o.payment ?? null),
            storeId: o.store_id,
          }
        : null;
    },
    getCompany: async (_p, companyId) =>
      clone(db.companies.get(Number(companyId))),
    getCompanyCredit: async (_p, companyId) =>
      clone(db.credits.get(Number(companyId))),
    getOrderByIncrementId: async (_p, incrementId) =>
      clone(
        [...db.orders.values()].find(
          (x) => x.increment_id === String(incrementId),
        ) ?? null,
      ),
    listCompanies: async () =>
      [...db.companies.values()].map((c) => ({
        blocked: c.status === COMPANY_STATUS.BLOCKED,
        creditId: db.credits.get(c.id)?.id ?? null,
        creditLimit: db.credits.get(c.id)?.credit_limit ?? null,
        customerGroupId: c.customer_group_id,
        email: c.company_email,
        id: c.id,
        name: c.company_name,
        status: c.status,
      })),
    listProducts: async () =>
      [...db.products.values()].map((p) => ({
        id: p.id,
        listPrice: p.price,
        name: p.name,
        sku: p.sku,
        typeId: p.type_id,
      })),
    listSources: async () => new Map(db.sources),
    listStock: async () => {
      const bySku = new Map();
      for (const [key, quantity] of db.sourceItems) {
        const [sku, code] = key.split("|");
        const rows = bySku.get(sku) ?? [];
        rows.push({ code, quantity });
        bySku.set(sku, rows);
      }
      return bySku;
    },
    listVariantAttributes: async () => new Map(),
    listWebsites: async () => [{ code: "base", id: 1, name: "Main Website" }],
    orders: {
      // As POST orders/{id}/cancel answers (Magento OrderService::cancelOrder): false, and
      // nothing saved, when Order::canCancel() refuses.
      cancel: async (_p, orderId) => {
        const o = order(orderId);
        if (!canCancel(o)) {
          return false;
        }
        o.state = "canceled";
        o.status = "canceled";
        record("cancel", { orderId: String(orderId) });
        raiseOrderSave(o);
        return true;
      },
      comment: async (_p, orderId, comment, status) => {
        record("comment", { comment, orderId: String(orderId), status });
        const o = order(orderId);
        // Newest first, as GET orders/{id} answers status_histories.
        o.status_histories = [
          { comment, status },
          ...(o.status_histories ?? []),
        ];
        if (status) {
          o.status = status;
        }
        return {};
      },
      get: async (_p, orderId) => clone(order(orderId)),
    },
    productAttributes: async (_p, sku) =>
      clone(db.products.get(sku)?.custom_attributes ?? {}),
    productAttributesOfSkus: async (_p, skus) =>
      new Map(
        skus
          .filter((sku) => db.products.has(sku))
          .map((sku) => [
            sku,
            clone(db.products.get(sku).custom_attributes ?? {}),
          ]),
      ),
    setCompanyCreditLimit: async (_p, creditId, companyId, creditLimit) => {
      db.credits.get(Number(companyId)).credit_limit = creditLimit;
      record("setCompanyCreditLimit", {
        companyId: String(companyId),
        creditId,
        creditLimit,
      });
      return {};
    },
    setCompanyStatus: async (_p, companyId, status) => {
      db.companies.get(Number(companyId)).status = status;
      record("setCompanyStatus", { companyId: String(companyId), status });
      return {};
    },
    setExtOrderId: async (_p, orderId, value) => {
      order(orderId).ext_order_id = value;
      record("setExtOrderId", { orderId: String(orderId), value });
      return {};
    },
    setProductName: async (_p, sku, name) => {
      db.products.get(sku).name = name;
      record("setProductName", { name, sku });
    },
    setProductPrice: async (_p, sku, price) => {
      db.products.get(sku).price = price;
      record("setProductPrice", { price, sku });
    },
    setStock: async (_p, sku, quantity, sourceCode = "default") => {
      db.sourceItems.set(`${sku}|${sourceCode}`, quantity);
      record("setStock", { quantity, sku, sourceCode });
    },
    skuForProductId: async (_p, productId) =>
      [...db.products.values()].find((p) => p.id === Number(productId))?.sku ??
      null,
    sourceCodesOf: async (_p, sku) =>
      [...db.sourceItems.keys()]
        .filter((key) => key.startsWith(`${sku}|`))
        .map((key) => key.split("|")[1]),
    sourceCodesOfSkus: async (_p, skus) => {
      const found = new Map();
      for (const key of db.sourceItems.keys()) {
        const [sku, code] = key.split("|");
        if (skus.includes(sku)) {
          found.set(sku, [...(found.get(sku) ?? []), code]);
        }
      }
      return found;
    },
    storeConfigs: async () =>
      new Map([[1, { currency: "USD", locale: "en_US" }]]),
    unholdIfHeld: async (_p, orderId) => {
      const o = order(orderId);
      if (o.state !== "holded") {
        return false;
      }
      o.state = "processing";
      o.status = "processing";
      record("unhold", { orderId: String(orderId) });
      raiseOrderSave(o);
      return true;
    },
    warehousesOfSku: async (_p, sku) =>
      [...db.sourceItems]
        .filter(([key]) => key.startsWith(`${sku}|`))
        .map(([key, quantity]) => {
          const [, code] = key.split("|");
          return { code, name: db.sources.get(code) || code, quantity };
        }),
    // The store's one view (store 1) is on the one website listWebsites answers; store view 2
    // is on a second website, eu, that a journey moves an order to (AB-64).
    websiteCodeOfStore: async (_p, storeId) =>
      ({ 1: "base", 2: "eu" })[Number(storeId)],
    // The websites a product is sold on: every seeded product is on base unless a journey
    // says otherwise (`websites` on the product).
    websiteCodesOf: async (_p, sku) =>
      clone(db.products.get(sku)?.websites ?? ["base"]),
    websiteCodesOfSkus: async (_p, skus) =>
      new Map(
        skus
          .filter((sku) => db.products.has(sku))
          .map((sku) => [
            sku,
            clone(db.products.get(sku).websites ?? ["base"]),
          ]),
      ),
  };

  /** The shared catalog and tier-price calls (the shape #lib/commerce-tier-prices answers). */
  const tierPrices = {
    ALL_WEBSITES: 0,
    deleteTierPrices: async (_p, prices) => {
      for (const r of prices) {
        db.tierPrices.delete(tierKey(r));
      }
      record("deleteTierPrices", { prices: clone(prices) });
    },
    revertTierPrice: async (p, entry) => {
      const row = (v) => ({
        customer_group: entry.customerGroup,
        price: v.price,
        price_type: v.priceType,
        quantity: entry.quantity,
        sku: entry.id,
        website_id: entry.websiteId,
      });
      return entry.before
        ? tierPrices.writeTierPrices(p, [row(entry.before)])
        : tierPrices.deleteTierPrices(p, [row(entry.after)]);
    },
    sharedCatalogGroupOf: async (_p, companyId) => {
      const groupId = db.companies.get(Number(companyId))?.customer_group_id;
      const custom = db.sharedCatalogs.find(
        (c) => c.customer_group_id === groupId && c.type === 0,
      );
      return custom
        ? {
            customerGroup: db.customerGroups.get(groupId),
            customerGroupId: groupId,
            sharedCatalogId: custom.id,
          }
        : { skip: `company ${companyId} has no custom shared catalog` };
    },
    tierPricesOf: async (_p, skus) =>
      clone([...db.tierPrices.values()].filter((r) => skus.includes(r.sku))),
    writeTierPrices: async (_p, prices) => {
      for (const r of prices) {
        db.tierPrices.set(tierKey(r), clone(r));
      }
      record("writeTierPrices", { prices: clone(prices) });
    },
  };

  // Returns and credit memos (fake-commerce-returns.js), over this store's database.
  const returns = createFakeReturns({
    db: () => db,
    fulfilmentState,
    invoiceRefusal,
    order,
    record,
  });
  // A company's credit balance, moved by the payment leg (fake-commerce-balance.js).
  const balance = createFakeBalance({ db: () => db, record });

  const orderClient = {
    ...returns.client,
    addComment: async (_p, orderId, data) => {
      record("comment", {
        comment: data.statusHistory?.comment,
        orderId: String(orderId),
        status: data.statusHistory?.status,
      });
      const status = data.statusHistory?.status;
      if (status) {
        // As Commerce does (measured 2026-09-25): a comment may set only a status of the
        // order's current state, and `processing` is not one of state `new`.
        const o = order(orderId);
        if (status === "processing" && o.state === "new") {
          const refused = new Error(
            'Request failed with status code 400 Bad Request: The status "processing" is not part of the order status history.',
          );
          refused.response = { statusCode: 400 };
          throw refused;
        }
        o.status = status;
      }
      return {};
    },
    cancelOrder: async (_p, orderId) => lib.orders.cancel(_p, orderId),
    getInvoice: async (_p, invoiceId) => {
      const invoice = db.invoices.find(
        (i) => i.entity_id === Number(invoiceId),
      );
      if (!invoice) {
        const error = new Error(`invoice ${invoiceId} not found`);
        error.response = { statusCode: 404 };
        throw error;
      }
      return clone(invoice);
    },
    getOrder: async (_p, orderId) => clone(order(orderId)),
    holdOrder: async (_p, orderId) => {
      const o = order(orderId);
      if (o.state === "holded") {
        throw new Error("order is already on hold");
      }
      o.hold_before_state = o.state;
      o.state = "holded";
      o.status = "holded";
      record("hold", { orderId: String(orderId) });
      return true;
    },
    invoiceOrder: async (_p, orderId) => {
      const o = order(orderId);
      const refusal = invoiceRefusal(o);
      if (refusal) {
        throw refusal;
      }
      const id = billRemainder(o);
      o.state = "complete";
      record("invoice", { invoiceId: id, orderId: String(orderId) });
      return id;
    },
    /** GET invoices filtered on the order (Commerce's invoice list: `{ items, total_count }`). */
    listOrderInvoices: async (_p, orderId) =>
      clone(db.invoices.filter((i) => i.order_id === Number(orderId))),
    unholdOrder: async (_p, orderId) => {
      const o = order(orderId);
      if (o.state !== "holded") {
        throw new Error("order is not on hold");
      }
      o.state = o.hold_before_state || "processing";
      o.status = o.state;
      record("unhold", { orderId: String(orderId) });
      return true;
    },
  };

  /**
   * Invoice what every line has left, the way a whole-order invoice does: Commerce's own
   * invoice lists the lines it bills (GET invoices/{id}).
   */
  function billRemainder(o, createdAt = INVOICED_LATER_AT) {
    const id = db.nextId;
    db.nextId += 1;
    const billed = o.items
      .map((i) => ({ order_item_id: i.item_id, qty: qtyToInvoice(i) }))
      .filter((i) => i.qty > 0);
    db.invoices.push({
      created_at: createdAt,
      entity_id: id,
      increment_id: String(id),
      items: billed,
      order_id: o.entity_id,
      state: 2,
    });
    for (const line of billed) {
      const item = o.items.find((i) => i.item_id === line.order_item_id);
      item.qty_invoiced = Number(item.qty_invoiced ?? 0) + line.qty;
    }
    return id;
  }

  const shipmentClient = {
    createShipment: async (_p, orderId, data) => {
      const o = order(orderId);
      const id = db.nextId;
      db.nextId += 1;
      // Real Commerce reads the MSI source from arguments.extension_attributes.source_code,
      // NOT a top-level extension_attributes. The fake reads the same place so the box proves
      // the shape real Commerce accepts.
      const sourceCode = data.arguments?.extension_attributes?.source_code;
      db.shipments.push({
        entity_id: id,
        extension_attributes: { source_code: sourceCode },
        increment_id: String(id),
        items: data.items.map((i) => ({
          order_item_id: i.order_item_id,
          qty: i.qty,
        })),
        order_id: o.entity_id,
      });
      for (const i of data.items) {
        const line = o.items.find((x) => x.item_id === i.order_item_id);
        const key = `${line?.sku}|${sourceCode ?? "default"}`;
        db.sourceItems.set(key, (db.sourceItems.get(key) ?? 0) - i.qty);
        if (line) {
          line.qty_shipped = Number(line.qty_shipped ?? 0) + i.qty;
        }
      }
      o.state = fulfilmentState(o);
      record("ship", {
        orderId: String(orderId),
        shipmentId: id,
        sourceCode,
      });
      return id;
    },
    updateShipment: async () => ({}),
  };

  const stockClient = {
    updateStock: async (_p, data) => {
      for (const item of data.sourceItems) {
        db.sourceItems.set(`${item.sku}|${item.source_code}`, item.quantity);
      }
      record("updateStock", { sourceItems: clone(data.sourceItems) });
      return {};
    },
  };

  const productClient = {
    createProduct: async () => ({}),
    deleteProduct: async () => ({}),
    updateProduct: async (_p, data) => {
      const sku = data.product?.sku ?? data.sku;
      const p = db.products.get(sku);
      if (p) {
        Object.assign(p, data.product ?? {});
      }
      record("updateProduct", { product: clone(data.product ?? data) });
      return {};
    },
  };

  /** What Commerce holds right now, for the ledger (the shape #lib/commerce-before answers). */
  const before = {
    nameOf: async (_p, sku) => db.products.get(sku)?.name,
    priceOf: async (_p, sku) => db.products.get(sku)?.price,
    quantityOf: async (_p, sku, source) =>
      db.sourceItems.get(`${sku}|${source}`),
  };

  /** Events Commerce would raise, built from the store as it is now. */
  const events = {
    invoiceSaved: (invoiceId) => {
      const inv = db.invoices.find((s) => s.entity_id === Number(invoiceId));
      // Only the fields the Invoice Saved subscription names (app.commerce.config.ts): the
      // event carries NO lines. Sending the lines here hid that a partial invoice was told
      // to every ERP of a split order (Justrite, 2026-10-02).
      const { entity_id, increment_id, order_id, state } = inv;
      return {
        data: { value: { entity_id, increment_id, order_id, state } },
        type: "observer.sales_order_invoice_save_after",
      };
    },
    orderSaved: (orderId, { isNew = false } = {}) => ({
      data: { value: { ...clone(order(orderId)), _isNew: isNew } },
      type: "observer.sales_order_save_commit_after",
    }),
    /** Commerce's product save: the product as it is at this moment, which a late delivery still carries. */
    productSaved: (sku) => ({
      data: {
        value: {
          ...clone(db.products.get(sku)),
          created_at: "2026-09-24 10:00:00",
          updated_at: "2026-10-02 16:06:34",
        },
      },
      type: "observer.catalog_product_save_commit_after",
    }),
    returnSaved: (returnId) => returns.returnSaved(returnId),
    shipmentSaved: (shipmentId) => {
      const s = db.shipments.find((x) => x.entity_id === Number(shipmentId));
      return {
        data: { value: clone(s) },
        type: "observer.sales_order_shipment_save_after",
      };
    },
    /** Commerce's legacy stock item save: the default source's quantity, by product id. */
    stockItemSaved: (sku) => ({
      data: {
        value: {
          product_id: db.products.get(sku).id,
          qty: db.sourceItems.get(`${sku}|default`) ?? 0,
        },
      },
      type: "observer.cataloginventory_stock_item_save_commit_after",
    }),
  };

  return {
    adminCancel(orderId) {
      return lib.orders.cancel({}, orderId);
    },
    adminCreateReturn(orderId, lines) {
      return returns.adminCreateReturn(orderId, lines);
    },
    adminHold(orderId) {
      return orderClient.holdOrder({}, orderId);
    },
    adminInvoice(orderId) {
      return orderClient.invoiceOrder({}, orderId);
    },
    adminSetSourceItem(sku, sourceCode, quantity) {
      db.sourceItems.set(`${sku}|${sourceCode}`, quantity);
    },
    /** A shipment made IN Commerce Admin: recorded here, and its event built. */
    adminShip(orderId, items, sourceCode = "default") {
      const shipmentId = db.nextId;
      shipmentClient.createShipment({}, orderId, {
        arguments: { extension_attributes: { source_code: sourceCode } },
        items,
      });
      return shipmentId;
    },
    balance,
    before,
    /**
     * An order placed with a card on Authorize and Capture: the gateway captured the money and
     * Commerce invoiced every line at checkout, in its own invoice (not an integration write, so
     * not in `writes`). The order is Processing, paid in full, nothing left to invoice. The
     * invoice is saved in the same request as the order, so it carries the order's `created_at`.
     */
    captureAtCheckout(orderId, payment) {
      const o = order(orderId);
      o.payment = clone(payment);
      const id = billRemainder(o, o.created_at);
      o.state = "processing";
      o.status = "processing";
      return id;
    },
    get db() {
      return db;
    },
    events,
    lib,
    orderClient,
    orderSaves,
    productClient,
    reset() {
      db = seed();
      writes.length = 0;
      orderSaves.length = 0;
    },
    shipmentClient,
    stockClient,
    tierPrices,
    writes,
  };
}
