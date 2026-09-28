/*
 * An ERP's own server-to-server credential (AB-16a). Each mock ERP lives in its own Adobe
 * workspace, and its `require-adobe-auth` actions accept machine calls only from that
 * workspace's technical account, so an ERP outside the integration's workspace is called with
 * its own credential: `connection.auth = { clientId, clientSecret, orgId, scopes,
 * technicalAccountId?, technicalAccountEmail? }` on its list entry. No `auth` = the
 * integration's own credential (the first ERP, in the integration's workspace).
 *
 * Demo Builder sends it with the list (`PUT erp/erps`). It is kept in the stored list and never
 * answered back: callers see `{ clientId, orgId, hasSecret }`. A list sent again without an
 * ERP's `auth` keeps the stored one; `auth: null` clears it.
 */

const REQUIRED = ["clientId", "clientSecret", "orgId"];
const OPTIONAL = ["technicalAccountId", "technicalAccountEmail"];

function isFilled(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * @param {unknown} auth `connection.auth` as sent
 * @returns {string|null} the first problem, or null (absent and null are both fine)
 */
export function erpAuthProblem(auth) {
  if (auth === undefined || auth === null) {
    return null;
  }
  if (typeof auth !== "object" || Array.isArray(auth)) {
    return "connection.auth is { clientId, clientSecret, orgId, scopes }";
  }
  const missing = REQUIRED.find((key) => !isFilled(auth[key]));
  if (missing) {
    return `connection.auth.${missing} must be a non-empty string`;
  }
  const { scopes } = auth;
  if (!(Array.isArray(scopes) && scopes.length > 0 && scopes.every(isFilled))) {
    return "connection.auth.scopes must be a list of scope names";
  }
  const wrong = OPTIONAL.find(
    (key) => auth[key] !== undefined && !isFilled(auth[key]),
  );
  return wrong ? `connection.auth.${wrong} must be a non-empty string` : null;
}

/**
 * The credential to store for an entry: the one sent; else, when none was sent, the one stored
 * under its id; `null` clears it.
 * @param {object} entry the entry as sent
 * @param {object[]} stored the list stored before
 * @returns {object|undefined} the credential to keep, or undefined for none
 */
export function authToKeep(entry, stored) {
  const sent = entry.connection?.auth;
  if (sent === null) {
    return;
  }
  if (sent !== undefined) {
    return sent;
  }
  return stored.find((e) => e.id === entry.id)?.connection?.auth ?? undefined;
}

/**
 * An entry as a caller may see it: its credential named, never its secret.
 * @param {object} entry a stored entry
 * @returns {object}
 */
export function redactErp(entry) {
  const auth = entry?.connection?.auth;
  if (!auth) {
    return entry;
  }
  return {
    ...entry,
    connection: {
      ...entry.connection,
      auth: {
        clientId: auth.clientId,
        hasSecret: isFilled(auth.clientSecret),
        orgId: auth.orgId,
      },
    },
  };
}
