/*
 * An ERP outside the integration's workspace carries its own server-to-server credential
 * (`connection.auth`, AB-16a). It is checked when Demo Builder sends it, kept in the stored
 * list, and never answered back: the redacted entry names the client and org, not the secret.
 */
import { redactErp } from "#lib/erp-auth";
import {
  erpsProblem,
  readStoredErps,
  replaceErps,
  resetErpsClient,
} from "#lib/erps";

function memoryState() {
  const store = new Map();
  return {
    get: async (k) => (store.has(k) ? { value: store.get(k) } : undefined),
    put: async (k, v) => store.set(k, v),
  };
}

const SECRET = "fake-test-secret-not-a-secret";
const AUTH = {
  clientId: "contoso-client",
  clientSecret: SECRET,
  orgId: "ORG1@AdobeOrg",
  scopes: ["AdobeID", "openid"],
};
const FIRST = {
  adapter: "demo-erp",
  connection: { baseUrl: "https://a.example/api/v1/web/demo-erp" },
  id: "erp",
  name: "Northwind ERP",
};
const CONTOSO = {
  adapter: "demo-erp",
  connection: { auth: AUTH, baseUrl: "https://b.example/api/v1/web/demo-erp" },
  id: "demo-erp-2",
  name: "Contoso ERP",
};

beforeEach(() => {
  resetErpsClient(memoryState());
});

describe("Given an ERP entry with its own credential", () => {
  test("Then a well-formed credential, with or without the technical account, has no problem", () => {
    expect(erpsProblem([FIRST, CONTOSO])).toBeNull();
    const full = {
      ...AUTH,
      technicalAccountEmail: "tech@techacct.adobe.com",
      technicalAccountId: "TA1@techacct.adobe.com",
    };
    expect(
      erpsProblem([
        { ...CONTOSO, connection: { ...CONTOSO.connection, auth: full } },
      ]),
    ).toBeNull();
  });

  test.each([
    ["not an object", "creds"],
    ["an empty client id", { ...AUTH, clientId: " " }],
    ["no client secret", { ...AUTH, clientSecret: undefined }],
    ["an org that is not a string", { ...AUTH, orgId: 7 }],
    ["scopes that are not a list", { ...AUTH, scopes: "AdobeID" }],
    ["no scopes", { ...AUTH, scopes: [] }],
    ["a scope that is not a string", { ...AUTH, scopes: ["AdobeID", 3] }],
    [
      "a technical account id that is not a string",
      { ...AUTH, technicalAccountId: 1 },
    ],
  ])("Then %s is refused", (_label, auth) => {
    const entry = { ...CONTOSO, connection: { ...CONTOSO.connection, auth } };
    expect(erpsProblem([entry])).toContain("entry 0: connection.auth");
  });

  test("Then auth: null is accepted, as the way to clear a stored credential", () => {
    const entry = {
      ...CONTOSO,
      connection: { ...CONTOSO.connection, auth: null },
    };
    expect(erpsProblem([entry])).toBeNull();
  });
});

describe("Given the stored list", () => {
  test("Then the credential is kept with its ERP", async () => {
    await replaceErps([FIRST, CONTOSO]);
    const [first, contoso] = await readStoredErps();
    expect(first.connection).toEqual({ baseUrl: FIRST.connection.baseUrl });
    expect(contoso.connection.auth).toEqual(AUTH);
  });

  test("Then a list sent again without the credential keeps the stored one", async () => {
    await replaceErps([FIRST, CONTOSO]);
    const resent = {
      ...CONTOSO,
      connection: { baseUrl: CONTOSO.connection.baseUrl },
    };
    await replaceErps([FIRST, resent]);
    expect((await readStoredErps())[1].connection.auth).toEqual(AUTH);
  });

  test("Then auth: null clears the stored credential", async () => {
    await replaceErps([FIRST, CONTOSO]);
    await replaceErps([
      FIRST,
      { ...CONTOSO, connection: { ...CONTOSO.connection, auth: null } },
    ]);
    expect((await readStoredErps())[1].connection).toEqual({
      baseUrl: CONTOSO.connection.baseUrl,
    });
  });

  test("Then a removed ERP's credential goes with it, and re-adding it does not bring it back", async () => {
    await replaceErps([FIRST, CONTOSO]);
    await replaceErps([FIRST]);
    const readded = {
      ...CONTOSO,
      connection: { baseUrl: CONTOSO.connection.baseUrl },
    };
    await replaceErps([FIRST, readded]);
    expect(JSON.stringify(await readStoredErps())).not.toContain(SECRET);
  });
});

describe("Given an entry answered to a caller", () => {
  test("Then the credential is named by client and org, and the secret is not in it", () => {
    const shown = redactErp(CONTOSO);
    expect(shown.connection).toEqual({
      auth: {
        clientId: "contoso-client",
        hasSecret: true,
        orgId: "ORG1@AdobeOrg",
      },
      baseUrl: CONTOSO.connection.baseUrl,
    });
    expect(JSON.stringify(shown)).not.toContain(SECRET);
  });

  test("Then an entry without a credential is answered as it is", () => {
    expect(redactErp(FIRST)).toEqual(FIRST);
  });
});
