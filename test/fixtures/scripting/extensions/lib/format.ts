// helper shared by an extension (imported in Node at build time) and a behaviour (browser)
export const shout = (s: string): string => s.toUpperCase();
export const label = (word: string, n: number): string => `${word}:${n}`;
