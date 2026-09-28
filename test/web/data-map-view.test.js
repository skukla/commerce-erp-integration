/*
 * What the Data Map's content is: one entry per pair of business objects, the longer copy the
 * side panel shows for it, and the small pure helpers the four views share (which way an arrow
 * points, and how the Hub view splits two ERPs).
 */
import {
  arrowPathKey,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
  MAP_MASTER_DATA,
  MAP_PANELS,
  MAP_PROCESS_STEPS,
  splitErpsForHub,
} from "#web/data-map-view.js";

describe("Given the Data Map's entries", () => {
  test("Then every entry has an id, both ERP slots, and an icon", () => {
    for (const entry of MAP_ENTRIES) {
      expect(entry.id, "id").toEqual(expect.any(String));
      expect(entry.commerce, entry.id).toEqual(expect.any(String));
      expect(entry.moves, entry.id).toEqual(expect.any(String));
      expect(["both", "to-erp", "to-commerce", "none"], entry.id).toContain(
        entry.dir,
      );
      expect(entry.primary, entry.id).toHaveLength(2);
      expect(entry.secondary, entry.id).toHaveLength(2);
      for (const slot of ["commerce", "primary", "secondary"]) {
        expect(
          entry.example[slot].length,
          `${entry.id}.${slot}`,
        ).toBeGreaterThanOrEqual(2);
      }
      expect(MAP_ICON_PATHS[entry.id], `icon for ${entry.id}`).toEqual(
        expect.any(String),
      );
    }
  });

  test("Then only Payment has no live connection", () => {
    const gaps = MAP_ENTRIES.filter((entry) => entry.gap).map(
      (entry) => entry.id,
    );
    expect(gaps).toStrictEqual(["payment"]);
  });
});

describe("Given the Data Map's side-panel copy", () => {
  test("Then every entry has a panel with a title and body", () => {
    for (const entry of MAP_ENTRIES) {
      const panel = MAP_PANELS[entry.id];
      expect(panel, entry.id).toBeDefined();
      expect(panel.title, entry.id).toEqual(expect.any(String));
      expect(panel.body, entry.id).toEqual(expect.any(String));
    }
  });

  test("Then a panel with facts names both ERP slots", () => {
    expect(MAP_PANELS.company.facts).toStrictEqual({
      primary: "Kukla Studios is customer 100042",
      secondary: "Kukla Studios is customer C-2231",
    });
  });

  test("Then the order, shipment and payment panels carry no per-ERP facts", () => {
    expect(MAP_PANELS.order.facts).toBeUndefined();
    expect(MAP_PANELS.fulfil.facts).toBeUndefined();
    expect(MAP_PANELS.payment.facts).toBeUndefined();
  });
});

describe("Given the Process view's own content", () => {
  test("Then the five master-data tiles each open a real Data Map entry", () => {
    for (const tile of MAP_MASTER_DATA) {
      expect(MAP_PANELS[tile.entryId], tile.entryId).toBeDefined();
    }
  });

  test("Then the five steps run in order, and Payment is the one gap", () => {
    expect(MAP_PROCESS_STEPS.map((step) => step.n)).toStrictEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(
      MAP_PROCESS_STEPS.filter((step) => step.gap).map((s) => s.label),
    ).toStrictEqual(["Payment"]);
  });
});

describe("Given which way an arrow points", () => {
  test("Then both and none are the same from either side", () => {
    expect(arrowPathKey("both", "left")).toBe("both");
    expect(arrowPathKey("both", "right")).toBe("both");
    expect(arrowPathKey("none", "left")).toBe("none");
  });

  test("Then to-erp points right from the left side, and left from the right side", () => {
    expect(arrowPathKey("to-erp", "left")).toBe("right-only");
    expect(arrowPathKey("to-erp", "right")).toBe("left-only");
  });

  test("Then to-commerce is the mirror of to-erp", () => {
    expect(arrowPathKey("to-commerce", "left")).toBe("left-only");
    expect(arrowPathKey("to-commerce", "right")).toBe("right-only");
  });
});

describe("Given the Hub view's two sides", () => {
  test("Then two ERPs split left and right", () => {
    const erps = [
      { id: "erp", name: "Northwind ERP" },
      { id: "contoso", name: "Contoso ERP" },
    ];
    expect(splitErpsForHub(erps)).toStrictEqual({
      left: erps[0],
      right: erps[1],
    });
  });

  test("Then one ERP takes the left side only", () => {
    const erps = [{ id: "erp", name: "Northwind ERP" }];
    expect(splitErpsForHub(erps)).toStrictEqual({ left: erps[0], right: null });
  });
});
