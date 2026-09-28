// biome-ignore-all lint/suspicious/useAwait: stand-ins answer promises without waiting on anything
/*
 * The AB-16a harness for "which ERP did this call reach, and with whose credential?", shared
 * by the AB-16h tests. The real ERP client (lib/erp.js) runs and the real resolveImsAuthParams
 * reads the params; only the token mint and fetch are replaced. The mint writes the client id
 * into the bearer token, so each recorded call names the client its token was minted for.
 *
 * Use it in a test file with:
 *   vi.mock("@adobe/aio-commerce-sdk/auth", async (original) =>
 *     (await import("<path>/per-erp-harness.js")).mintPerClient(original));
 */

/** The auth module with the token mint replaced: a token names the client it was minted for. */
export async function mintPerClient(importOriginal) {
  const actual = await importOriginal();
  return {
    ...actual,
    getImsAuthProvider: (auth) => ({
      getHeaders: async () => ({
        Authorization: `Bearer token-for-${auth.clientId}`,
        "x-api-key": auth.clientId,
      }),
    }),
  };
}

/** The integration's own params: its credential, and the first ERP's address. */
export const OWN = Object.freeze({
  AIO_COMMERCE_AUTH_IMS_CLIENT_ID: "integration-client",
  AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: '["fake-test-pw-not-a-secret"]',
  AIO_COMMERCE_AUTH_IMS_ORG_ID: "ORG0@AdobeOrg",
  AIO_COMMERCE_AUTH_IMS_SCOPES: '["AdobeID","openid"]',
  AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_EMAIL: "own@techacct.adobe.com",
  AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_ID: "OWN@techacct.adobe.com",
  ERP_BASE_URL: "https://a.example/api/v1/web/demo-erp",
});

/** The first ERP: in the integration's workspace, so it signs with the integration's client. */
export const NORTHWIND = Object.freeze({
  adapter: "demo-erp",
  connection: { baseUrl: "https://a.example/api/v1/web/demo-erp" },
  id: "erp",
  name: "Northwind ERP",
});

/** A second ERP in another workspace, with its own address and credential. */
export const CONTOSO = Object.freeze({
  adapter: "demo-erp",
  connection: {
    auth: {
      clientId: "contoso-client",
      clientSecret: "fake-test-secret-not-a-secret",
      orgId: "ORG1@AdobeOrg",
      scopes: ["AdobeID", "openid"],
    },
    baseUrl: "https://b.example/api/v1/web/demo-erp",
  },
  id: "contoso",
  name: "Contoso ERP",
});

export const BOTH = Object.freeze([NORTHWIND, CONTOSO]);

const BEARER = /^Bearer token-for-/u;

/**
 * A fetch stand-in that records each call and answers with `answer(url, init)`, a
 * `{ status, body }` (200 and `{}` when it answers nothing).
 * @param {(url: string, init: object) => ({ status?: number, body?: object }|undefined)} [answer]
 */
export function erpFetch(answer = () => undefined) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      client: String(init.headers.Authorization).replace(BEARER, ""),
      method: init.method,
      url,
    });
    const { status = 200, body = {} } = answer(url, init) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
  return { calls, fetch };
}
