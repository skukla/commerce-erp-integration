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
  };
}

/** @returns {object} the fake store with `lib` (for #lib/commerce), the kit clients, event builders and `writes` */
export function createFakeCommerce() {
  let db = seed();
  const writes = [];
  const record = (kind, detail) => writes.push({ kind, ...detail });
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
      return {};
    },
    findOrderByIncrementId: async (_p, incrementId) => {
      const o = [...db.orders.values()].find(
        (x) => x.increment_id === String(incrementId),
      );
      return o
        ? {
            entityId: o.entity_id,
            extOrderId: o.ext_order_id || null,
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
    orders: {
      cancel: async (_p, orderId) => {
        const o = order(orderId);
        o.state = "canceled";
        o.status = "canceled";
        record("cancel", { orderId: String(orderId) });
        return true;
      },
      comment: async (_p, orderId, comment, status) => {
        record("comment", { comment, orderId: String(orderId), status });
        if (status) {
          order(orderId).status = status;
        }
        return {};
      },
    },
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
    unholdIfHeld: async (_p, orderId) => {
      const o = order(orderId);
      if (o.state !== "holded") {
        return false;
      }
      o.state = "processing";
      o.status = "processing";
      record("unhold", { orderId: String(orderId) });
      return true;
    },
  };

  const orderClient = {
    addComment: async (_p, orderId, data) => {
      record("comment", {
        comment: data.statusHistory?.comment,
        orderId: String(orderId),
        status: data.statusHistory?.status,
      });
      if (data.statusHistory?.status) {
        order(orderId).status = data.statusHistory.status;
      }
      return {};
    },
    cancelOrder: async (_p, orderId) => lib.orders.cancel(_p, orderId),
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
      const id = db.nextId;
      db.nextId += 1;
      db.invoices.push({
        entity_id: id,
        increment_id: String(id),
        order_id: o.entity_id,
        state: 2,
      });
      o.state = "complete";
      record("invoice", { invoiceId: id, orderId: String(orderId) });
      return id;
    },
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

  const shipmentClient = {
    createShipment: async (_p, orderId, data) => {
      const o = order(orderId);
      const id = db.nextId;
      db.nextId += 1;
      db.shipments.push({
        entity_id: id,
        extension_attributes: {
          source_code: data.extension_attributes?.source_code,
        },
        increment_id: String(id),
        items: data.items.map((i) => ({
          order_item_id: i.order_item_id,
          qty: i.qty,
        })),
        order_id: o.entity_id,
      });
      for (const i of data.items) {
        const key = `${o.items.find((x) => x.item_id === i.order_item_id)?.sku}|${data.extension_attributes?.source_code ?? "default"}`;
        db.sourceItems.set(key, (db.sourceItems.get(key) ?? 0) - i.qty);
      }
      o.state = "processing";
      record("ship", {
        orderId: String(orderId),
        shipmentId: id,
        sourceCode: data.extension_attributes?.source_code,
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
      return {
        data: { value: clone(inv) },
        type: "observer.sales_order_invoice_save_after",
      };
    },
    orderSaved: (orderId, { isNew = false } = {}) => ({
      data: { value: { ...clone(order(orderId)), _isNew: isNew } },
      type: "observer.sales_order_save_commit_after",
    }),
    shipmentSaved: (shipmentId) => {
      const s = db.shipments.find((x) => x.entity_id === Number(shipmentId));
      return {
        data: { value: clone(s) },
        type: "observer.sales_order_shipment_save_after",
      };
    },
  };

  return {
    adminCancel(orderId) {
      return lib.orders.cancel({}, orderId);
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
        extension_attributes: { source_code: sourceCode },
        items,
      });
      return shipmentId;
    },
    before,
    get db() {
      return db;
    },
    events,
    lib,
    orderClient,
    productClient,
    reset() {
      db = seed();
      writes.length = 0;
    },
    shipmentClient,
    stockClient,
    writes,
  };
}
