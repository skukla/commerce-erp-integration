/**
 * discontinue-elsewhere (Demo Builder AB-70): after a product went to its owner, the other
 * listed ERPs that still carry it are told it is discontinued, and the owner, if it had
 * discontinued the product itself, is told it is sellable again. Asserted on the ERP calls
 * each is handed (its own params, the SKU, the PATCH body) and on what is left alone.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("#lib/erp", () => ({
  erp: { patchProduct: vi.fn(), product: vi.fn() },
}));

import {
  discontinueElsewhere,
  restoreAtOwner,
} from "#lib/discontinue-elsewhere";
import { erp } from "#lib/erp";

const ERPS = [
  {
    connection: { baseUrl: "https://a.example/erp" },
    id: "justrite",
    name: "Justrite ERP",
  },
  {
    connection: { baseUrl: "https://b.example/erp" },
    id: "kukla",
    name: "Kukla ERP",
  },
  {
    connection: { baseUrl: "https://c.example/erp" },
    id: "acme",
    name: "Acme ERP",
  },
];
const PARAMS = { ERP_BASE_URL: "https://x.example/erp", LOG_LEVEL: "info" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Given a product that now belongs to one of several ERPs", () => {
  test("Then every other ERP holding it, not yet discontinued, is told so at its own address", async () => {
    erp.product.mockImplementation(async (params) =>
      params.ERP_BASE_URL === "https://b.example/erp"
        ? {
            data: { salesStatus: "sellable", sku: "W1", type: "simple" },
            ok: true,
            status: 200,
          }
        : { data: {}, ok: false, status: 404 },
    );
    erp.patchProduct.mockResolvedValue({ data: {}, ok: true, status: 200 });

    const done = await discontinueElsewhere(PARAMS, "W1", "justrite", ERPS);

    expect(done).toEqual(["kukla"]);
    expect(erp.product).toHaveBeenCalledTimes(2);
    expect(erp.patchProduct).toHaveBeenCalledTimes(1);
    expect(erp.patchProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ERP_BASE_URL: "https://b.example/erp",
        ERP_DISPLAY_NAME: "Kukla ERP",
      }),
      "W1",
      { salesStatus: "discontinued" },
    );
  });

  test("Then one already discontinued, or a configurable parent, is left alone", async () => {
    erp.product.mockImplementation((params) => ({
      data:
        params.ERP_BASE_URL === "https://b.example/erp"
          ? { salesStatus: "discontinued", sku: "W1", type: "simple" }
          : { sku: "W1", type: "configurable" },
      ok: true,
      status: 200,
    }));

    expect(await discontinueElsewhere(PARAMS, "W1", "justrite", ERPS)).toEqual(
      [],
    );
    expect(erp.patchProduct).not.toHaveBeenCalled();
  });

  test("Then an ERP that refuses, or cannot be asked, is logged and the rest go on", async () => {
    const logger = { warn: vi.fn() };
    erp.product.mockImplementation((params) => {
      if (params.ERP_BASE_URL === "https://b.example/erp") {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return {
        data: { salesStatus: "sellable", sku: "W1", type: "simple" },
        ok: true,
        status: 200,
      };
    });
    erp.patchProduct.mockResolvedValue({
      data: { error: "salesStatus must be sellable or blocked" },
      ok: false,
      status: 400,
    });

    expect(
      await discontinueElsewhere(PARAMS, "W1", "justrite", ERPS, logger),
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Kukla ERP: W1 could not be discontinued (ECONNRESET)",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Acme ERP: W1 could not be discontinued (400: salesStatus must be sellable or blocked)",
    );
  });

  test("Then with one ERP nothing is asked", async () => {
    expect(await discontinueElsewhere(PARAMS, "W1", "erp", [ERPS[0]])).toEqual(
      [],
    );
    expect(erp.product).not.toHaveBeenCalled();
  });
});

describe("Given a product that came back to an ERP that had discontinued it", () => {
  const held = (salesStatus) => ({
    data: { salesStatus, sku: "W1", type: "simple" },
    ok: true,
    status: 200,
  });

  test("Then the owner, holding it discontinued, is told it is sellable at its own address", async () => {
    erp.product.mockResolvedValue(held("discontinued"));
    erp.patchProduct.mockResolvedValue({ data: {}, ok: true, status: 200 });

    expect(await restoreAtOwner(PARAMS, "W1", "kukla", ERPS)).toEqual([
      "kukla",
    ]);
    expect(erp.product).toHaveBeenCalledTimes(1);
    expect(erp.product).toHaveBeenCalledWith(
      expect.objectContaining({ ERP_BASE_URL: "https://b.example/erp" }),
      "W1",
    );
    expect(erp.patchProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        ERP_BASE_URL: "https://b.example/erp",
        ERP_DISPLAY_NAME: "Kukla ERP",
      }),
      "W1",
      { salesStatus: "sellable" },
    );
  });

  test("Then one sellable, blocked (the ERP's own decision) or unknown there is left alone", async () => {
    for (const answer of [
      held("sellable"),
      held("blocked"),
      { data: {}, ok: false, status: 404 },
    ]) {
      erp.product.mockResolvedValue(answer);
      // biome-ignore lint/performance/noAwaitInLoops: one answer at a time
      expect(await restoreAtOwner(PARAMS, "W1", "kukla", ERPS)).toEqual([]);
    }
    expect(erp.patchProduct).not.toHaveBeenCalled();
  });

  test("Then an owner that refuses, or cannot be asked, is logged and nothing is restored", async () => {
    const logger = { warn: vi.fn() };
    erp.product.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await restoreAtOwner(PARAMS, "W1", "kukla", ERPS, logger)).toEqual(
      [],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Kukla ERP: W1 could not be restored (ECONNRESET)",
    );

    erp.product.mockResolvedValue(held("discontinued"));
    erp.patchProduct.mockResolvedValue({
      data: { error: "salesStatus must be sellable or blocked" },
      ok: false,
      status: 400,
    });
    expect(await restoreAtOwner(PARAMS, "W1", "kukla", ERPS, logger)).toEqual(
      [],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Kukla ERP: W1 could not be restored (400: salesStatus must be sellable or blocked)",
    );
  });

  test("Then with one ERP nothing is asked", async () => {
    expect(await restoreAtOwner(PARAMS, "W1", "erp", [ERPS[0]])).toEqual([]);
    expect(erp.product).not.toHaveBeenCalled();
  });
});
