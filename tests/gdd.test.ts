import { describe, expect, it } from 'vitest';
import { dailyGdd } from '../src/index.js';

describe('dailyGdd', () => {
  it('clamps at zero', () => {
    expect(dailyGdd(4, 10, 10)).toBe(0);
    expect(dailyGdd(14, 26, 10)).toBe(10);
  });
});
