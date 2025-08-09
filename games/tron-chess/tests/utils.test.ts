import { describe, it, expect } from 'vitest';
import { squareAt, glyph, minimax, minimaxRoot } from '../src/main';
import { Chess } from 'chess.js';

describe('squareAt', () => {
  it('maps file and rank to algebraic notation', () => {
    expect(squareAt(0, 0)).toBe('a1');
    expect(squareAt(7, 7)).toBe('h8');
    expect(squareAt(4, 3)).toBe('e4');
  });
});

describe('glyph', () => {
  const types = ['k', 'q', 'r', 'b', 'n', 'p'] as const;
  const white = ['\u2654', '\u2655', '\u2656', '\u2657', '\u2658', '\u2659'];
  const black = ['\u265a', '\u265b', '\u265c', '\u265d', '\u265e', '\u265f'];
  types.forEach((t, i) => {
    it(`returns glyph for ${t}`, () => {
      expect(glyph(t, 'w')).toBe(white[i]);
      expect(glyph(t, 'b')).toBe(black[i]);
    });
  });
});

describe('minimax', () => {
  it('evaluates neutral positions as zero', () => {
    const chW = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const chB = new Chess('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(minimax(1, chW, -Infinity, Infinity, true)).toBe(0);
    expect(minimax(1, chB, -Infinity, Infinity, false)).toBe(0);
  });
});

describe('minimaxRoot', () => {
  it('selects capturing moves', () => {
    const chW = new Chess('3qk3/8/8/8/8/8/8/3QK3 w - - 0 1');
    const bestW = minimaxRoot(1, chW, true);
    expect(bestW.from).toBe('d1');
    expect(bestW.to).toBe('d8');

    const chB = new Chess('3qk3/8/8/8/8/8/8/3QK3 b - - 0 1');
    const bestB = minimaxRoot(1, chB, false);
    expect(bestB.from).toBe('d8');
    expect(bestB.to).toBe('d1');
  });
});
