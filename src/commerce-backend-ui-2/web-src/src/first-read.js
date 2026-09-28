/*
 * What the Admin page reads before it draws anything (pages/main-page.jsx): the ERPs' status,
 * the settings (with Commerce's websites read again on every open, owner 2026-09-26), the
 * Activity records and the scheduled runs, all together. Nothing is drawn until all of them are
 * in (owner, 2026-09-27: a half-loaded page showed "the ERP" and "Reading the settings…").
 * Activity that cannot be read leaves the page up, empty, with the reason; a status or settings
 * that cannot be read is the page's failure.
 */

/**
 * @param {object} api the page's api (api.js makeApi, or the preview's stand-in)
 * @param {{ refresh?: boolean }} [options] read Commerce's websites again first
 * @returns {Promise<{ initial: { status: object, settingsPage: object, history: object[],
 *   runs: object[] }, trouble: string|null }>}
 */
export async function readFirst(api, { refresh = true } = {}) {
  const [status, settingsPage, activity] = await Promise.all([
    api.status(),
    api.settings(undefined, { refresh }),
    Promise.all([api.history(false), api.scheduled()]).then(
      ([history, scheduled]) => ({
        history: history.entries ?? [],
        runs: scheduled.scheduled ?? [],
      }),
      (error) => ({ error, history: [], runs: [] }),
    ),
  ]);
  return {
    initial: {
      history: activity.history,
      runs: activity.runs,
      settingsPage,
      status,
    },
    trouble: activity.error
      ? `Activity could not be read: ${activity.error.message}`
      : null,
  };
}
