import { getSystemConfigByKey } from "@adobe/aio-commerce-lib-config";

import { commerceClient } from "#lib/commerce";

/*
 * A custom installation step (App Management runs it after the Eventing step): write this
 * app's Commerce event provider id into Commerce's eventing configuration.
 *
 * Why it exists: the installer in @adobe/aio-commerce-lib-app 2.0.0 configures Commerce
 * eventing with enabled, environment_id, instance_id, merchant_id and workspace_configuration,
 * and never sends provider_id, though it has the provider's id at that moment
 * (configureCommerceEventing in management). Commerce Admin marks the field required, and on
 * the sandbox (2026-09-24) events did not flow until the id was pasted in by hand. The
 * configuration endpoint accepts it: PUT /V1/eventing/updateConfiguration, `provider_id`,
 * every field optional (developer.adobe.com, Commerce eventing REST reference).
 *
 * Only the FIRST copy of the app on a store sets it. There is one field per store and no API
 * to read what it holds, so a second copy would overwrite the first's value. How the field
 * behaves with several providers on one store is not established; keeping it with the first
 * copy is the conservative choice.
 *
 * Reversible: uninstalling the first copy clears the field again.
 */

/** The id the first copy of this app declares (app.commerce.config.ts, copyIdentity). */
export const FIRST_COPY_APP_ID = "commerce-erp-integration";

/** The key the app's Commerce event provider has in app.commerce.config.ts. */
const COMMERCE_PROVIDER_KEY = "commerce";

/** Write `provider_id` into Commerce's eventing configuration. */
async function writeProviderId(params, providerId) {
  const client = await commerceClient(params);
  await client
    .put("eventing/updateConfiguration", {
      json: { config: { provider_id: providerId } },
    })
    .json();
}

/**
 * @param {object} config the app's configuration (its `metadata.id` says which copy this is)
 * @param {{ params: object, logger: object }} context the installation context
 * @returns {Promise<{ providerId?: string, skipped?: string }>} what the step did
 */
export async function install(config, context) {
  const { logger, params } = context;
  if (config?.metadata?.id !== FIRST_COPY_APP_ID) {
    logger.info(
      `Event provider id left as it is: ${config?.metadata?.id} is not the first copy on this store.`,
    );
    return { skipped: "not the first copy" };
  }
  const stored = await getSystemConfigByKey("events");
  const providerId = stored?.providers?.[COMMERCE_PROVIDER_KEY]?.id;
  if (!providerId) {
    throw new Error(
      "No Commerce event provider was recorded by the Eventing step, so there is no id to set.",
    );
  }
  await writeProviderId(params, providerId);
  logger.info(`Commerce eventing now names event provider ${providerId}.`);
  return { providerId };
}

/**
 * Clears the provider id the first copy set, so removing the app leaves the field as a fresh
 * store has it.
 *
 * @param {object} config the app's configuration
 * @param {{ params: object, logger: object }} context the installation context
 */
export async function uninstall(config, context) {
  const { logger, params } = context;
  if (config?.metadata?.id !== FIRST_COPY_APP_ID) {
    return;
  }
  await writeProviderId(params, "");
  logger.info("Commerce eventing's event provider id cleared.");
}
