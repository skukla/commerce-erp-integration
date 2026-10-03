/*
 * A product deleted in Commerce, with several ERPs (slice B7): the delete goes only to the ERP
 * that owns the product, by the router's ownership rule (router/ownership.js). The product is
 * already gone from Commerce, so its owner is read from the event, which carries `erp_owner`.
 * An event that does not carry it cannot name the owner, so every ERP is told (an ERP that
 * never had the SKU answers 404, which is nothing to do).
 */
vi.mock("#lib/erp", () => ({
  erp: { deleteProduct: vi.fn() },
}));
vi.mock("#lib/erps", () => ({
  loadErps: vi.fn(),
}));

import { erp } from "#lib/erp";
import { loadErps } from "#lib/erps";
import * as deleted from "#src/product/commerce/deleted/index";

const ERPS = [
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://a.example" },
    id: "brand-a",
    name: "Brand A ERP",
  },
  {
    adapter: "demo-erp",
    connection: { baseUrl: "https://b.example" },
    id: "brand-b",
    name: "Brand B ERP",
  },
];

const calledAt = () =>
  erp.deleteProduct.mock.calls.map(([params]) => params.ERP_BASE_URL);

beforeEach(() => {
  loadErps.mockResolvedValue(ERPS);
  erp.deleteProduct.mockResolvedValue({ data: {}, ok: true, status: 200 });
});
afterEach(() => vi.clearAllMocks());

describe("Given a product deleted in Commerce and two ERPs", () => {
  test("Then only the ERP its erp_owner names is told, at its own address", async () => {
    const res = await deleted.main({
      data: { value: { erp_owner: "brand-b", id: 9, sku: "SIGN1" } },
      id: "evt-1",
    });

    expect(res.statusCode).toBe(200);
    expect(calledAt()).toEqual(["https://b.example"]);
    expect(erp.deleteProduct).toHaveBeenCalledWith(expect.anything(), "SIGN1", {
      origin: {
        document: "product SIGN1",
        eventId: "evt-1",
        system: "Adobe Commerce",
      },
    });
  });

  test("Then a product no ERP owns is nothing to do", async () => {
    const res = await deleted.main({
      data: { value: { erp_owner: "brand-z", sku: "X1" } },
    });
    expect(res.statusCode).toBe(200);
    expect(erp.deleteProduct).not.toHaveBeenCalled();
  });

  test("Then an event that does not name the owner tells every ERP, and a 404 from one is fine", async () => {
    erp.deleteProduct
      .mockResolvedValueOnce({ data: {}, ok: true, status: 200 })
      .mockResolvedValueOnce({ data: {}, ok: false, status: 404 });
    const res = await deleted.main({ data: { value: { sku: "CAB1" } } });
    expect(res.statusCode).toBe(200);
    expect(calledAt()).toEqual(["https://a.example", "https://b.example"]);
  });

  test("Then an ERP owning the products sold on named websites is told too: the event cannot say which websites the product was on (AB-64)", async () => {
    loadErps.mockResolvedValue([
      {
        ...ERPS[0],
        settings: {
          structure_owns: "websites",
          structure_owns_websites: "base",
        },
      },
      ERPS[1],
    ]);
    const res = await deleted.main({
      data: { value: { erp_owner: "brand-b", sku: "SIGN1" } },
    });
    expect(res.statusCode).toBe(200);
    expect(calledAt()).toEqual(["https://a.example", "https://b.example"]);
  });

  test("Then an owning ERP that refuses fails the event, so it is delivered again", async () => {
    erp.deleteProduct.mockResolvedValueOnce({
      data: { errorMessage: "down" },
      ok: false,
      status: 503,
    });
    const res = await deleted.main({
      data: { value: { erp_owner: "brand-a", sku: "CAB1" } },
    });
    expect(res.error.statusCode).toBe(500);
  });
});
