import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { paramsForErp } from "#adapters/contract";
import { listWebsites, readCompanyRow } from "#lib/commerce";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { companyToErp } from "#lib/company-sync";
import { erp } from "#lib/erp";
import { loadErps, SINGLE_ERP_ID } from "#lib/erps";
import { recordCompanySave } from "#lib/history";
import { erpCustomerOf, pairCustomer } from "#lib/key-map";
import { websiteSettings } from "#lib/settings";

/**
 * observer.company_save_commit_after: a company created or changed in Commerce becomes a
 * business partner in every ERP the integration serves (lib/company-sync.js), paired per ERP
 * in the key map (a company buying from several brands is a customer in each brand's ERP).
 * A failure answers 500 so I/O Events delivers the event again; an ERP that already has the
 * company is updated, not duplicated. Under Activity it is one row per company: its name, the
 * customer it is in each ERP, and how the send ended (2026-10-14; before, nothing recorded it).
 */
async function main(params) {
  const logger = AioLogger("company-commerce-saved", {
    level: params.LOG_LEVEL || "info",
  });
  const company = params.data?.value ?? params.data ?? {};
  // The B2B Company entity's key is entity_id (like shipment/invoice), not id; the event
  // subscribes to both so the payload carries whichever Commerce populates (AB-41).
  const companyId = Number(company.entity_id ?? company.id);
  if (!(Number.isInteger(companyId) && companyId > 0)) {
    return badRequest("the company event carries no company id");
  }
  let erps = [];
  const partners = [];
  try {
    erps = await loadErps(params);
    for (const entry of erps) {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, each paired as it lands
      const partner = await companyToErp(
        paramsFor(params, entry, erps.length),
        companyId,
        originOf(COMMERCE_EVENTS.companySaved, params, companyId),
        {
          erpCustomerOf: (id) => erpCustomerOf(id, entry.id),
          importRecords: erp.importRecords,
          listWebsites,
          pairCustomer: (id, number) => pairCustomer(id, number, entry.id),
          readCompanyRow,
          websiteSettings: (code) => websiteSettings(code, logger),
        },
      );
      partners.push({ erp: entry, partner });
    }
    const said = `Company ${companyId} is business partner ${partners
      .map(({ erp: entry, partner }) => `${partner.id} in ${entry.name}`)
      .join(", ")}`;
    await recordCompanySave(companyId, savedOf(said, erps, partners), logger);
    return ok(said);
  } catch (error) {
    logger.error(`company ${companyId} not sent: ${error.message}`);
    const failed = {
      ...savedOf(
        `Company ${companyId}: not sent to the ERP: ${error.message}`,
        erps,
        partners,
      ),
      outcome: "failed",
    };
    await recordCompanySave(companyId, failed, logger);
    return internalServerError(error.message);
  }
}

/**
 * The Activity record of a save: every ERP it was for, and the company's name and customer
 * numbers as far as the ERPs took it.
 */
function savedOf(message, erps, partners) {
  return {
    customers: [...new Set(partners.map(({ partner }) => partner.id))],
    erpIds: erps.map((entry) => entry.id),
    message,
    name: partners[0]?.partner.name,
    outcome: "sent",
  };
}

/** The params an ERP is called with: its own address and credential when there are several. */
function paramsFor(params, entry, count) {
  if (count === 1 && entry.id === SINGLE_ERP_ID) {
    return params;
  }
  return paramsForErp(params, entry);
}

export { main };
