import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import {
  getCompany,
  getCompanyCredit,
  getProduct,
  sourceCodesOf,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { companyLookup, productLookup } from "#lib/lookup";

/** A SKU as Commerce allows it; anything else never reaches either system. */
const SKU = /^[A-Za-z0-9 _./-]{1,64}$/u;
const COMPANY_ID = /^\d{1,12}$/u;
const NOT_FOUND = 404;
const SERVER_ERROR = 500;
/** Both sides are asked inside a page load, so the ERP waits no longer than this. */
const ERP_TIMEOUT_MS = 5000;

/** A Commerce 404 is "not there", which is an answer; anything else is an error. */
function notFoundAsNull(error) {
  if (error.response?.status === NOT_FOUND) {
    return null;
  }
  throw error;
}

/** The ERP's record from its answer: absent on 404, an error on anything else that failed. */
function erpRecord(answer, what) {
  if (answer.ok) {
    return answer.data;
  }
  if (answer.status >= SERVER_ERROR) {
    throw new Error(`the ERP answered ${answer.status} for ${what}`);
  }
  return null;
}

async function lookupSku(params, sku) {
  const [commerce, sourceCodes, answer] = await Promise.all([
    getProduct(params, sku),
    sourceCodesOf(params, sku).catch(() => []),
    erp.product(params, sku, ERP_TIMEOUT_MS),
  ]);
  return productLookup({
    commerce,
    erp: erpRecord(answer, `product ${sku}`),
    sku,
    sourceCodes,
  });
}

async function lookupCompany(params, companyId) {
  const [commerce, credit, partners] = await Promise.all([
    getCompany(params, companyId).catch(notFoundAsNull),
    getCompanyCredit(params, companyId).catch(notFoundAsNull),
    erp.partners(params, ERP_TIMEOUT_MS),
  ]);
  const rows = erpRecord(partners, "partners")?.items ?? [];
  const match = rows.find((p) => String(p.commerceCompanyId) === companyId);
  // The document carries the credit figures the row does not.
  const document = match
    ? erpRecord(
        await erp.partner(params, match.id, ERP_TIMEOUT_MS),
        `partner ${match.id}`,
      )
    : null;
  return companyLookup({
    commerce,
    companyId,
    credit,
    erp: document ?? match ?? null,
  });
}

/**
 * GET lookup?sku=<sku> | ?company=<Commerce company id>: one entity as both systems hold
 * it, lined up row by row for the Mapping tab (lib/lookup.js). A side that does not have
 * it answers with empty cells; that is the answer, not an error.
 */
async function main(params) {
  const logger = AioLogger("erp-lookup", { level: params.LOG_LEVEL || "info" });
  try {
    if (params.sku !== undefined) {
      const sku = String(params.sku).trim();
      if (!SKU.test(sku)) {
        return badRequest("Name the product to look up by its SKU.");
      }
      return ok({ body: await lookupSku(params, sku) });
    }
    if (params.company !== undefined) {
      const companyId = String(params.company).trim();
      if (!COMPANY_ID.test(companyId)) {
        return badRequest("Name the company to look up by its Commerce id.");
      }
      return ok({ body: await lookupCompany(params, companyId) });
    }
    return badRequest("Name a sku or a company to look up.");
  } catch (error) {
    logger.error(`lookup failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
