/*
 * The payment reference of an order Commerce took the money for at checkout (AB-26s, the card
 * half; owner 2026-10-02, flow 1, Business Central's web-shop pattern). Commerce captures the
 * card through its own gateway (Payment Services or Cybersource); the ERP is told only HOW it
 * was paid — method, the gateway's transaction id, card brand, last four digits, amount — so it
 * can post its invoice as paid with nothing open (the ERP's contract version 18,
 * order.payment). Never a card number: the reference is built from an ALLOW-LIST of the
 * Commerce payment record's fields, so nothing else on the record (additional_information,
 * cc_number_enc, the card owner) can reach the ERP, whatever a payment method puts there.
 *
 * Only captured money counts (Business Central: "Authorization and Void are always
 * excluded"): the record must show an amount paid and a gateway transaction. Payment on
 * Account is never a reference: the company's credit paid, and the ERP collects it.
 */

/** Commerce's payment method code for Payment on Account. */
const ON_ACCOUNT = "companycredit";

/** Commerce's card type codes (cc_type), as brand names. */
const BRANDS = Object.freeze({
  AE: "American Express",
  DI: "Discover",
  DN: "Diners Club",
  JCB: "JCB",
  MC: "Mastercard",
  VI: "Visa",
});

const LAST_FOUR = /^\d{4}$/u;
/* A brand is a name: letters, with spaces or hyphens (the ERP refuses anything else). */
const BRAND = /^[A-Za-z][A-Za-z -]{0,29}$/u;

const cents = (value) => Math.round(value * 100) / 100;

const text = (value) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

function brandOf(ccType) {
  const code = text(ccType);
  const name = BRANDS[code.toUpperCase()] ?? code;
  return BRAND.test(name) ? name : null;
}

function lastFourOf(ccLast4) {
  const digits = text(ccLast4);
  return LAST_FOUR.test(digits) ? digits : null;
}

/** What the gateway captured, in the base currency; 0 when nothing was. */
function capturedOf(payment) {
  return Number(payment.base_amount_paid ?? payment.amount_paid ?? 0) || 0;
}

/**
 * @param {unknown} payment the Commerce order's `payment` record (REST)
 * @param {number} [share] one ERP's part of the order: its own total, so each part's invoice
 *   closes; at most what was captured. Absent: the whole captured amount.
 * @returns {{ method: string, reference: string, cardBrand?: string, cardLastFour?: string,
 *   amount: number } | null} null when the order was not paid at checkout
 */
export function paymentReferenceOf(payment, share) {
  if (
    !payment ||
    typeof payment !== "object" ||
    payment.method === ON_ACCOUNT
  ) {
    return null;
  }
  const reference = text(payment.last_trans_id);
  const captured = capturedOf(payment);
  const amount = cents(
    share === undefined ? captured : Math.min(share, captured),
  );
  if (!(reference && amount > 0)) {
    return null;
  }
  const cardBrand = brandOf(payment.cc_type);
  const cardLastFour = lastFourOf(payment.cc_last4);
  return {
    amount,
    ...(cardBrand ? { cardBrand } : {}),
    ...(cardLastFour ? { cardLastFour } : {}),
    method: text(payment.method),
    reference,
  };
}
