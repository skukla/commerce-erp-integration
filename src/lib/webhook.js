/*
 * Reading the body Runtime hands a web action (the integration's own erp/* actions, which
 * Demo Builder and the Admin screen call). The cart webhooks that also shared this file were
 * removed with AB-26z: no ERP is asked on a cart change.
 */

/** The whole request body, whichever of Runtime's three shapes it arrived in. */
export function readPayload(params) {
  if (typeof params.__ow_body === "string" && params.__ow_body.length > 0) {
    try {
      return JSON.parse(params.__ow_body);
    } catch {
      try {
        return JSON.parse(
          Buffer.from(params.__ow_body, "base64").toString("utf8"),
        );
      } catch {
        return {};
      }
    }
  }
  return params;
}
