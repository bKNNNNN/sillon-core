export function dailyGdd(tmin: number, tmax: number, tBase: number): number {
  return Math.max(0, (tmin + tmax) / 2 - tBase);
}
