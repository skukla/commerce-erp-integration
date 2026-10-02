/*
 * When a scheduled job is due (AB-38, owner 2026-09-28: a business user edits the schedules).
 * One heartbeat alarm ticks every five minutes; each job's schedule is a setting, read in the
 * store's timezone. A job is due when its most recent scheduled moment is after the moment it
 * last ran for, and not in the future, so a tick that repeats runs nothing twice, and a
 * heartbeat that was down runs a job once, not once per missed moment.
 */
import {
  dueMoment,
  isTimeZone,
  jobsWithSchedules,
  latestMoment,
  nextMoment,
  scheduleOf,
  scheduleWords,
} from "#lib/schedule";

const at = (text) => new Date(text);
const iso = (date) => date?.toISOString() ?? null;

const HOURLY = {
  enabled: true,
  frequency: "hourly",
  minute: 5,
  time: "02:00",
  timeZone: "UTC",
  weekday: "monday",
};
const daily = (time, timeZone) => ({
  ...HOURLY,
  frequency: "daily",
  time,
  timeZone,
});
const weekly = (weekday, time, timeZone) => ({
  ...daily(time, timeZone),
  frequency: "weekly",
  weekday,
});

describe("Given a job that runs every hour", () => {
  test("Then its latest moment is the last :05 at or before now, in UTC by default", () => {
    expect(iso(latestMoment(HOURLY, at("2026-09-28T14:40:00Z")))).toBe(
      "2026-09-28T14:05:00.000Z",
    );
    expect(iso(latestMoment(HOURLY, at("2026-09-28T14:03:00Z")))).toBe(
      "2026-09-28T13:05:00.000Z",
    );
    expect(iso(latestMoment(HOURLY, at("2026-09-28T14:05:00Z")))).toBe(
      "2026-09-28T14:05:00.000Z",
    );
  });

  test("Then the minute is the store's: :05 in India is :35 in UTC", () => {
    const kolkata = { ...HOURLY, timeZone: "Asia/Kolkata" };
    expect(iso(latestMoment(kolkata, at("2026-09-28T14:40:00Z")))).toBe(
      "2026-09-28T14:35:00.000Z",
    );
    expect(iso(nextMoment(kolkata, at("2026-09-28T14:40:00Z")))).toBe(
      "2026-09-28T15:35:00.000Z",
    );
  });

  test("Then its next moment is the next :05 after now", () => {
    expect(iso(nextMoment(HOURLY, at("2026-09-28T14:40:00Z")))).toBe(
      "2026-09-28T15:05:00.000Z",
    );
    expect(iso(nextMoment(HOURLY, at("2026-09-28T14:05:00Z")))).toBe(
      "2026-09-28T15:05:00.000Z",
    );
  });

  test("Then the hour New York repeats on 2026-11-01 has a moment each time", () => {
    const ny = { ...HOURLY, timeZone: "America/New_York" };
    // 01:05 EDT, then 01:05 EST an hour later.
    expect(iso(latestMoment(ny, at("2026-11-01T05:30:00Z")))).toBe(
      "2026-11-01T05:05:00.000Z",
    );
    expect(iso(latestMoment(ny, at("2026-11-01T06:30:00Z")))).toBe(
      "2026-11-01T06:05:00.000Z",
    );
  });
});

describe("Given a job that runs daily", () => {
  const chicago = daily("02:00", "America/Chicago");

  test("Then 02:00 is the store's 02:00", () => {
    // 02:00 CDT is 07:00 UTC.
    expect(iso(latestMoment(chicago, at("2026-10-02T12:00:00Z")))).toBe(
      "2026-10-02T07:00:00.000Z",
    );
    expect(iso(latestMoment(chicago, at("2026-10-02T06:59:00Z")))).toBe(
      "2026-10-01T07:00:00.000Z",
    );
    expect(iso(nextMoment(chicago, at("2026-10-02T12:00:00Z")))).toBe(
      "2026-10-03T07:00:00.000Z",
    );
  });

  test("Then New York's 02:00 moves an hour in UTC when the clocks go back on 2026-11-01", () => {
    const ny = daily("02:00", "America/New_York");
    expect(iso(latestMoment(ny, at("2026-11-01T06:30:00Z")))).toBe(
      "2026-10-31T06:00:00.000Z",
    );
    expect(iso(nextMoment(ny, at("2026-10-31T12:00:00Z")))).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(iso(latestMoment(ny, at("2026-11-01T07:00:00Z")))).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });

  test("Then a time the clocks pass twice runs once, at the first", () => {
    const ny = daily("01:30", "America/New_York");
    // 01:30 EDT is 05:30 UTC; 01:30 EST, an hour later, is not a second moment.
    const first = latestMoment(ny, at("2026-11-01T05:45:00Z"));
    expect(iso(first)).toBe("2026-11-01T05:30:00.000Z");
    expect(dueMoment(ny, iso(first), at("2026-11-01T06:45:00Z"))).toBeNull();
  });

  test("Then a time the clocks skip runs when the clocks reach it", () => {
    // 2026-03-08: New York goes from 02:00 EST straight to 03:00 EDT; 02:30 is 03:30 EDT.
    const ny = daily("02:30", "America/New_York");
    expect(iso(latestMoment(ny, at("2026-03-08T08:00:00Z")))).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });
});

describe("Given a job that runs weekly", () => {
  const monday = weekly("monday", "02:00", "UTC");

  test("Then its moments are that weekday at that time", () => {
    // 2026-10-02 is a Friday.
    expect(iso(latestMoment(monday, at("2026-10-02T12:00:00Z")))).toBe(
      "2026-09-28T02:00:00.000Z",
    );
    expect(iso(nextMoment(monday, at("2026-10-02T12:00:00Z")))).toBe(
      "2026-10-05T02:00:00.000Z",
    );
    expect(iso(latestMoment(monday, at("2026-10-05T01:59:00Z")))).toBe(
      "2026-09-28T02:00:00.000Z",
    );
    expect(iso(latestMoment(monday, at("2026-10-05T02:00:00Z")))).toBe(
      "2026-10-05T02:00:00.000Z",
    );
  });

  test("Then the weekday is the store's: Monday 02:00 in Tokyo is Sunday in UTC", () => {
    const tokyo = weekly("monday", "02:00", "Asia/Tokyo");
    expect(iso(latestMoment(tokyo, at("2026-10-02T12:00:00Z")))).toBe(
      "2026-09-27T17:00:00.000Z",
    );
  });
});

describe("Given whether a job is due on a tick", () => {
  const now = at("2026-09-28T14:10:00Z");

  test("Then a job that has never run is due for its latest moment", () => {
    expect(iso(dueMoment(HOURLY, undefined, now))).toBe(
      "2026-09-28T14:05:00.000Z",
    );
  });

  test("Then a moment already run for is not due again, on a repeated or overlapping tick", () => {
    expect(dueMoment(HOURLY, "2026-09-28T14:05:00.000Z", now)).toBeNull();
    expect(
      dueMoment(HOURLY, "2026-09-28T14:05:00.000Z", at("2026-09-28T14:15:00Z")),
    ).toBeNull();
  });

  test("Then the next moment is due once it arrives", () => {
    expect(
      iso(
        dueMoment(
          HOURLY,
          "2026-09-28T14:05:00.000Z",
          at("2026-09-28T15:05:00Z"),
        ),
      ),
    ).toBe("2026-09-28T15:05:00.000Z");
  });

  test("Then a heartbeat that was down for hours runs the job once, for the latest moment", () => {
    const back = at("2026-09-28T19:40:00Z");
    const moment = dueMoment(HOURLY, "2026-09-28T14:05:00.000Z", back);
    expect(iso(moment)).toBe("2026-09-28T19:05:00.000Z");
    expect(dueMoment(HOURLY, iso(moment), at("2026-09-28T19:45:00Z"))).toBe(
      null,
    );
  });

  test("Then a run recorded before moments were (its time, not its moment) counts as that moment's", () => {
    expect(dueMoment(HOURLY, "2026-09-28T14:05:12.345Z", now)).toBeNull();
  });

  test("Then a job switched off is never due", () => {
    expect(dueMoment({ ...HOURLY, enabled: false }, undefined, now)).toBeNull();
    expect(latestMoment({ ...HOURLY, enabled: false }, now)).toBeNull();
    expect(nextMoment({ ...HOURLY, enabled: false }, now)).toBeNull();
  });

  test("Then a schedule changed to a later time of day waits for that time", () => {
    // Ran hourly at 14:05; now daily at 02:00: today's 02:00 is older, tomorrow's is next.
    expect(
      dueMoment(daily("02:00", "UTC"), "2026-09-28T14:05:00.000Z", now),
    ).toBeNull();
  });
});

describe("Given the schedule in words", () => {
  test("Then each frequency reads as the store would say it", () => {
    expect(scheduleWords(HOURLY)).toBe("Every hour at :05, store time (UTC)");
    expect(scheduleWords({ ...HOURLY, minute: 0 })).toBe(
      "Every hour at :00, store time (UTC)",
    );
    expect(scheduleWords(daily("02:00", "America/Chicago"))).toBe(
      "Daily at 02:00, America/Chicago",
    );
    expect(scheduleWords(weekly("monday", "06:30", "UTC"))).toBe(
      "Weekly on Monday at 06:30, UTC",
    );
    expect(scheduleWords({ ...HOURLY, enabled: false })).toBe("Off");
  });
});

describe("Given the schedule settings", () => {
  const SETTINGS = {
    schedule_prices_enabled: true,
    schedule_prices_frequency: "weekly",
    schedule_prices_minute: "15",
    schedule_prices_time: "03:45",
    schedule_prices_weekday: "friday",
    schedule_timezone: "Europe/Berlin",
  };

  test("Then a job's schedule is read from its settings and the store timezone", () => {
    expect(scheduleOf(SETTINGS, "prices")).toStrictEqual({
      enabled: true,
      frequency: "weekly",
      minute: 15,
      time: "03:45",
      timeZone: "Europe/Berlin",
      weekday: "friday",
    });
  });

  test("Then a timezone that is not a real one reads as UTC, so a job still runs", () => {
    expect(
      scheduleOf({ ...SETTINGS, schedule_timezone: "Mars/Olympus" }, "prices")
        .timeZone,
    ).toBe("UTC");
  });

  test("Then every job is listed with its schedule, whether or not it has run", () => {
    const ran = { id: "prices", lastRun: { at: "T" } };
    expect(jobsWithSchedules([ran], SETTINGS)).toStrictEqual([
      { ...ran, schedule: scheduleOf(SETTINGS, "prices") },
    ]);
    expect(jobsWithSchedules([], SETTINGS)).toStrictEqual([
      { id: "prices", schedule: scheduleOf(SETTINGS, "prices") },
    ]);
  });

  test("Then a timezone is checked against the ones the runtime knows", () => {
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("America/Chicago")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
  });
});
