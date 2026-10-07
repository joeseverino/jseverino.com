export const isoDate = (date: Date = new Date()): string => date.toISOString().slice(0, 10);
