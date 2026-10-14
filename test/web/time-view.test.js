/* How the Admin page writes a time, in American English (the tests fix the zone to UTC). */
import {
  ago,
  clockTime,
  dateText,
  dayAndTime,
  dayOf,
  sameDay,
  whenText,
} from "#web/time-view.js";

const UTC = "UTC";
const NOW = new Date("2026-09-28T15:00:00Z");

describe("Given a time on the page", () => {
  test("Then it reads as a clock time", () => {
    expect(clockTime("2026-09-28T14:44:00Z", UTC)).toBe("2:44 PM");
    expect(clockTime("2026-09-28T09:05:00Z", UTC)).toBe("9:05 AM");
  });

  test("Then a date reads as the Admin's grids write it, and a day is its date in the zone", () => {
    expect(dateText("2026-09-28T14:44:00Z", UTC)).toBe("Sep 28, 2026");
    expect(dayOf("2026-09-28T23:30:00Z", UTC)).toBe("2026-09-28");
    // The same moment is the next day further east.
    expect(dayOf("2026-09-28T23:30:00Z", "Asia/Tokyo")).toBe("2026-09-29");
  });

  test("Then a time on another day carries its date", () => {
    expect(whenText("2026-09-28T14:44:00Z", NOW, UTC)).toBe("2:44 PM");
    expect(whenText("2026-09-27T06:17:00Z", NOW, UTC)).toBe("Sep 27, 6:17 AM");
    expect(dayAndTime("2026-09-28T14:06:00Z", NOW, UTC)).toBe(
      "today at 2:06 PM",
    );
    expect(dayAndTime("2026-09-27T17:40:00Z", NOW, UTC)).toBe(
      "yesterday at 5:40 PM",
    );
    expect(dayAndTime("2026-09-21T19:11:00Z", NOW, UTC)).toBe(
      "Sep 21 at 7:11 PM",
    );
    expect(sameDay("2026-09-28T00:01:00Z", NOW, UTC)).toBe(true);
  });

  test.each([
    ["2026-09-28T14:59:30Z", "just now"],
    ["2026-09-28T14:58:00Z", "2 minutes ago"],
    ["2026-09-28T14:59:00Z", "1 minute ago"],
    ["2026-09-28T12:00:00Z", "3 hours ago"],
    ["2026-09-26T15:00:00Z", "2 days ago"],
  ])("Then %s was %s", (iso, said) => {
    expect(ago(iso, NOW)).toBe(said);
  });
});
