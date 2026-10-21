import { describe, expect, it } from 'vitest';
import {
  homographyFromQuad,
  invertHomography,
  projectPoint,
  projectPolygon,
  type Homography,
  type Point,
  type Quad,
} from '../src/index.js';

const value = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const quad = (...xy: number[]): Quad =>
  [0, 1, 2, 3].map((i) => ({ x: xy[2 * i]!, y: xy[2 * i + 1]! })) as unknown as Quad;
const near = (p: Point, q: Point, tol = 1e-6) => {
  expect(Math.abs(p.x - q.x)).toBeLessThan(tol);
  expect(Math.abs(p.y - q.y)).toBeLessThan(tol);
};

// A photo of a 200 x 100 cm bed seen from its long side: far edge shorter and higher.
const photo = quad(812, 2410, 3190, 2385, 2650, 1320, 1290, 1335);
const ground = quad(0, 0, 200, 0, 200, 100, 0, 100);

describe('homographyFromQuad', () => {
  it('maps each photo corner onto its ground corner', () => {
    const h = value(homographyFromQuad(photo, ground));
    photo.forEach((p, i) => near(value(projectPoint(h, p)), ground[i]!));
  });

  it('is normalised with h33 = 1 and has nine finite entries', () => {
    const h = value(homographyFromQuad(photo, ground));
    expect(h).toHaveLength(9);
    expect(h[8]).toBe(1);
    expect(h.every(Number.isFinite)).toBe(true);
  });

  it('gives the identity for a quad mapped onto itself', () => {
    const h = value(homographyFromQuad(ground, ground));
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(h[i]).toBeCloseTo(v, 9));
  });

  it('recovers an affine map exactly (no perspective terms)', () => {
    const moved = ground.map((p) => ({ x: 2 * p.x + 0.5 * p.y + 10, y: -p.x + 3 * p.y - 4 })) as unknown as Quad;
    const h = value(homographyFromQuad(ground, moved));
    [2, 0.5, 10, -1, 3, -4, 0, 0, 1].forEach((v, i) => expect(h[i]).toBeCloseTo(v, 9));
  });

  it('places the middle of the bed where perspective puts it, not at the photo midpoint', () => {
    const h = value(homographyFromQuad(ground, photo));
    const centre = value(projectPoint(h, { x: 100, y: 50 }));
    const naiveY = (2410 + 2385 + 1320 + 1335) / 4;
    // The far half looks smaller, so the true centre sits below (larger y than) the naive average.
    expect(centre.y).toBeGreaterThan(naiveY);
  });

  it('accepts a mirrored ground (photo y down, ground y up)', () => {
    const flipped = quad(0, 100, 200, 100, 200, 0, 0, 0);
    const h = value(homographyFromQuad(photo, flipped));
    photo.forEach((p, i) => near(value(projectPoint(h, p)), flipped[i]!));
  });

  it('refuses corners given in crossing order', () => {
    const crossed = quad(812, 2410, 2650, 1320, 3190, 2385, 1290, 1335);
    expect(homographyFromQuad(crossed, ground)).toEqual({
      ok: false,
      error: 'Les quatre coins doivent former un quadrilatère convexe, pris dans l’ordre du tour.',
    });
    expect(homographyFromQuad(photo, quad(0, 0, 200, 100, 200, 0, 0, 100)).ok).toBe(false);
  });

  it('refuses three aligned corners or a repeated corner', () => {
    expect(homographyFromQuad(quad(0, 0, 1, 0, 2, 0, 0, 1), ground).ok).toBe(false);
    expect(homographyFromQuad(quad(0, 0, 0, 0, 1, 1, 0, 1), ground).ok).toBe(false);
  });

  it('refuses a concave quad', () => {
    expect(homographyFromQuad(quad(0, 0, 4, 0, 1, 1, 0, 4), ground).ok).toBe(false);
  });

  it('refuses a coordinate that is not a finite number', () => {
    expect(homographyFromQuad(quad(0, 0, 1, 0, 1, Number.NaN, 0, 1), ground)).toEqual({
      ok: false,
      error: 'Coordonnée invalide.',
    });
    expect(homographyFromQuad(photo, quad(0, 0, Infinity, 0, 1, 1, 0, 1)).ok).toBe(false);
  });

  it('refuses anything but four corners', () => {
    const three = [photo[0], photo[1], photo[2]] as unknown as Quad;
    expect(homographyFromQuad(three, ground)).toEqual({ ok: false, error: 'Il faut exactement quatre coins.' });
  });

  it('does not mutate its inputs', () => {
    const frozen = Object.freeze(photo.map((p) => Object.freeze({ ...p }))) as unknown as Quad;
    expect(homographyFromQuad(frozen, ground).ok).toBe(true);
  });
});

describe('invertHomography', () => {
  it('maps the ground corners back onto the photo', () => {
    const h = value(homographyFromQuad(photo, ground));
    const inv = value(invertHomography(h));
    ground.forEach((g, i) => near(value(projectPoint(inv, g)), photo[i]!, 1e-6));
    expect(inv[8]).toBe(1);
  });

  it('gives back the same map as solving the other way round', () => {
    const inv = value(invertHomography(value(homographyFromQuad(photo, ground))));
    const direct = value(homographyFromQuad(ground, photo));
    inv.forEach((v, i) => expect(v).toBeCloseTo(direct[i]!, 6));
  });

  it('refuses a singular matrix', () => {
    const flat: Homography = [1, 2, 3, 2, 4, 6, 0, 0, 1];
    expect(invertHomography(flat)).toEqual({ ok: false, error: 'Transformation impossible à inverser.' });
  });

  it('refuses a matrix that is not nine finite numbers', () => {
    expect(invertHomography([1, 0, 0, 0, 1, 0, 0, 0] as unknown as Homography).ok).toBe(false);
    expect(invertHomography([1, 0, 0, 0, Number.NaN, 0, 0, 0, 1]).ok).toBe(false);
  });

  it('keeps a matrix whose h33 is zero, scaled to unit norm', () => {
    // A pure perspective swap: (x, y) -> (y/x, 1/x). Its inverse has h33 = 0 too.
    const swap: Homography = [0, 1, 0, 0, 0, 1, 1, 0, 0];
    const inv = value(invertHomography(swap));
    const p = { x: 2, y: 3 };
    near(value(projectPoint(inv, value(projectPoint(swap, p)))), p, 1e-12);
  });
});

describe('projectPoint and projectPolygon', () => {
  it('refuses a point on the horizon line', () => {
    const h: Homography = [1, 0, 0, 0, 1, 0, 0, 1, 1];
    expect(projectPoint(h, { x: 5, y: -1 })).toEqual({ ok: false, error: 'Point à l’horizon, hors du sol.' });
  });

  it('refuses a coordinate that is not a finite number', () => {
    const h: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(projectPoint(h, { x: Number.NaN, y: 0 })).toEqual({ ok: false, error: 'Coordonnée invalide.' });
  });

  it('projects a whole outline and fails as soon as one point fails', () => {
    const h = value(homographyFromQuad(photo, ground));
    const out = value(projectPolygon(h, photo));
    out.forEach((p, i) => near(p, ground[i]!));
    const horizon: Homography = [1, 0, 0, 0, 1, 0, 0, 1, 1];
    expect(projectPolygon(horizon, [{ x: 0, y: 0 }, { x: 1, y: -1 }]).ok).toBe(false);
  });
});
