export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Cheap, deterministic-enough token estimate for the offline mock. */
export const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil((text || '').length / 4));

/** Strip ANSI colour codes (jest/eslint output is colourised). */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (text: string): string => (text || '').replace(/\x1b\[[0-9;]*m/g, '');

/** Keep only the last N lines of a (possibly huge) command output. */
export function tail(text: string, lines = 40): string {
  const arr = (text || '').split('\n');
  return arr.length <= lines ? text : arr.slice(-lines).join('\n');
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}
