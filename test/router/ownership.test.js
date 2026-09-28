/* Which ERP owns a product (src/router/ownership.js): an ERP's own ownership setting, else its erp_owner id. */
import { OWNER_ATTRIBUTE, ownershipOf } from "#router/ownership";

describe("Given an ERP entry", () => {
  test("Then with no settings of its own it owns the products whose erp_owner names it", () => {
    expect(ownershipOf({ id: "brand-a" })).toEqual({
      structure_owns: "attribute",
      structure_owns_attribute: `${OWNER_ATTRIBUTE}=brand-a`,
    });
  });

  test("Then its own ownership setting wins", () => {
    expect(
      ownershipOf({
        id: "brand-a",
        settings: {
          structure_order_prefix: "BRA",
          structure_owns: "sources",
          structure_owns_sources: "east",
        },
      }),
    ).toEqual({ structure_owns: "sources", structure_owns_sources: "east" });
  });
});
