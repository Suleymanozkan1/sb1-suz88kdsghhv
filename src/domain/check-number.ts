/**
 * Sale lines written by the Micros automation carry the key source:businessDay:outlet:checkNo:itemCode
 * (older ones have no outlet). Screens show just the check number.
 */
export function checkNumber(externalId: string): string {
  const m = /^(?:MICROS|OPERA|OTHER):\d{4}-\d{2}-\d{2}:(?:[^:]+:)?([^:]+):[^:]+$/.exec(externalId);
  return m ? m[1]! : externalId;
}
