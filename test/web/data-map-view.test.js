/*
 * What the Data Map's content is: one entry per pair of business objects, each with an example
 * record on every side, and the arrow helper that says which way a pair moves.
 */
import {
  arrowPathKey,
  MAP_ENTRIES,
  MAP_ICON_PATHS,
} from "#web/data-map-view.js";

describe("Given the Data Map's entries", () => {
  test("Then every entry has an id, a direction, an example on each side, and an icon", () => {
    for (const entry of MAP_ENTRIES) {
      expect(entry.id, "id").toEqual(expect.any(String));
      expect(entry.moves, entry.id).toEqual(expect.any(String));
      expect(["both", "to-erp", "to-commerce", "none"], entry.id).toContain(
        entry.dir,
      );
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

describe("Given which way an arrow points, drawn from Commerce on the left", () => {
  test("Then both and none keep their own path", () => {
    expect(arrowPathKey("both")).toBe("both");
    expect(arrowPathKey("none")).toBe("none");
  });

  test("Then to-erp points right and to-commerce points left", () => {
    expect(arrowPathKey("to-erp")).toBe("right-only");
    expect(arrowPathKey("to-commerce")).toBe("left-only");
  });
});
