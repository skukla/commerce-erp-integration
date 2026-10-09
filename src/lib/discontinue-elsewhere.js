/*
 * When a product's owner changes, the ERP that used to carry it discontinues it (Demo Builder
 * AB-70). Commerce's product event says only who owns the product NOW (its `erp_owner`, or
 * the websites it is sold on); nothing names the owner it had. So after a product change is
 * sent to its owner, every OTHER listed ERP is asked whether it holds the product
 * (`GET products/:sku`), and one that does, and has not discontinued it, is told to
 * (`PATCH products/:sku { salesStatus: "discontinued" }`, contract version 20). The record
 * stays there, as a real ERP keeps it; it ships nothing.
 *
 * Best-effort, after the send: an ERP that cannot be asked or refuses is logged, and the
 * product's delivery to its owner stands. Nothing to do with one ERP.
 */
import { paramsForErp } from "#adapters/contract";
import { erp } from "#lib/erp";

const DISCONTINUED = "discontinued";
const NOT_FOUND = 404;

/**
 * @param {object} params action params
 * @param {string} sku the product
 * @param {string} ownerId the ERP the product went to
 * @param {import("#adapters/contract").ErpEntry[]} erps the ERP list
 * @param {{ warn: (message: string) => void }} [logger]
 * @returns {Promise<string[]>} the ids of the ERPs that discontinued it now
 */
export async function discontinueElsewhere(params, sku, ownerId, erps, logger) {
  if (erps.length <= 1) {
    return [];
  }
  const done = [];
  for (const entry of erps.filter((e) => e.id !== ownerId)) {
    const to = paramsForErp(params, entry);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one ERP at a time, a handful of them
      const held = await erp.product(to, sku);
      if (held.status === NOT_FOUND) {
        continue;
      }
      if (!held.ok) {
        logger?.warn(
          `${entry.name}: products/${sku} answered ${held.status}; not discontinued there`,
        );
        continue;
      }
      if (
        held.data?.salesStatus === DISCONTINUED ||
        held.data?.type === "configurable"
      ) {
        continue;
      }
      const patched = await erp.patchProduct(to, sku, {
        salesStatus: DISCONTINUED,
      });
      if (patched.ok) {
        done.push(entry.id);
      } else {
        const detail =
          patched.data?.errorMessage ?? patched.data?.error ?? "no detail";
        logger?.warn(
          `${entry.name}: ${sku} could not be discontinued (${patched.status}: ${detail})`,
        );
      }
    } catch (error) {
      logger?.warn(
        `${entry.name}: ${sku} could not be discontinued (${error.message})`,
      );
    }
  }
  return done;
}
