/*
 * A payment the ERP posted against an invoice of an order (AB-26s, payment-leg-design.md;
 * contract v14 be-observer.sales_order_payment_create). The ERP is the master of what is owed;
 * Commerce only learns that money came in:
 *
 * - an order paid ON ACCOUNT (Commerce's `companycredit`) charged its company's credit when it
 *   was placed, so the company gets the paid amount back: increaseBalance, operation type 4
 *   (Reimbursed), naming the order and the ERP's payment (lib/company-balance.js);
 * - that reimbursement is ledgered (lib/ledger.js recordPaymentWrite), so a demo reset takes it
 *   back (lib/detach.js, decreaseBalance type 4): whatever can be done can be undone;
 * - an order paid any other way (e.g. check / money order) changes no credit;
 * - either way the order gets one staff-only comment naming the ERP and the payment.
 *
 * Made under the order's lock (lib/order-parts.js lockOrder), the lock credit memos and partial
 * invoices take, and keyed `<ERP id>/<payment number>` in the order's credits record
 * (lib/order-returns.js, its `payments`), written right after the reimbursement, so a
 * redelivered event reimburses nothing twice. With several ERPs the payment must come from an
 * ERP that holds a part of the order (router/return-items.js senderOf), and the words name it.
 */
import { customerCompanyId, getCompanyCredit } from "#lib/commerce";
import { increaseCompanyBalance } from "#lib/company-balance";
import { loadErps } from "#lib/erps";
import { recordPaymentWrite } from "#lib/ledger";
import { lockOrder, unlockOrder } from "#lib/order-parts";
import { readOrderCredits, writeOrderCredits } from "#lib/order-returns";
import { senderOf } from "#router/return-items";
import { addComment, getOrder } from "#src/order/commerce-order-api-client";

/** Commerce's payment method code for Payment on Account. */
const ON_ACCOUNT = "companycredit";

/** Why the event cannot be applied at all, or null. */
function eventProblem(data) {
  if (!data?.paymentNumber) {
    return "the payment has no number";
  }
  const amount = Number(data.amount);
  if (!(Number.isFinite(amount) && amount > 0)) {
    return `the payment amount ${data.amount} is not more than 0`;
  }
  return null;
}

/**
 * The company an on-account order charged: the one on the order, else its buyer's (the way an
 * order send resolves it, lib/order-sync.js), or null for an order not paid on account.
 */
async function chargedCompany(params, order, deps) {
  if (order.payment?.method !== ON_ACCOUNT) {
    return null;
  }
  const onOrder =
    order.extension_attributes?.company_order_attributes?.company_id;
  if (onOrder !== undefined && onOrder !== null) {
    return String(onOrder);
  }
  if (order.customer_id === undefined || order.customer_id === null) {
    return null;
  }
  return await (deps.companyIdOf ?? customerCompanyId)(
    params,
    order.customer_id,
  );
}

/** Give the company its credit back, then record it on the order and in the ledger. */
async function reimburse(params, pay, companyId, deps) {
  const { data, erp } = pay;
  const credit = await (deps.getCompanyCredit ?? getCompanyCredit)(
    params,
    companyId,
  );
  const amount = Number(data.amount);
  const currency = data.currency ?? credit.currency_code;
  await (deps.increaseCompanyBalance ?? increaseCompanyBalance)(
    params,
    credit.id,
    {
      comment: `Paid in ${erp.name} (payment ${data.paymentNumber}, invoice ${data.invoiceNumber})`,
      currency,
      orderIncrement: String(data.incrementId),
      purchaseOrder: String(data.paymentNumber),
      value: amount,
    },
  );
  const done = { amount, companyId, creditId: credit.id, currency };
  await pay.record({ ...done, reimbursed: true });
  await (deps.recordPaymentWrite ?? recordPaymentWrite)({
    ...done,
    erpId: erp.id,
    incrementId: data.incrementId,
    paymentNumber: data.paymentNumber,
  });
  return `${erp.name} payment ${data.paymentNumber}: company ${companyId}'s credit reimbursed ${amount} ${currency}`;
}

/** Under the order's lock: reimburse once (on account), record it, and note the order. */
async function applyUnderLock(params, order, pay, deps) {
  const { data, erp } = pay;
  const incrementId = String(data.incrementId);
  const credits = await readOrderCredits(incrementId);
  const key = `${erp.id}/${data.paymentNumber}`;
  const words = `Paid in ${erp.name} (payment ${data.paymentNumber})`;
  if (credits.payments?.[key]) {
    return {
      already: true,
      erpId: erp.id,
      matched: true,
      message: `${words}: already applied`,
    };
  }
  const record = (entry) => {
    const payments = { ...credits.payments, [key]: { at: now(), ...entry } };
    return writeOrderCredits(incrementId, { ...credits, payments });
  };
  const companyId = await chargedCompany(params, order, deps);
  let message;
  if (companyId) {
    message = await reimburse(params, { ...pay, record }, companyId, deps);
  } else {
    await record({ amount: Number(data.amount), reimbursed: false });
    message = `${words}: paid by ${order.payment?.method}, no credit changed`;
  }
  await (deps.addComment ?? addComment)(params, pay.orderId, {
    statusHistory: {
      comment: words,
      is_customer_notified: 0,
      is_visible_on_front: 0,
    },
  });
  return { erpId: erp.id, matched: true, message };
}

const now = () => new Date().toISOString();

/**
 * An ERP posted a payment for an invoice of an order.
 * @param {object} params action params
 * @param {number} orderId the Commerce order id
 * @param {object} data the ERP's event value (contract v14 sales_order_payment_create)
 * @param {object} [deps] `{ erps, getOrder, companyIdOf, getCompanyCredit,
 *   increaseCompanyBalance, recordPaymentWrite, addComment, attempts, wait }` (test seam)
 * @returns {Promise<{ matched: false, reason: string } | { busy: true, reason: string } |
 *   { matched: true, erpId: string, message: string, already?: true }>}
 */
export async function paymentFromErp(params, orderId, data, deps = {}) {
  const label = `order ${data?.incrementId}`;
  const problem = eventProblem(data);
  if (problem) {
    return { matched: false, reason: `${label}: ${problem}` };
  }
  const erps = deps.erps ?? (await loadErps(params));
  const sender = await senderOf(erps, data);
  if (!sender.matched) {
    return sender;
  }
  const order = await (deps.getOrder ?? getOrder)(params, orderId);
  const token = await lockOrder(data.incrementId, {
    attempts: deps.attempts,
    wait: deps.wait,
  });
  if (!token) {
    return {
      busy: true,
      reason: `${label}: another write to the order is running; try again`,
    };
  }
  try {
    return await applyUnderLock(
      params,
      order,
      { data, erp: sender.erp, orderId },
      deps,
    );
  } finally {
    await unlockOrder(data.incrementId, token);
  }
}
