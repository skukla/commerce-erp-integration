import Ajv from "ajv";

import schema from "./schema.json";

/**
 * This function validate the shipment data received from external back-office application
 *
 * @returns the result of validation object
 * @param {object} params - Received data from adobe commerce
 */
function validateData(params) {
  const { data } = params;
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const isValid = validate(data);
  if (!isValid) {
    return {
      message: `Data provided does not validate with the schema: ${JSON.stringify(data)}`,
      success: false,
    };
  }
  // An ERP shipment that names no lines ships nothing here, and says so. An empty item list
  // never reaches Commerce's ship call, which may take it for the whole order (not tried live).
  if (data.items.length === 0) {
    return {
      message: `The ERP's shipment for order ${data.incrementId ?? data.orderId} names no lines; nothing was shipped in Commerce.`,
      success: false,
    };
  }
  return {
    success: true,
  };
}

export { validateData };
