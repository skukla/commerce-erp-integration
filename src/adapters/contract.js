/*
 * The contract every ERP adapter implements (design v1 §2, "Code layout"). The router knows
 * no ERP: it hands each ERP's part of an order to that ERP's adapter and reads the outcome
 * back in one vocabulary. An adapter knows exactly one kind of ERP and nothing of the others.
 *
 * To add an ERP of a new kind: write a folder under src/adapters/ that exports these two
 * functions, register it in src/lib/erps.js, and add the ERP to the ERP list. Nothing else in
 * the integration changes.
 */

/**
 * @typedef {object} ErpEntry One ERP in the list (src/lib/erps.js).
 * @property {string} id Unique and never changes; the key for parts, the key map and settings,
 *   and the value a product's owning-ERP attribute holds.
 * @property {string} name The label people read.
 * @property {string} adapter The kind of ERP: the adapter folder that talks to it.
 * @property {object} connection Where the adapter sends: `baseUrl`, and `auth` for an ERP
 *   outside the integration's workspace (its own credential, lib/erp-auth.js).
 */

/**
 * @typedef {object} Part One ERP's share of a Commerce order.
 * @property {ErpEntry} erp The ERP that owns these lines.
 * @property {object} order The Commerce order, as the order event carries it.
 * @property {object[]} lines The order's lines this ERP owns (every line while there is one ERP).
 */

/**
 * @typedef {object} PartOutcome What happened to a part, in the vocabulary order-sync uses.
 * @property {"sent"|"skipped"|"held"|"dropped"|"failed"} outcome
 * @property {number} statusCode The answer the event action gives I/O Events.
 * @property {string} message One sentence for the history and the logs.
 * @property {string} [erpNumber] The ERP's own order number, once it has one.
 */

/**
 * @callback SendPart Send one part to the ERP and write back what Commerce needs.
 * @param {object} params action params (credentials, settings)
 * @param {Part} part the part to send
 * @param {object} deps the Commerce, ERP and settings collaborators (lib/order-deps.js)
 * @returns {Promise<PartOutcome>}
 */

/**
 * @callback ReadOutcome Turn one of this ERP's inbound messages into a part outcome, or null
 *   when the message is not about a part.
 * @param {object} event the ERP's message
 * @returns {PartOutcome|null}
 */

/** The functions an adapter must export. */
export const ADAPTER_FUNCTIONS = Object.freeze(["sendPart", "readOutcome"]);

/**
 * Check that an adapter implements the contract.
 * @param {object} adapter an adapter module
 * @param {string} [kind] its name, for the error
 * @returns {object} the adapter
 * @throws {Error} naming the first missing function
 */
export function assertAdapter(adapter, kind = "adapter") {
  for (const name of ADAPTER_FUNCTIONS) {
    if (typeof adapter?.[name] !== "function") {
      throw new Error(`${kind} does not implement ${name}`);
    }
  }
  return adapter;
}

/**
 * The params a call to one ERP runs with: that ERP's own address and name over the deployed
 * ones, so the ERP client (lib/erp.js) reaches the right ERP; and, for an ERP with its own
 * credential (`connection.auth`, lib/erp-auth.js), that credential over the integration's.
 * @param {object} params action params
 * @param {ErpEntry} entry the ERP
 * @returns {object}
 */
export function paramsForErp(params, entry) {
  return {
    ...params,
    ERP_BASE_URL: entry.connection?.baseUrl ?? params.ERP_BASE_URL,
    ERP_DISPLAY_NAME: entry.name,
    ...imsParamsOf(entry.connection?.auth),
  };
}

const NOT_A_CONTEXT_CHARACTER = /[^a-zA-Z0-9_.-]/gu;

/**
 * An ERP's credential as the params resolveImsAuthParams (@adobe/aio-commerce-lib-auth) reads.
 * The token request itself uses only the client id, first secret, org and scopes
 * (@adobe/aio-lib-ims-oauth, ims-oauth_server_to_server); the technical account is only
 * checked present, so an ERP that names none keeps the integration's there. The IMS context
 * is the ERP client's own: aio-lib-ims caches a context's token in App Builder State by
 * context name, and a shared name could hand one ERP another's token.
 * @param {object} [auth] the ERP's `connection.auth`
 * @returns {object} params to lay over the integration's, or none
 */
function imsParamsOf(auth) {
  if (!auth) {
    return {};
  }
  return {
    AIO_COMMERCE_AUTH_IMS_CLIENT_ID: auth.clientId,
    AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: [auth.clientSecret],
    AIO_COMMERCE_AUTH_IMS_CONTEXT: `erp-${auth.clientId.replace(NOT_A_CONTEXT_CHARACTER, "-")}`,
    AIO_COMMERCE_AUTH_IMS_ORG_ID: auth.orgId,
    AIO_COMMERCE_AUTH_IMS_SCOPES: auth.scopes,
    ...(auth.technicalAccountId
      ? { AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_ID: auth.technicalAccountId }
      : {}),
    ...(auth.technicalAccountEmail
      ? {
          AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_EMAIL:
            auth.technicalAccountEmail,
        }
      : {}),
  };
}
