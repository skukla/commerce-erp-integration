/*
 * The product grid's own stock move (lib/move-stock.js): Commerce's mass actions raise no
 * event, so the integration makes the move and tells the ERP itself. The calls are Adobe's
 * inventory mass-action endpoints; the assertions pin what each is HANDED.
 */
import { MOVE_ORIGIN, moveProblem, moveStock } from "#lib/move-stock";

function deps() {
  return {
    importStock: vi.fn(async () => ({ data: {}, ok: true, status: 200 })),
    skusForProductIds: vi.fn(async () => ["accessmesh", "accessmeshpro"]),
    transferAll: vi.fn(async () => true),
    transferSome: vi.fn(async () => []),
    warehousesOfSku: vi.fn(async (_params, sku) => [
      {
        code: "northwind",
        name: "Northwind Warehouse",
        quantity: sku === "accessmesh" ? 994 : 1000,
      },
    ]),
  };
}

const ALL = { from: "default", productIds: ["483", "484"], to: "northwind" };

describe("Given a stock move from the product grid", () => {
  test("Then all the stock moves with Commerce's transfer, taking the origin off the product", async () => {
    const d = deps();
    const result = await moveStock({}, ALL, d);

    expect(d.skusForProductIds).toHaveBeenCalledWith({}, ["483", "484"]);
    expect(d.transferAll).toHaveBeenCalledWith(
      {},
      ["accessmesh", "accessmeshpro"],
      "default",
      "northwind",
    );
    expect(d.transferSome).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      erp: "updated",
      moved: ["accessmesh", "accessmeshpro"],
    });
  });

  test("Then a quantity moves that many of each product, leaving the origin assigned", async () => {
    const d = deps();
    await moveStock({}, { ...ALL, quantity: 5 }, d);

    expect(d.transferSome).toHaveBeenCalledWith(
      {},
      [
        { qty: 5, sku: "accessmesh" },
        { qty: 5, sku: "accessmeshpro" },
      ],
      "default",
      "northwind",
    );
    expect(d.transferAll).not.toHaveBeenCalled();
  });

  test("Then the ERP is sent each product's stock at every source, named as a move", async () => {
    const d = deps();
    await moveStock({}, ALL, d);

    expect(d.importStock).toHaveBeenCalledWith(
      {},
      {
        origin: { event: MOVE_ORIGIN },
        stock: [
          {
            sku: "accessmesh",
            warehouses: [
              { code: "northwind", name: "Northwind Warehouse", quantity: 994 },
            ],
          },
          {
            sku: "accessmeshpro",
            warehouses: [
              {
                code: "northwind",
                name: "Northwind Warehouse",
                quantity: 1000,
              },
            ],
          },
        ],
      },
    );
  });

  test("Then an ERP that refuses is an error that says the move itself happened", async () => {
    const d = deps();
    d.importStock.mockResolvedValue({
      data: { errorMessage: "offline" },
      ok: false,
      status: 503,
    });
    await expect(moveStock({}, ALL, d)).rejects.toThrow(
      "Moved in Commerce, but the ERP answered 503: offline",
    );
  });

  test("Then a Commerce refusal stops before the ERP is told anything", async () => {
    const d = deps();
    d.transferAll.mockRejectedValue(
      new Error("Source default is not assigned"),
    );
    await expect(moveStock({}, ALL, d)).rejects.toThrow(
      "Source default is not assigned",
    );
    expect(d.importStock).not.toHaveBeenCalled();
  });

  test("Then no product found is an error, and nothing moves", async () => {
    const d = deps();
    d.skusForProductIds.mockResolvedValue([]);
    await expect(moveStock({}, ALL, d)).rejects.toThrow(
      "None of the selected products",
    );
    expect(d.transferAll).not.toHaveBeenCalled();
  });
});

describe("Given a move request to check", () => {
  test("Then a whole request passes, with or without a quantity", () => {
    expect(moveProblem(ALL)).toBeNull();
    expect(moveProblem({ ...ALL, quantity: 3 })).toBeNull();
  });

  test.each([
    [{ ...ALL, productIds: [] }, "Select the products"],
    [{ ...ALL, productIds: ["1; drop"] }, "Product ids are numbers"],
    [{ ...ALL, to: "default" }, "must differ"],
    [{ ...ALL, from: "../x" }, "Name the warehouse"],
    [{ ...ALL, quantity: 0 }, "whole number above zero"],
    [{ ...ALL, quantity: 2.5 }, "whole number above zero"],
  ])("Then %j is refused in words", (request, words) => {
    expect(moveProblem(request)).toContain(words);
  });
});
