import {
  badRequest,
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { listWebsites, readCompanyRow } from "#lib/commerce";
import { COMMERCE_EVENTS, originOf } from "#lib/commerce-events";
import { companyToErp } from "#lib/company-sync";
import { erp } from "#lib/erp";
import { erpCustomerOf, pairCustomer } from "#lib/key-map";
import { websiteSettings } from "#lib/settings";

/**
 * observer.company_save_commit_after: a company created or changed in Commerce becomes the
 * ERP's business partner (lib/company-sync.js). A failure answers 500 so I/O Events
 * delivers the event again.
 */
async function main(params) {
  const logger = AioLogger("company-commerce-saved", {
    level: params.LOG_LEVEL || "info",
  });
  const company = params.data?.value ?? params.data ?? {};
  const companyId = Number(company.id);
  if (!(Number.isInteger(companyId) && companyId > 0)) {
    return badRequest("the company event carries no company id");
  }
  try {
    const partner = await companyToErp(
      params,
      companyId,
      originOf(COMMERCE_EVENTS.companySaved, params),
      {
        erpCustomerOf,
        importRecords: erp.importRecords,
        listWebsites,
        pairCustomer,
        readCompanyRow,
        websiteSettings: (code) => websiteSettings(code, logger),
      },
    );
    return ok(`Company ${companyId} is business partner ${partner.id}`);
  } catch (error) {
    logger.error(`company ${companyId} not sent: ${error.message}`);
    return internalServerError(error.message);
  }
}

export { main };
