import { describe, it, expect } from 'vitest';
import { boardRotation, evaluateBoard } from '../src/main';
import { Chess } from 'chess.js';

describe('boardRotation', () => {
  it('returns 0deg for white', () => {
    expect(boardRotation('w')).toBe('0deg');
  });
  it('returns 180deg for black', () => {
    expect(boardRotation('b')).toBe('180deg');
  });
});

describe('evaluateBoard', () => {
  it('is zero for the starting position', () => {
    const ch = new Chess();
    expect(evaluateBoard(ch)).toBe(0);
  });
  it('decreases when white loses material', () => {
    const ch = new Chess();
    ch.remove('a2');
    expect(evaluateBoard(ch)).toBe(-100);
  });
});
