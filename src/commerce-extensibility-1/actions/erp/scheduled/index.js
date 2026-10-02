import {
  internalServerError,
  ok,
} from "@adobe/aio-commerce-sdk/core/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { describePublish, publishPrices } from "#lib/publish-prices";
import { dueMoment, SCHEDULED_JOBS, scheduleOf } from "#lib/schedule";
import { claimDueMoment, recordScheduledRun } from "#lib/scheduled-runs";
import { settingsFor } from "#lib/settings";

/** What each scheduled job does, and its one line for the logs. */
const JOBS = Object.freeze({
  // The ERP raises no event when a price line's start or end date arrives, so this run is
  // what makes the date take effect: every ERP's prices in force are published again,
  // exactly as erp/prices does. A publish is a replace that writes only changes.
  prices: { describe: describePublish, run: (params) => publishPrices(params) },
});

/** Run one job if it is due, recording how it ended; never throws. */
async function runIfDue(id, params, settings, now, logger) {
  const schedule = scheduleOf(settings, id);
  let moment;
  try {
    moment = await claimDueMoment(id, (after) =>
      dueMoment(schedule, after, now),
    );
  } catch (error) {
    logger.error(
      `scheduled ${id} not run, its record is unreadable: ${error.message}`,
    );
    return { error: error.message, id, ran: false };
  }
  if (!moment) {
    return { id, ran: false };
  }
  const at = moment.toISOString();
  try {
    const result = await JOBS[id].run(params);
    logger.info(`scheduled ${id} for ${at}: ${JOBS[id].describe(result)}`);
    // The Admin page's Activity shows when this last ran and what it changed.
    await recordScheduledRun(id, result);
    return { id, moment: at, ran: true, result };
  } catch (error) {
    logger.error(`scheduled ${id} for ${at} failed: ${error.message}`);
    await recordScheduledRun(id, { error: error.message });
    return { error: error.message, id, moment: at, ran: true };
  }
}

/**
 * The heartbeat (AB-38), started every five minutes by the erp-schedule-heartbeat alarm
 * (ext.config.yaml). Each job's schedule is a business setting, read at Default Config: on or
 * off, hourly, daily or weekly, in the store's timezone (lib/schedule.js). A job runs when its
 * latest scheduled moment has come and it has not run for it (lib/scheduled-runs.js
 * claimDueMoment), so a business user changes a schedule without a redeploy. A job that fails
 * is recorded failed and runs again at its next moment. Not a web action: a timer carries no
 * Adobe sign-in.
 */
async function main(params) {
  const logger = AioLogger("erp-scheduled", {
    level: params.LOG_LEVEL || "info",
  });
  const now = new Date();
  const settings = await settingsFor(null, logger);
  const jobs = [];
  for (const id of SCHEDULED_JOBS) {
    // biome-ignore lint/performance/noAwaitInLoops: one job at a time, few jobs
    jobs.push(await runIfDue(id, params, settings, now, logger));
  }
  const failed = jobs.filter((job) => job.error);
  if (failed.length > 0) {
    // An error answer, so Runtime keeps the activation as failed.
    return internalServerError(
      failed.map((job) => `${job.id}: ${job.error}`).join("; "),
    );
  }
  return ok({ body: { jobs } });
}

export { main };
