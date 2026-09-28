import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import {
  getCompany,
  getCompanyCredit,
  getProduct,
  productAttributes,
  sourceCodesOf,
} from "#lib/commerce";
import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import { erpCustomerOf } from "#lib/key-map";
import { companyLookup, productLookup } from "#lib/lookup";
import { ownsSku } from "#lib/structure";
import { ownersOf } from "#router/ownership";

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

/**
 * The ERP customer for a Commerce company: the key map's pair, else none (the ERP holds no
 * Commerce id to search by, contract version 3).
 */
async function erpCustomerRow(companyId) {
  const paired = await erpCustomerOf(companyId);
  return paired ? { id: paired } : null;
}

async function lookupCompany(params, companyId) {
  const [commerce, credit, match] = await Promise.all([
    getCompany(params, companyId).catch(notFoundAsNull),
    getCompanyCredit(params, companyId).catch(notFoundAsNull),
    erpCustomerRow(companyId),
  ]);
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
 * A SKU with several ERPs: the one ERP that owns it is asked, at its own address, and named
 * (`owner`). A SKU no ERP owns, or two claim, shows an empty ERP side and `owner: null`.
 */
async function lookupSkuAcross(params, sku, erps) {
  const owners = await ownersOf(params, sku, erps, (p, s, settings) =>
    ownsSku(p, s, settings, { productAttributes, sourceCodesOf }),
  );
  const owner =
    owners.length === 1 ? erps.find((e) => e.id === owners[0]) : null;
  const [commerce, sourceCodes, answer] = await Promise.all([
    getProduct(params, sku).catch(notFoundAsNull),
    sourceCodesOf(params, sku).catch(() => []),
    owner
      ? erp.product(paramsForErp(params, owner), sku, ERP_TIMEOUT_MS)
      : { ok: false, status: NOT_FOUND },
  ]);
  return {
    ...productLookup({
      commerce,
      erp: erpRecord(answer, `product ${sku}`),
      sku,
      sourceCodes,
    }),
    owner: owner ? { id: owner.id, name: owner.name } : null,
    owners,
  };
}

/** A company with several ERPs: as it stands in each ERP, its customer there from the key map. */
async function lookupCompanyAcross(params, companyId, erps) {
  const [commerce, credit] = await Promise.all([
    getCompany(params, companyId).catch(notFoundAsNull),
    getCompanyCredit(params, companyId).catch(notFoundAsNull),
  ]);
  const perErp = await Promise.all(
    erps.map(async (entry) => {
      const paired = await erpCustomerOf(companyId, entry.id);
      const document = paired
        ? erpRecord(
            await erp.partner(
              paramsForErp(params, entry),
              paired,
              ERP_TIMEOUT_MS,
            ),
            `partner ${paired} in ${entry.name}`,
          )
        : null;
      return {
        erpId: entry.id,
        erpName: entry.name,
        ...companyLookup({
          commerce,
          companyId,
          credit,
          erp: document ?? (paired ? { id: paired } : null),
        }),
      };
    }),
  );
  return { erps: perErp, key: companyId, kind: "company" };
}

/**
 * GET lookup?sku=<sku> | ?company=<Commerce company id>: one entity as both systems hold
 * it, lined up row by row for the Mapping tab (lib/lookup.js). A side that does not have
 * it answers with empty cells; that is the answer, not an error. With several ERPs a company
 * answers `{ kind, key, erps: [one lookup per ERP] }` and a SKU names its owning ERP; with one
 * ERP the answer is as it always was.
 */
async function main(params) {
  const logger = AioLogger("erp-lookup", { level: params.LOG_LEVEL || "info" });
  try {
    if (params.sku !== undefined) {
      const sku = String(params.sku).trim();
      if (!SKU.test(sku)) {
        return badRequest("Name the product to look up by its SKU.");
      }
      const erps = await loadErps(params);
      return ok({
        body:
          erps.length > 1
            ? await lookupSkuAcross(params, sku, erps)
            : await lookupSku(params, sku),
      });
    }
    if (params.company !== undefined) {
      const companyId = String(params.company).trim();
      if (!COMPANY_ID.test(companyId)) {
        return badRequest("Name the company to look up by its Commerce id.");
      }
      const erps = await loadErps(params);
      return ok({
        body:
          erps.length > 1
            ? await lookupCompanyAcross(params, companyId, erps)
            : await lookupCompany(params, companyId),
      });
    }
    return badRequest("Name a sku or a company to look up.");
  } catch (error) {
    logger.error(`lookup failed: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
