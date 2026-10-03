// A date as YYYY-MM-DD (UTC), the form frontmatter and the reports use.
export const isoDate = (date: Date = new Date()): string => date.toISOString().slice(0, 10);
