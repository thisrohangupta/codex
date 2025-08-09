import { Chess } from 'chess.js';

type Square =
  `${'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h'}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

const APP = document.getElementById('app')!;

// Simple sound engine using WebAudio beeps
class Sound {
  private ctx: AudioContext | null = null;
  private ensure() {
    if (!this.ctx)
      this.ctx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
  }
  play(freq: number, dur = 0.08, type: OscillatorType = 'sine', gain = 0.06) {
    this.ensure();
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.type = type;
    g.gain.value = gain;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  }
  move() {
    this.play(660, 0.08, 'triangle', 0.05);
  }
  capture() {
    this.play(330, 0.12, 'square', 0.06);
  }
  check() {
    this.play(880, 0.18, 'sawtooth', 0.05);
  }
}
const SND = new Sound();

// App state
let mode: 'hvh' | 'hva' = 'hvh';
let aiDepth = 2;

// Game state
const chess = new Chess();
let orientation: 'w' | 'b' = 'w';

/**
 * Calculate the board rotation for a 3D display. White faces "0deg" while
 * black flips the board 180 degrees around the Z axis.
 */
export function boardRotation(o: 'w' | 'b'): string {
  return o === 'w' ? '0deg' : '180deg';
}
let selected: Square | null = null;
let legal: Set<Square> = new Set();
const history: string[] = [];
let lastFrom: Square | null = null;
let lastTo: Square | null = null;
let thinking = false;

function renderMenu() {
  APP.innerHTML = `
    <div class="splash container">
      <div>
        <div class="logo">TRON CHESS<small>NEON PROTOCOL</small></div>
        <div class="splash-card">
          <div>Choose your mode</div>
          <div class="mode">
            <button class="btn" id="m-hvh">Human vs Human</button>
            <button class="btn" id="m-hva">Human vs AI</button>
            <select id="depth" class="select" title="AI Depth">
              <option value="2">Depth 2</option>
              <option value="3">Depth 3</option>
            </select>
          </div>
          <div class="hintline">Tip: Flip board or Undo in game panel. Audio plays on user gesture.</div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('m-hvh')!.addEventListener('click', () => {
    mode = 'hvh';
    startGame();
  });
  document.getElementById('m-hva')!.addEventListener('click', () => {
    mode = 'hva';
    const d = (document.getElementById('depth') as HTMLSelectElement).value;
    aiDepth = parseInt(d, 10);
    startGame();
  });
}

function startGame() {
  chess.reset();
  selected = null;
  legal.clear();
  history.length = 0;
  lastFrom = lastTo = null;
  orientation = 'w';
  renderGameUI();
}

function renderGameUI() {
  APP.innerHTML = `
  <div class="container">
    <div class="header">
      <div class="title">TRON CHESS</div>
      <span class="badge">${mode === 'hvh' ? 'Local 2P' : 'AI Depth ' + aiDepth}</span>
    </div>
    <div class="board-wrap">
      <div class="board" id="board"></div>
      <div class="panel">
        <div class="status" id="status"></div>
        <div class="controls">
          <button class="btn" id="new">New Game</button>
          <button class="btn ghost" id="flip">Flip Board</button>
          <button class="btn ghost" id="undo">Undo</button>
          <button class="btn ghost" id="menu">Menu</button>
        </div>
        <h3 style="margin-top:14px;">Moves</h3>
        <div class="moves" id="moves"></div>
      </div>
    </div>
  </div>`;
  document.getElementById('new')!.addEventListener('click', () => {
    chess.reset();
    selected = null;
    legal.clear();
    history.length = 0;
    lastFrom = lastTo = null;
    render();
  });
  document.getElementById('flip')!.addEventListener('click', () => {
    orientation = orientation === 'w' ? 'b' : 'w';
    render();
  });
  document.getElementById('undo')!.addEventListener('click', () => {
    if (thinking) return;
    chess.undo();
    history.pop();
    selected = null;
    legal.clear();
    lastFrom = lastTo = null;
    render();
  });
  document
    .getElementById('menu')!
    .addEventListener('click', () => renderMenu());
  render();
}

function squareAt(file: number, rank: number): Square {
  return (String.fromCharCode('a'.charCodeAt(0) + file) + (rank + 1)) as Square;
}

function render() {
  const boardEl = document.getElementById('board')!;
  const statusEl = document.getElementById('status')!;
  const movesEl = document.getElementById('moves')!;
  boardEl.classList.toggle('check', chess.in_check());
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--rot', boardRotation(orientation));
  const grid = document.createElement('div');
  grid.className = 'grid';
  const files = [...Array(8).keys()];
  const ranks = [...Array(8).keys()];
  const rf = orientation === 'w' ? ranks.slice().reverse() : ranks;
  const ff = orientation === 'w' ? files : files.slice().reverse();
  for (const r of rf) {
    for (const f of ff) {
      const sq = squareAt(f, r);
      const piece = chess.get(sq as any);
      const light = (r + f) % 2 === 0;
      const cell = document.createElement('div');
      const movedFrom = lastFrom === sq ? 'move-from' : '';
      const movedTo = lastTo === sq ? 'move-to' : '';
      cell.className =
        `square ${light ? 'light' : 'dark'} ${selected === sq ? 'selected' : ''} ${movedFrom} ${movedTo}`.trim();
      cell.dataset.square = sq;
      cell.addEventListener('click', () => onSquareClick(sq));
      if (legal.has(sq)) {
        const tgt = document.createElement('div');
        tgt.className = piece ? 'capture' : 'hint';
        cell.appendChild(tgt);
      }
      if (piece) {
        const span = document.createElement('span');
        span.className = `piece ${piece.color === 'b' ? 'black' : 'white'}`;
        span.textContent = glyph(piece.type, piece.color);
        cell.appendChild(span);
      }
      grid.appendChild(cell);
    }
  }
  boardEl.appendChild(grid);
  updateStatus(statusEl, movesEl);
  if (mode === 'hva' && chess.turn() === 'b') maybeAITurn();
}

function onSquareClick(sq: Square) {
  if (thinking) return;
  const piece = chess.get(sq as any);
  if (selected) {
    const mv = chess.move({
      from: selected as any,
      to: sq as any,
      promotion: 'q',
    });
    if (mv) {
      history.push(mv.san);
      lastFrom = mv.from as Square;
      lastTo = mv.to as Square;
      selected = null;
      legal.clear();
      if (mv.captured) SND.capture();
      else SND.move();
      if (chess.in_check()) SND.check();
      render();
      return;
    }
  }
  if (piece && piece.color === chess.turn()) {
    selected = sq;
    legal = new Set(
      chess.moves({ square: sq as any, verbose: true }).map((m: any) => m.to),
    );
  } else {
    selected = null;
    legal.clear();
  }
  render();
}

function glyph(type: string, color: 'w' | 'b') {
  const map: Record<string, [string, string]> = {
    k: ['♔', '♚'],
    q: ['♕', '♛'],
    r: ['♖', '♜'],
    b: ['♗', '♝'],
    n: ['♘', '♞'],
    p: ['♙', '♟'],
  };
  const [w, b] = map[type];
  return color === 'w' ? w : b;
}

function updateStatus(statusEl: HTMLElement, movesEl: HTMLElement) {
  const turn = chess.turn() === 'w' ? 'White' : 'Black';
  const inCheck = chess.in_check();
  const over = chess.isGameOver();
  const checkmate = chess.isCheckmate();
  const draw = chess.isDraw();
  statusEl.innerHTML = `
    <div><strong>Turn:</strong> <span class="badge">${turn}${thinking ? ' • AI thinking…' : ''}</span> ${inCheck ? '<span class="badge" style="border-color:#ff5c86aa;color:#ff7da4">Check</span>' : ''}</div>
    <div><strong>State:</strong> ${over ? (checkmate ? '<span class="badge" style="border-color:#ff5c86aa;color:#ff7da4">Checkmate</span>' : draw ? '<span class="badge">Draw</span>' : 'Over') : '<span class="badge">Playing</span>'}</div>
  `;
  movesEl.innerHTML = history
    .map((san, i) => `<div class="move">${i + 1}. ${san}</div>`)
    .join('');
}

// Basic minimax AI with alpha-beta and material eval
export function evaluateBoard(ch: Chess): number {
  const pvals: Record<string, number> = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000,
  };
  let score = 0;
  for (const sq of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
    for (let r = 1; r <= 8; r++) {
      const p = ch.get((sq + String(r)) as any);
      if (!p) continue;
      const v = pvals[p.type];
      score += p.color === 'w' ? v : -v;
    }
  }
  return score;
}

function minimaxRoot(depth: number, ch: Chess, isMax: boolean) {
  const moves: any[] = ch.moves({ verbose: true });
  let bestMove: any = null;
  let bestVal = isMax ? -Infinity : Infinity;
  for (const m of moves) {
    ch.move(m);
    const val = minimax(depth - 1, ch, -Infinity, Infinity, !isMax);
    ch.undo();
    if (isMax && val > bestVal) {
      bestVal = val;
      bestMove = m;
    }
    if (!isMax && val < bestVal) {
      bestVal = val;
      bestMove = m;
    }
  }
  return bestMove;
}

function minimax(
  depth: number,
  ch: Chess,
  alpha: number,
  beta: number,
  maximizing: boolean,
): number {
  if (depth === 0 || ch.isGameOver()) return evaluateBoard(ch);
  const moves: any[] = ch.moves({ verbose: true });
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      ch.move(m);
      best = Math.max(best, minimax(depth - 1, ch, alpha, beta, false));
      ch.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      ch.move(m);
      best = Math.min(best, minimax(depth - 1, ch, alpha, beta, true));
      ch.undo();
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function maybeAITurn() {
  if (mode !== 'hva') return;
  if (chess.turn() !== 'b') return;
  thinking = true;
  render();
  setTimeout(() => {
    const best = minimaxRoot(aiDepth, chess, false);
    if (best) {
      const mv = chess.move(best);
      if (mv) {
        history.push(mv.san);
        lastFrom = mv.from as Square;
        lastTo = mv.to as Square;
        if (mv.captured) SND.capture();
        else SND.move();
        if (chess.in_check()) SND.check();
      }
    }
    thinking = false;
    render();
  }, 50);
}

// Boot
renderMenu();
