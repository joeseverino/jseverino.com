// A Date, such as a YAML date (midnight UTC), as its UTC YYYY-MM-DD.
export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
