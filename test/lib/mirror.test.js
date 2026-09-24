import {
  mirror,
  mirrorPartners,
  PRODUCT_BATCH,
  partnersFrom,
  productsFrom,
} from "#lib/mirror";

const OFFLINE_503 = /503.*offline/u;

describe("Given the mirror", () => {
  test("Then products become products with stock per warehouse, named from the store's sources", () => {
    const rows = productsFrom(
      [
        { listPrice: 10, name: "A", sku: "A1" },
        { listPrice: 3, name: "B", sku: "B1" },
        { listPrice: 5, sku: "" },
      ],
      new Map([
        [
          "A1",
          [
            { code: "default", quantity: 7 },
            { code: "austin_dc", quantity: 2 },
          ],
        ],
      ]),
      new Map([["default", "Default Source"]]),
    );
    expect(rows).toEqual([
      {
        listPrice: 10,
        name: "A",
        sku: "A1",
        type: "simple",
        warehouses: [
          { code: "default", name: "Default Source", quantity: 7 },
          // A source the store did not name is named by its code.
          { code: "austin_dc", name: "austin_dc", quantity: 2 },
        ],
      },
      { listPrice: 3, name: "B", sku: "B1", type: "simple", warehouses: [] },
    ]);
  });

  test("Then a configurable product becomes a parent, and its variants name it and the values they vary on", () => {
    const attributes = new Map([
      [
        "93",
        {
          code: "color",
          label: "Color",
          options: new Map([["41", "Silver"]]),
        },
      ],
    ]);
    const rows = productsFrom(
      [
        {
          childIds: [11, 12, 999],
          id: 10,
          listPrice: 0,
          name: "Phone",
          optionAttributeIds: ["93", "142"],
          sku: "PH",
          typeId: "configurable",
        },
        {
          customAttributes: { color: "41" },
          id: 11,
          listPrice: 799,
          name: "Phone Silver",
          sku: "PH-S",
          typeId: "simple",
        },
        {
          customAttributes: { color: "77" },
          id: 12,
          listPrice: 899,
          name: "Phone Other",
          sku: "PH-O",
          typeId: "simple",
        },
      ],
      new Map([
        ["PH", [{ code: "default", quantity: 0 }]],
        ["PH-S", [{ code: "default", quantity: 4 }]],
      ]),
      new Map([["default", "Default Source"]]),
      attributes,
    );
    expect(rows).toEqual([
      // A parent holds no stock of its own, even where the store lists a source for it.
      {
        listPrice: 0,
        name: "Phone",
        sku: "PH",
        type: "configurable",
        warehouses: [],
      },
      {
        listPrice: 799,
        name: "Phone Silver",
        parentSku: "PH",
        sku: "PH-S",
        type: "simple",
        variantAttributes: [
          { label: "Color", value: "Silver" },
          // An attribute the store did not describe is named by its id, with no value.
          { label: "142", value: "" },
        ],
        warehouses: [{ code: "default", name: "Default Source", quantity: 4 }],
      },
      {
        listPrice: 899,
        name: "Phone Other",
        parentSku: "PH",
        sku: "PH-O",
        type: "simple",
        // An option value the store did not label is shown as stored.
        variantAttributes: [
          { label: "Color", value: "77" },
          { label: "142", value: "" },
        ],
        warehouses: [],
      },
    ]);
  });
  test("Then companies become partners keyed C<id> with their group, credit and email domain", () => {
    const rows = partnersFrom([
      {
        creditLimit: 500,
        customerGroupId: 4,
        email: "buyer@acme.example",
        id: 7,
        name: "Acme",
      },
    ]);
    expect(rows).toEqual([
      {
        blocked: false,
        commerceCompanyId: "7",
        creditLimit: 500,
        customerGroupId: "4",
        emailDomain: "acme.example",
        id: "C7",
        legalAddress: null,
        legalName: null,
        name: "Acme",
        resellerId: null,
        salesOrgs: [],
        vatTaxId: null,
        website: null,
      },
    ]);
  });
  // Business structure: the company admin's website names the sales organisation the
  // company buys through; the legal identity rides along for the customer document.
  test("Then a company's admin website gives its sales organisation, and its legal identity comes with it", () => {
    const rows = partnersFrom(
      [
        {
          id: 7,
          legalAddress: {
            city: "Austin",
            countryId: "US",
            postcode: "78701",
            region: "TX",
            street: ["1 Main St"],
            telephone: null,
          },
          legalName: "Acme Trading LLC",
          name: "Acme",
          resellerId: "R-77",
          vatTaxId: "US12-3456789",
          websiteId: 2,
        },
        { id: 8, name: "Nowhere Ltd", websiteId: 9 },
      ],
      [
        { code: "base", id: 1 },
        { code: "eu", id: 2 },
      ],
      new Map([[2, "2000"]]),
    );
    expect(rows[0]).toMatchObject({
      legalAddress: {
        city: "Austin",
        countryId: "US",
        postcode: "78701",
        region: "TX",
        street: ["1 Main St"],
        telephone: null,
      },
      legalName: "Acme Trading LLC",
      resellerId: "R-77",
      salesOrgs: ["2000"],
      vatTaxId: "US12-3456789",
      website: { code: "eu", id: 2 },
    });
    // A website the read did not list: the company belongs to no sales organisation yet.
    expect(rows[1]).toMatchObject({ salesOrgs: [], website: null });
  });
  test("Then a mirror asks the store once for each attribute its configurable products vary on", async () => {
    const readers = {
      listCompanies: vi.fn(async () => []),
      listProducts: vi.fn(async () => [
        { id: 1, optionAttributeIds: ["93"], sku: "A", typeId: "configurable" },
        {
          id: 2,
          optionAttributeIds: ["93", "142"],
          sku: "B",
          typeId: "configurable",
        },
        { id: 3, optionAttributeIds: [], sku: "C", typeId: "simple" },
      ]),
      listStock: vi.fn(async () => new Map()),
      listVariantAttributes: vi.fn(async () => new Map()),
    };
    const erp = {
      importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    };
    await mirror({ key: 1 }, readers, erp, "Demo");
    expect(readers.listVariantAttributes).toHaveBeenCalledExactlyOnceWith(
      { key: 1 },
      ["93", "142"],
    );
  });

  test("Then a mirror reads all three, imports partners, then products, and reports each step", async () => {
    const readers = {
      listCompanies: vi.fn(async () => [{ id: 1, name: "One" }]),
      listProducts: vi.fn(async () => [{ listPrice: 1, name: "P", sku: "P1" }]),
      listSources: vi.fn(async () => new Map([["default", "Default Source"]])),
      listStock: vi.fn(
        async () => new Map([["P1", [{ code: "default", quantity: 2 }]]]),
      ),
    };
    const erp = {
      importRecords: vi.fn(async (_params, body) => ({
        data: body.products
          ? { products: { created: 1, updated: 0 } }
          : { partners: { created: 1, updated: 0 } },
        ok: true,
        status: 200,
      })),
    };
    const steps = [];
    const result = await mirror({}, readers, erp, "Demo", (step) => {
      steps.push(step);
      return Promise.resolve();
    });
    expect(erp.importRecords.mock.calls.map(([, body]) => body)).toEqual([
      {
        partners: [
          {
            blocked: false,
            commerceCompanyId: "1",
            creditLimit: undefined,
            customerGroupId: undefined,
            emailDomain: undefined,
            id: "C1",
            legalAddress: null,
            legalName: null,
            name: "One",
            resellerId: null,
            salesOrgs: [],
            vatTaxId: null,
            website: null,
          },
        ],
        projectName: "Demo",
      },
      {
        products: [
          {
            listPrice: 1,
            name: "P",
            sku: "P1",
            type: "simple",
            warehouses: [
              { code: "default", name: "Default Source", quantity: 2 },
            ],
          },
        ],
      },
    ]);
    expect(steps).toEqual([
      { phase: "reading", state: "running" },
      {
        partners: { done: 0, total: 1 },
        phase: "partners",
        products: { done: 0, total: 1 },
        state: "running",
      },
      {
        partners: { done: 1, total: 1 },
        phase: "products",
        products: { done: 0, total: 1 },
        state: "running",
      },
      { phase: "products", products: { done: 1, total: 1 }, state: "running" },
    ]);
    expect(result).toEqual({
      counts: { companies: 1, products: 1, skipped: 0 },
      partners: { created: 1, updated: 0 },
      products: { created: 1, updated: 0 },
    });
  });

  test("Then products go in batches, each well under the request limit, and the counts add up", async () => {
    const catalog = Array.from({ length: 450 }, (_, i) => ({
      listPrice: i,
      name: `P${i}`,
      sku: `P${i}`,
    }));
    const readers = {
      listCompanies: async () => [],
      listProducts: async () => catalog,
      listStock: async () => new Map(),
    };
    const erp = {
      importRecords: vi.fn(async (_params, body) => ({
        data: body.products
          ? { products: { created: body.products.length, updated: 0 } }
          : { partners: { created: 0, updated: 0 } },
        ok: true,
        status: 200,
      })),
    };
    const done = [];
    const result = await mirror({}, readers, erp, undefined, (step) => {
      if (step.products && step.phase === "products") {
        done.push(step.products.done);
      }
      return Promise.resolve();
    });
    const sizes = erp.importRecords.mock.calls
      .map(([, body]) => body.products?.length)
      .filter((n) => n !== undefined);
    // 450 products in batches of PRODUCT_BATCH, the last one short.
    const full = Math.floor(450 / PRODUCT_BATCH);
    expect(sizes).toEqual([
      ...new Array(full).fill(PRODUCT_BATCH),
      ...(450 % PRODUCT_BATCH ? [450 % PRODUCT_BATCH] : []),
    ]);
    // One report per batch, so the screen's count moves as the import runs.
    const running = [];
    let sum = 0;
    for (const n of sizes) {
      sum += n;
      running.push(sum);
    }
    expect(done).toEqual([0, ...running]);
    expect(result.products).toEqual({ created: 450, updated: 0 });
  });

  test("Then an empty catalog still sends one products import, which stamps the full import", async () => {
    const readers = {
      listCompanies: async () => [],
      listProducts: async () => [],
      listStock: async () => new Map(),
    };
    const erp = {
      importRecords: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    };
    await mirror({}, readers, erp);
    expect(erp.importRecords.mock.calls.map(([, body]) => body)).toEqual([
      { partners: [], projectName: undefined },
      { products: [] },
    ]);
  });

  test("Then an ERP refusal is an error, not a silent success", async () => {
    const readers = {
      listCompanies: async () => [],
      listProducts: async () => [],
      listStock: async () => new Map(),
    };
    const erp = {
      importRecords: async () => ({
        data: { errorMessage: "offline" },
        ok: false,
        status: 503,
      }),
    };
    await expect(mirror({}, readers, erp)).rejects.toThrow(OFFLINE_503);
  });
});

describe("Given the every-minute partner refresh", () => {
  test("Then it sends partners only, so the ERP's last full import time does not move", async () => {
    const importRecords = vi.fn(async () => ({
      data: { partners: { created: 1, updated: 0 } },
      ok: true,
      status: 200,
    }));
    await mirrorPartners(
      {},
      { listCompanies: async () => [{ id: 7, name: "Acme" }] },
      { importRecords },
    );
    const [, body] = importRecords.mock.calls[0];
    expect(Object.keys(body)).toEqual(["partners"]);
  });
});

describe("Given the business structure in a mirror", () => {
  const readers = {
    listCompanies: async () => [{ id: 7, name: "Acme", websiteId: 1 }],
    listProducts: async () => [
      {
        customAttributes: { erp_owner: "ACME" },
        id: 1,
        listPrice: 1,
        name: "Ours",
        sku: "A",
        typeId: "simple",
      },
      {
        customAttributes: { erp_owner: "NW" },
        id: 2,
        listPrice: 1,
        name: "Theirs",
        sku: "B",
        typeId: "simple",
      },
      {
        customAttributes: {},
        id: 3,
        listPrice: 1,
        name: "East only",
        sku: "C",
        typeId: "simple",
      },
    ],
    listSources: async () =>
      new Map([
        ["default", "Default Source"],
        ["east", "East DC"],
      ]),
    listStock: async () =>
      new Map([
        ["A", [{ code: "default", quantity: 1 }]],
        ["B", [{ code: "default", quantity: 1 }]],
        ["C", [{ code: "east", quantity: 1 }]],
      ]),
    listWebsites: async () => [
      { code: "base", id: 1, name: "Main" },
      { code: "eu", id: 2, name: "Europe" },
    ],
    storeConfigs: async () =>
      new Map([
        [1, { currency: "USD", locale: "en_US" }],
        [2, { currency: "EUR", locale: "de_DE" }],
      ]),
    websiteSettings: async (code) =>
      code === "eu"
        ? { structure_sales_org: "2000", structure_sales_org_name: "Online EU" }
        : {},
  };
  const erp = () => ({
    importRecords: vi.fn(async () => ({
      data: { partners: {}, products: {} },
      ok: true,
      status: 200,
    })),
  });

  test("Then the partners import carries the structure block and each partner's sales organisation", async () => {
    const client = erp();
    await mirror({}, readers, client, "Demo");
    const [, partnersBody] = client.importRecords.mock.calls[0];
    expect(
      partnersBody.structure.websites.map((w) => [
        w.code,
        w.salesOrg,
        w.salesOrgName,
        w.storeInfo.currency,
      ]),
    ).toEqual([
      ["base", "1000", null, "USD"],
      ["eu", "2000", "Online EU", "EUR"],
    ]);
    expect(partnersBody.partners[0]).toMatchObject({
      salesOrgs: ["1000"],
      website: { code: "base", id: 1 },
    });
  });
  test("Then only the products this ERP owns are sent, by attribute or by source, and the count says what was left out", async () => {
    const byAttribute = erp();
    const result = await mirror({}, readers, byAttribute, "Demo", undefined, {
      structure_owns: "attribute",
      structure_owns_attribute: "erp_owner=ACME",
    });
    const sent = byAttribute.importRecords.mock.calls
      .slice(1)
      .flatMap(([, body]) => body.products ?? [])
      .map((p) => p.sku);
    expect(sent).toEqual(["A"]);
    expect(result.counts).toMatchObject({
      owns: "products whose erp_owner is ACME",
      products: 3,
      skipped: 2,
    });
    const bySource = erp();
    await mirror({}, readers, bySource, "Demo", undefined, {
      structure_owns: "sources",
      structure_owns_sources: "east",
    });
    expect(
      bySource.importRecords.mock.calls
        .slice(1)
        .flatMap(([, body]) => body.products ?? [])
        .map((p) => p.sku),
    ).toEqual(["C"]);
    const all = erp();
    const everything = await mirror({}, readers, all, "Demo");
    expect(everything.counts.skipped).toBe(0);
    expect(everything.counts.owns).toBeUndefined();
  });
  test("Then the minute partner refresh carries the same sales organisations", async () => {
    const client = erp();
    await mirrorPartners({}, readers, client);
    const [, body] = client.importRecords.mock.calls[0];
    expect(Object.keys(body)).toEqual(["partners"]);
    expect(body.partners[0].salesOrgs).toEqual(["1000"]);
  });
});
