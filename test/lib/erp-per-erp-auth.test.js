/*
 * An ERP outside the integration's workspace is called with its OWN credential (AB-16a):
 * Adobe's `require-adobe-auth` check refuses a token from another workspace's technical account
 * ("Technical account mismatch"). The real resolveImsAuthParams runs, so these tests hold the
 * param names it reads; only the token mint is replaced, to see which credential it is given.
 */
vi.mock("@adobe/aio-commerce-sdk/auth", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImsAuthProvider: vi.fn((auth) => ({
      getHeaders: async () => ({
        Authorization: `Bearer token-for-${auth.clientId}`,
        "x-api-key": auth.clientId,
      }),
    })),
  };
});

import { getImsAuthProvider } from "@adobe/aio-commerce-sdk/auth";

import { paramsForErp } from "#adapters/contract";
import { erp, resetErpTokenCache } from "#lib/erp";
import { stringParameters } from "#lib/utils";

const SECRET = "fake-test-secret-not-a-secret";
const OWN = {
  AIO_COMMERCE_AUTH_IMS_CLIENT_ID: "integration-client",
  AIO_COMMERCE_AUTH_IMS_CLIENT_SECRETS: '["fake-test-pw-not-a-secret"]',
  AIO_COMMERCE_AUTH_IMS_ORG_ID: "ORG0@AdobeOrg",
  AIO_COMMERCE_AUTH_IMS_SCOPES: '["AdobeID","openid"]',
  AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_EMAIL: "own@techacct.adobe.com",
  AIO_COMMERCE_AUTH_IMS_TECHNICAL_ACCOUNT_ID: "OWN@techacct.adobe.com",
  ERP_BASE_URL: "https://a.example/api/v1/web/demo-erp",
};
const FIRST = {
  adapter: "demo-erp",
  connection: { baseUrl: "https://a.example/api/v1/web/demo-erp" },
  id: "erp",
  name: "Northwind ERP",
};
const CONTOSO = {
  adapter: "demo-erp",
  connection: {
    auth: {
      clientId: "contoso-client",
      clientSecret: SECRET,
      orgId: "ORG1@AdobeOrg",
      scopes: ["AdobeID", "openid", "adobeio_api"],
    },
    baseUrl: "https://b.example/api/v1/web/demo-erp",
  },
  id: "demo-erp-2",
  name: "Contoso ERP",
};

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  text: async () => "{}",
}));

beforeEach(() => {
  resetErpTokenCache();
  getImsAuthProvider.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe("Given an ERP added with its own credential", () => {
  test("Then its token is minted from ITS client, secret, org and scopes", async () => {
    await erp.health(paramsForErp(OWN, CONTOSO));
    expect(getImsAuthProvider).toHaveBeenCalledTimes(1);
    expect(getImsAuthProvider.mock.calls[0][0]).toMatchObject({
      clientId: "contoso-client",
      clientSecrets: [SECRET],
      imsOrgId: "ORG1@AdobeOrg",
      scopes: ["AdobeID", "openid", "adobeio_api"],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://b.example/api/v1/web/demo-erp/health");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token-for-contoso-client",
      "x-gw-ims-org-id": "ORG1@AdobeOrg",
    });
  });

  test("Then its token is cached apart from the integration's, in its own IMS context", async () => {
    await erp.health(paramsForErp(OWN, FIRST));
    await erp.health(paramsForErp(OWN, CONTOSO));
    await erp.health(paramsForErp(OWN, FIRST));
    await erp.health(paramsForErp(OWN, CONTOSO));
    const minted = getImsAuthProvider.mock.calls.map(([auth]) => [
      auth.clientId,
      auth.context,
    ]);
    expect(minted).toEqual([
      ["integration-client", undefined],
      ["contoso-client", "erp-contoso-client"],
    ]);
    expect(
      fetchMock.mock.calls.map(([, init]) => init.headers.Authorization),
    ).toEqual([
      "Bearer token-for-integration-client",
      "Bearer token-for-contoso-client",
      "Bearer token-for-integration-client",
      "Bearer token-for-contoso-client",
    ]);
  });

  test("Then its technical account is used when it names one", async () => {
    const named = {
      ...CONTOSO,
      connection: {
        ...CONTOSO.connection,
        auth: {
          ...CONTOSO.connection.auth,
          technicalAccountEmail: "contoso@techacct.adobe.com",
          technicalAccountId: "CONTOSO@techacct.adobe.com",
        },
      },
    };
    await erp.health(paramsForErp(OWN, named));
    expect(getImsAuthProvider.mock.calls[0][0]).toMatchObject({
      technicalAccountEmail: "contoso@techacct.adobe.com",
      technicalAccountId: "CONTOSO@techacct.adobe.com",
    });
  });

  test("Then its params printed for a log hide the secret", () => {
    expect(stringParameters(paramsForErp(OWN, CONTOSO))).not.toContain(SECRET);
  });
});

describe("Given an ERP without a credential of its own", () => {
  test("Then it is called with the integration's own credential", async () => {
    await erp.health(paramsForErp(OWN, FIRST));
    expect(getImsAuthProvider.mock.calls[0][0]).toMatchObject({
      clientId: "integration-client",
      imsOrgId: "ORG0@AdobeOrg",
    });
    expect(paramsForErp(OWN, FIRST)).toEqual({
      ...OWN,
      ERP_DISPLAY_NAME: "Northwind ERP",
    });
  });
});
