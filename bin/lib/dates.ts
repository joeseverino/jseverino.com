// Today, as YYYY-MM-DD, on the calendar the stamp's reader expects.

// A date a person reads as when they did something (a writeup's published or reviewed date):
// this machine's calendar, so a late-evening edit carries the evening's date.
export const localDate = (): string => Temporal.Now.plainDateISO().toString();

// A machine's stamp, which CI may write as well as the Mac: the UTC calendar, so the two never
// disagree near midnight.
export const utcDate = (): string => Temporal.Now.plainDateISO('UTC').toString();
