/*
 * Drain the ERP's outbox into Commerce. Each entry kind maps to one Commerce write;
 * company writes are ledgered so reset can revert them (decision 8). Pure over the
 * writers it is handed.
 *
 * Order statuses map to Commerce operations the way the plan records (step 03):
 *   confirmed → a status-history comment (the kit's order/external/updated shape)
 *   shipped   → a real shipment of every line
 *   invoiced  → an invoice with capture
 *   cancelled → cancel
 */

/** Which ERP status becomes which Commerce operation. */
export const STATUS_OPERATIONS = {
  cancelled: "cancel",
  confirmed: "comment",
  invoiced: "invoice",
  shipped: "ship",
};

async function applyPrice(params, entry, { commerce }) {
  await commerce.setProductPrice(params, entry.sku, entry.listPrice);
  return { applied: true, detail: `${entry.sku} price ${entry.listPrice}` };
}

async function applyStock(params, entry, { commerce }) {
  await commerce.setStock(params, entry.sku, entry.stock);
  return { applied: true, detail: `${entry.sku} stock ${entry.stock}` };
}

async function applyCreditLimit(params, entry, { commerce, ledger }) {
  if (!entry.commerceCompanyId) {
    return {
      applied: false,
      detail: `${entry.partnerId} has no Commerce company`,
    };
  }
  const credit = await commerce.getCompanyCredit(
    params,
    entry.commerceCompanyId,
  );
  await commerce.setCompanyCreditLimit(
    params,
    credit.id,
    entry.commerceCompanyId,
    entry.creditLimit,
  );
  await ledger.recordCompanyWrite({
    after: entry.creditLimit,
    before: Number(credit.credit_limit ?? 0),
    companyId: entry.commerceCompanyId,
    extra: { creditId: credit.id },
    field: "creditLimit",
  });
  return {
    applied: true,
    detail: `company ${entry.commerceCompanyId} credit limit ${entry.creditLimit}`,
  };
}

async function applyBlocked(params, entry, { commerce, ledger }) {
  if (!entry.commerceCompanyId) {
    return {
      applied: false,
      detail: `${entry.partnerId} has no Commerce company`,
    };
  }
  const company = await commerce.getCompany(params, entry.commerceCompanyId);
  const status = entry.blocked
    ? commerce.COMPANY_STATUS.BLOCKED
    : commerce.COMPANY_STATUS.APPROVED;
  await commerce.setCompanyStatus(params, entry.commerceCompanyId, status);
  await ledger.recordCompanyWrite({
    after: status,
    before: Number(company.status),
    companyId: entry.commerceCompanyId,
    field: "status",
  });
  return {
    applied: true,
    detail: `company ${entry.commerceCompanyId} ${entry.blocked ? "blocked" : "unblocked"}`,
  };
}

async function shipWholeOrder(params, orderId, note, commerce) {
  const order = await commerce.orders.get(params, orderId);
  const items = (order.items ?? [])
    .filter((i) => !i.parent_item_id)
    .map((i) => ({
      order_item_id: i.item_id,
      qty: Number(i.qty_ordered) - Number(i.qty_shipped ?? 0),
    }))
    .filter((i) => i.qty > 0);
  await commerce.orders.ship(params, orderId, items, note);
}

async function applyOrderStatus(params, entry, { commerce, erpName }) {
  const operation = STATUS_OPERATIONS[entry.status];
  if (!operation) {
    return {
      applied: false,
      detail: `no Commerce operation for status ${entry.status}`,
    };
  }
  const orderId = entry.commerceOrderId;
  const note = `${erpName || "the ERP"}: sales order ${entry.number} ${entry.status}`;
  if (operation === "comment") {
    await commerce.orders.comment(params, orderId, note);
  } else if (operation === "ship") {
    await shipWholeOrder(params, orderId, note, commerce);
  } else if (operation === "invoice") {
    await commerce.orders.invoice(params, orderId);
    await commerce.orders.comment(params, orderId, note);
  } else {
    await commerce.orders.cancel(params, orderId);
  }
  return {
    applied: true,
    detail: `order ${entry.commerceIncrementId || orderId} ${entry.status}`,
  };
}

const HANDLERS = {
  "material.price": applyPrice,
  "material.stock": applyStock,
  "order.status": applyOrderStatus,
  "partner.blocked": applyBlocked,
  "partner.creditLimit": applyCreditLimit,
};

/**
 * Apply one outbox entry.
 * @param {object} deps `{ commerce, ledger, erpName }`
 * @returns {Promise<{ applied: boolean, detail: string }>}
 */
export function applyEntry(params, entry, deps) {
  const handler = HANDLERS[entry.kind];
  if (!handler) {
    return Promise.resolve({
      applied: false,
      detail: `unknown outbox kind ${entry.kind}`,
    });
  }
  return handler(params, entry, deps);
}

/**
 * Drain everything pending. Entries that fail stay pending for the next run, unless
 * they are unknown (acknowledged so they cannot block the queue).
 * @returns {Promise<{ applied: object[], skipped: object[], failed: object[] }>}
 */
export async function drain(params, deps) {
  const { erp } = deps;
  const pending = await erp.outbox(params);
  if (!pending.ok) {
    throw new Error(
      `ERP outbox answered ${pending.status}: ${pending.data?.errorMessage || "unknown error"}`,
    );
  }
  const applied = [];
  const skipped = [];
  const failed = [];
  const toAck = [];
  for (const entry of pending.data.items ?? []) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: entries apply in order
      const result = await applyEntry(params, entry, deps);
      (result.applied ? applied : skipped).push({
        id: entry._id,
        kind: entry.kind,
        ...result,
      });
      toAck.push(entry._id);
    } catch (error) {
      failed.push({ error: error.message, id: entry._id, kind: entry.kind });
    }
  }
  if (toAck.length > 0) {
    await erp.ack(params, toAck);
  }
  return { applied, failed, skipped };
}
