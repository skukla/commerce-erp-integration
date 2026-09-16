/*
 * The mirror as an action runs it: Commerce's readers, the ERP client, the project
 * name. Shared by `erp/mirror` (inline) and `erp/mirror-job` (the background worker)
 * so the two cannot differ about what a mirror is.
 */
import { listCompanies, listProducts, listStock } from "#lib/commerce";
import { erp } from "#lib/erp";
import { mirror } from "#lib/mirror";

/** @returns {Promise<object>} the mirror's result */
export function runMirror(params) {
  return mirror(
    params,
    { listCompanies, listProducts, listStock },
    erp,
    params.projectName,
  );
}
