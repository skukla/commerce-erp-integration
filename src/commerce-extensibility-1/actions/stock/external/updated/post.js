/**
 * Nothing to do after the ERP accepted a product; the kit's chain keeps the hook.
 *
 * @param {object} _params - the action params
 * @param {object} _transformed - the transformed data
 * @param {object} _preProcessed - the pre-process result
 * @param {object} _result - the send result
 */
function postProcess(_params, _transformed, _preProcessed, _result) {
  // The kit's chain calls this hook; the ERP integration has nothing to do here.
}

export { postProcess };
