/**
 * Nothing to do before sending a product to the ERP; the kit's chain keeps the hook.
 *
 * @param {object} _params - the action params
 * @param {object} _transformed - the transformed data
 */
function preProcess(_params, _transformed) {
  // The kit's chain calls this hook; the ERP integration has nothing to do here.
}

export { preProcess };
