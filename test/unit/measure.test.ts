import { describe, it, expect } from 'vitest';
import { squaresBetweenNorm } from '../../src/rendering/MeasureTool.ts';

// A 1000×800 px map calibrated at 50 px/square → 20 squares across, 16 down.
const W = 1000, H = 800, K = 50;

describe('squaresBetweenNorm — map ruler distance', () => {
  it('counts whole squares across a horizontal span', () => {
    // 0.0 → 0.5 in x = 500 px = 10 squares.
    const d = squaresBetweenNorm({ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H, K);
    expect(d).toBeCloseTo(10, 6);
  });

  it('counts whole squares down a vertical span', () => {
    // 0.0 → 1.0 in y = 800 px = 16 squares.
    const d = squaresBetweenNorm({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, W, H, K);
    expect(d).toBeCloseTo(16, 6);
  });

  it('uses true Euclidean diagonal (not Chebyshev / grid-step)', () => {
    // 3 squares across (150px) + 4 squares down (200px) → 250px → 5 squares.
    const d = squaresBetweenNorm({ x: 0, y: 0 }, { x: 150 / W, y: 200 / H }, W, H, K);
    expect(d).toBeCloseTo(5, 6);
  });

  it('is symmetric regardless of point order', () => {
    const a = { x: 0.2, y: 0.3 }, b = { x: 0.7, y: 0.9 };
    expect(squaresBetweenNorm(a, b, W, H, K)).toBeCloseTo(squaresBetweenNorm(b, a, W, H, K)!, 9);
  });

  it('returns null when the map is uncalibrated or unsized', () => {
    expect(squaresBetweenNorm({ x: 0, y: 0 }, { x: 1, y: 1 }, W, H, null)).toBeNull();
    expect(squaresBetweenNorm({ x: 0, y: 0 }, { x: 1, y: 1 }, W, H, 0)).toBeNull();
    expect(squaresBetweenNorm({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, H, K)).toBeNull();
  });

  it('feeds a 5-foot-per-square label correctly', () => {
    // 10 squares × 5 = 50.0'
    const squares = squaresBetweenNorm({ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, W, H, K)!;
    expect(`${(squares * 5).toFixed(1)}'`).toBe("50.0'");
  });
});
