/*
 * What the Admin page shows when drawing it throws. Without this the Admin frame stays
 * blank, with no clue what broke. The page is only a view: the integration's actions run
 * apart from it, so a crash here stops nothing that crosses to or from the ERP.
 */

/**
 * @param {unknown} error what was thrown
 * @returns {{title: string, body: string, details: string}} the words the crash screen shows
 */
export function crashReport(error) {
  return {
    body: "The integration keeps running: orders and updates still cross. Reload the page to try again.",
    details: errorDetails(error),
    title: "This page hit an error",
  };
}

function errorDetails(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return error === undefined ? "No details were given." : String(error);
}
