/*
 * A company's credit BALANCE, moved by money the ERP saw (AB-26s, payment-leg-design.md). Not
 * the credit limit (lib/commerce.js setCompanyCreditLimit): an order paid on account lowers the
 * balance when it is placed, and a payment the ERP posts for its invoice gives that much back.
 *
 * Both writes are operation type 4, Reimbursed, so the company's credit history reads them as
 * what they are. Measured live on Justrite 2026-10-02: increaseBalance answers true and raises
 * the available credit by the value; decreaseBalance with type 4 takes it back to the cent; the
 * history row shows type 4, the purchase order and the comment. Adobe reference:
 * developer.adobe.com/commerce/webapi/rest/b2b/credit-manage/.
 */
import { commerceClient } from "#lib/commerce";

/** Commerce's credit balance operation "Reimbursed". */
const REIMBURSED = 4;

/**
 * The body both writes send.
 * @param {{ value: number, currency: string, comment: string, orderIncrement: string,
 *   purchaseOrder: string }} move
 */
function bodyOf({ value, currency, comment, orderIncrement, purchaseOrder }) {
  return {
    comment,
    currency,
    operationType: REIMBURSED,
    options: { order_increment: orderIncrement, purchase_order: purchaseOrder },
    value,
  };
}

async function moveBalance(params, creditId, direction, move) {
  const client = await commerceClient(params);
  return client
    .post(`companyCredits/${creditId}/${direction}`, { json: bodyOf(move) })
    .json();
}

/**
 * Give a company credit back: a payment the ERP posted for an order paid on account.
 * @param {object} params action params
 * @param {number|string} creditId the company's credit record id (companyCredits/company/:id)
 * @param {object} move `{ value, currency, comment, orderIncrement, purchaseOrder }`
 * @returns {Promise<boolean>} Commerce's answer
 */
export function increaseCompanyBalance(params, creditId, move) {
  return moveBalance(params, creditId, "increaseBalance", move);
}

/**
 * Take a reimbursement back (a demo reset undoing what the integration wrote).
 * @param {object} params action params
 * @param {number|string} creditId the company's credit record id
 * @param {object} move the same `{ value, currency, comment, orderIncrement, purchaseOrder }`
 * @returns {Promise<boolean>} Commerce's answer
 */
export function decreaseCompanyBalance(params, creditId, move) {
  return moveBalance(params, creditId, "decreaseBalance", move);
}
