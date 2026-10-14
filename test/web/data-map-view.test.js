/*
 * What the Data Map's pairs are: one entry per pair of business objects, and the arrow helper
 * that says which way a pair moves. The records are read live (data-map-live.test.js).
 */
import {
  arrowPathKey,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
} from "#web/data-map-view.js";

describe("Given the Data Map's entries", () => {
  test("Then every entry has an id, a direction and an icon", () => {
    for (const entry of MAP_ENTRIES) {
      expect(entry.id, "id").toEqual(expect.any(String));
      expect(entry.moves, entry.id).toEqual(expect.any(String));
      expect(["both", "to-erp", "to-commerce"], entry.id).toContain(entry.dir);
      expect(MAP_ICON_PATHS[entry.id], `icon for ${entry.id}`).toEqual(
        expect.any(String),
      );
    }
  });
});

describe("Given which way an arrow points, drawn from Commerce on the left", () => {
  test("Then both keeps its own path", () => {
    expect(arrowPathKey("both")).toBe("both");
  });

  test("Then to-erp points right and to-commerce points left", () => {
    expect(arrowPathKey("to-erp")).toBe("right-only");
    expect(arrowPathKey("to-commerce")).toBe("left-only");
  });
});
