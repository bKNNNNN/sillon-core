import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  homographyFromQuad,
  invertHomography,
  polygonArea,
  polygonPerimeter,
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

const TOLERANCE = 0.001; // 0.1 %, tech lead plan section 7.

/** A pinhole camera looking down at the ground plane: a realistic, random photo of a bed. */
type Camera = { tilt: number; pan: number; roll: number; height: number; back: number; focal: number };

/**
 * Central projection of one ground point of a w x h bed. A point behind the lens (depth < 0) still
 * gets a photo position, the mirror one, which lies on the sky side of the horizon.
 */
function shoot(cam: Camera, w: number, h: number, g: Point): { photo: Point; depth: number } {
  // World point relative to the camera, centred on the bed.
  const px = g.x - w / 2;
  const py = g.y - h / 2 + cam.back;
  const pz = -cam.height;
  // Pan around the vertical axis, then tilt around the camera x axis, then roll.
  const x1 = Math.cos(cam.pan) * px - Math.sin(cam.pan) * py;
  const y1 = Math.sin(cam.pan) * px + Math.cos(cam.pan) * py;
  const depth = Math.cos(cam.tilt) * y1 - Math.sin(cam.tilt) * pz;
  const up = Math.sin(cam.tilt) * y1 + Math.cos(cam.tilt) * pz;
  const u = (cam.focal * x1) / depth;
  const v = (-cam.focal * up) / depth;
  return {
    photo: {
      x: 2000 + Math.cos(cam.roll) * u - Math.sin(cam.roll) * v,
      y: 1500 + Math.sin(cam.roll) * u + Math.cos(cam.roll) * v,
    },
    depth,
  };
}

function photograph(cam: Camera, w: number, h: number): Quad | null {
  const ground: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const shots = ground.map((g) => shoot(cam, w, h, g));
  if (shots.some((s) => s.depth < 10)) return null; // behind or too close to the lens
  return shots.map((s) => s.photo) as unknown as Quad;
}

const camera = fc.record({
  tilt: fc.double({ min: 0.15, max: 1.45, noNaN: true }), // from grazing to almost straight down
  pan: fc.double({ min: -0.6, max: 0.6, noNaN: true }),
  roll: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
  height: fc.double({ min: 120, max: 400, noNaN: true }), // cm, phone held at arm's length or on a ladder
  back: fc.double({ min: -100, max: 600, noNaN: true }),
  focal: fc.double({ min: 1500, max: 4000, noNaN: true }), // px
});
const side = fc.double({ min: 20, max: 1500, noNaN: true }); // cm

const rel = (got: number, want: number) => Math.abs(got - want) / want;

describe('homography round trip on synthetic rectangles', () => {
  it('photo corners rectify back to the rectangle within 0.1 %', () => {
    fc.assert(
      fc.property(camera, side, side, (cam, w, h) => {
        const shot = photograph(cam, w, h);
        fc.pre(shot !== null);
        const rect: Quad = [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ];
        const toGround = value(homographyFromQuad(shot!, rect));
        const back = value(projectPolygon(toGround, shot!));
        back.forEach((p, i) => {
          expect(Math.abs(p.x - rect[i]!.x)).toBeLessThan(TOLERANCE * Math.max(w, h));
          expect(Math.abs(p.y - rect[i]!.y)).toBeLessThan(TOLERANCE * Math.max(w, h));
        });
        expect(rel(value(polygonArea(back)), w * h)).toBeLessThan(TOLERANCE);
        expect(rel(value(polygonPerimeter(back)), 2 * (w + h))).toBeLessThan(TOLERANCE);
      }),
      { numRuns: 500 },
    );
  });

  it('the inverse puts the rectangle back on the photo within 0.1 % of its size', () => {
    fc.assert(
      fc.property(camera, side, side, (cam, w, h) => {
        const shot = photograph(cam, w, h);
        fc.pre(shot !== null);
        const rect: Quad = [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ];
        const toPhoto = value(invertHomography(value(homographyFromQuad(shot!, rect))));
        const again = value(projectPolygon(toPhoto, rect));
        const span = Math.max(...shot!.map((p) => p.x)) - Math.min(...shot!.map((p) => p.x));
        again.forEach((p, i) => {
          expect(Math.abs(p.x - shot![i]!.x)).toBeLessThan(TOLERANCE * span);
          expect(Math.abs(p.y - shot![i]!.y)).toBeLessThan(TOLERANCE * span);
        });
      }),
      { numRuns: 500 },
    );
  });

  it('inner points survive photo to ground to photo', () => {
    fc.assert(
      fc.property(
        camera,
        side,
        side,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (cam, w, h, s, t) => {
          const shot = photograph(cam, w, h);
          fc.pre(shot !== null);
          const rect: Quad = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ];
          const toGround: Homography = value(homographyFromQuad(shot!, rect));
          const toPhoto = value(invertHomography(toGround));
          const inner = { x: s * w, y: t * h };
          const [onPhoto] = value(projectPolygon(toPhoto, [inner]));
          const [onGround] = value(projectPolygon(toGround, [onPhoto!]));
          expect(Math.abs(onGround!.x - inner.x)).toBeLessThan(TOLERANCE * Math.max(w, h));
          expect(Math.abs(onGround!.y - inner.y)).toBeLessThan(TOLERANCE * Math.max(w, h));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('a photo point is on the ground exactly when its ground point is in front of the lens', () => {
    fc.assert(
      fc.property(
        camera,
        side,
        side,
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (cam, w, h, gx, gy) => {
          const shot = photograph(cam, w, h);
          fc.pre(shot !== null);
          const g = { x: gx, y: gy };
          const { photo, depth } = shoot(cam, w, h, g);
          fc.pre(Math.abs(depth) > 10 && Number.isFinite(photo.x) && Number.isFinite(photo.y));
          const rect: Quad = [
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: w, y: h },
            { x: 0, y: h },
          ];
          const toGround = value(homographyFromQuad(shot!, rect));
          const toPhoto = value(invertHomography(toGround));
          // In front: the photo point lands on the ground. Behind: it is sky, and the ground point has no photo.
          expect(projectPoint(toGround, photo).ok).toBe(depth > 0);
          expect(projectPoint(toPhoto, g).ok).toBe(depth > 0);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
