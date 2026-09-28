/*
 * How the page writes a time: "2:44 PM", "Today" and "Monday, September 28", "2 minutes ago".
 * American English, in the browser's own time zone; the tests pass a zone so they are the same
 * everywhere.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const LOCALE = "en-US";

/** A day as YYYY-MM-DD in a zone, for comparing days. */
function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(date);
}

/**
 * @param {string} iso a time
 * @param {string} [timeZone] the zone; the browser's when omitted
 * @returns {string} "2:44 PM"
 */
export function clockTime(iso, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** "Monday, September 28" */
function longDate(date, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
  }).format(date);
}

/** "Sep 27" */
function shortDate(date, timeZone) {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(date);
}

/**
 * Whether two times fall on the same day in a zone.
 * @param {string|Date} a
 * @param {string|Date} b
 * @param {string} [timeZone]
 */
export function sameDay(a, b, timeZone) {
  return dayKey(new Date(a), timeZone) === dayKey(new Date(b), timeZone);
}

/**
 * The heading of a day in the Activity feed.
 * @param {string} iso a time on that day
 * @param {Date} now
 * @param {string} [timeZone]
 * @returns {{ key: string, title: string, date: string }} "Today" and "Monday, September 28";
 *   an older day's title is its weekday and date, with no second line
 */
export function dayHeading(iso, now, timeZone) {
  const date = new Date(iso);
  const key = dayKey(date, timeZone);
  const long = longDate(date, timeZone);
  if (key === dayKey(now, timeZone)) {
    return { date: long, key, title: "Today" };
  }
  if (key === dayKey(new Date(now.getTime() - DAY), timeZone)) {
    return { date: long, key, title: "Yesterday" };
  }
  return { date: "", key, title: long };
}

/**
 * A time with its day when it is not today: "2:44 PM", "Sep 27, 6:17 AM".
 * @param {string} iso
 * @param {Date} now
 * @param {string} [timeZone]
 */
export function whenText(iso, now, timeZone) {
  const time = clockTime(iso, timeZone);
  return sameDay(iso, now, timeZone)
    ? time
    : `${shortDate(new Date(iso), timeZone)}, ${time}`;
}

/**
 * "today at 2:06 PM", "yesterday at 5:40 PM", "Sep 21 at 7:11 PM".
 * @param {string} iso
 * @param {Date} now
 * @param {string} [timeZone]
 */
export function dayAndTime(iso, now, timeZone) {
  const time = clockTime(iso, timeZone);
  if (sameDay(iso, now, timeZone)) {
    return `today at ${time}`;
  }
  if (sameDay(iso, new Date(now.getTime() - DAY), timeZone)) {
    return `yesterday at ${time}`;
  }
  return `${shortDate(new Date(iso), timeZone)} at ${time}`;
}

/**
 * "just now", "2 minutes ago", "3 hours ago", "4 days ago".
 * @param {string} iso
 * @param {Date} now
 */
export function ago(iso, now) {
  const gone = now.getTime() - Date.parse(iso);
  if (gone < MINUTE) {
    return "just now";
  }
  if (gone < HOUR) {
    return plural(Math.floor(gone / MINUTE), "minute");
  }
  if (gone < DAY) {
    return plural(Math.floor(gone / HOUR), "hour");
  }
  return plural(Math.floor(gone / DAY), "day");
}

const plural = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
