/**
 * Who may post ERP events here: the action is `require-adobe-auth`, so Runtime has already
 * checked an IMS token from this organisation before this runs. The ERP mints that token
 * from its own workspace credential; nothing else is shared between the two apps.
 *
 * @returns {{ success: boolean, message?: string }}
 */
function checkAuthentication() {
  return { success: true };
}

export { checkAuthentication };
