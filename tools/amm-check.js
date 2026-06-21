#!/usr/bin/env node
/**
 * AMM calculation verifier — uses the same pure-math functions as prod.
 *
 * Usage:
 *   node tools/amm-check.js          # run all suites
 *   node tools/amm-check.js --stress # include stress suite (slower)
 */

import { initPool, getPrice, getSharesForCost, getSellReturn, applyBuy, applySell } from '../src/db/amm.js';

const STRESS = process.argv.includes('--stress');
const EPS = 1e-6;   // tolerance for floating-point comparisons

// ─── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

function assertNear(a, b, msg, tol = EPS, relative = false) {
  const diff = Math.abs(a - b);
  const ok = relative ? diff / (Math.abs(b) || 1) < tol : diff < tol;
  if (ok) {
    console.log(`  ✓ ${msg}  (${a.toFixed(8)} ≈ ${b.toFixed(8)})`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}  (got ${a.toFixed(8)}, expected ≈ ${b.toFixed(8)}, diff ${diff.toExponential(3)})`);
    failed++;
  }
}

function suite(name, fn) {
  console.log(`\n── ${name} ──`);
  fn();
}

function priceSum(pool) {
  return pool.reduce((s, _, i) => s + getPrice(pool, i), 0);
}

function product(pool) {
  return pool.reduce((p, v) => p * v, 1);
}

// Simulate a market: returns { gristIn, gristOut, winningShares }
// trades = [{type:'buy'|'sell', optionIndex, amount}, ...]
// resolveOption = index of winning outcome
function simulate(numOutcomes, liquidity, trades, resolveOption) {
  const initialPool = initPool(numOutcomes, liquidity);
  let pool = [...initialPool];
  let gristIn = liquidity * numOutcomes;   // initial LP funding
  let gristOut = 0;

  // Track user positions: positions[optionIndex] = total shares held by "users"
  const userShares = Array(numOutcomes).fill(0);

  for (const trade of trades) {
    if (trade.type === 'buy') {
      const { newPool, sharesOut } = applyBuy(pool, trade.optionIndex, trade.amount);
      pool = newPool;
      gristIn += trade.amount;
      userShares[trade.optionIndex] += sharesOut;
    } else {
      // sell: clamp numShares to what's held
      const numShares = Math.min(trade.amount, userShares[trade.optionIndex]);
      if (numShares <= 0) continue;
      const { newPool, payout } = applySell(pool, trade.optionIndex, numShares);
      pool = newPool;
      gristOut += payout;
      userShares[trade.optionIndex] -= numShares;
    }
  }

  const winningShares = userShares[resolveOption];
  return { gristIn, gristOut, winningShares, pool };
}

// ─── suite 1: price invariants ───────────────────────────────────────────────

suite('Price invariants', () => {
  const cases = [
    { n: 2,  liq: 100 },
    { n: 3,  liq: 100 },
    { n: 5,  liq: 200 },
    { n: 10, liq: 50  },
  ];

  for (const { n, liq } of cases) {
    const pool = initPool(n, liq);
    assertNear(priceSum(pool), 1, `prices sum to 1 — ${n}-outcome equal pool`, 1e-9);

    // After a buy
    const { newPool } = applyBuy(pool, 0, 50);
    assertNear(priceSum(newPool), 1, `prices sum to 1 after buy — ${n}-outcome`, 1e-9);

    // Initial equal pool should give equal prices
    assertNear(getPrice(pool, 0), 1 / n, `initial fair price 1/${n} — ${n}-outcome`, 1e-9);
  }

  // Price of bought outcome should rise
  const pool2 = initPool(2, 100);
  const { newPool: after } = applyBuy(pool2, 0, 50);
  assert(getPrice(after, 0) > getPrice(pool2, 0), 'buying YES raises YES price');
  assert(getPrice(after, 1) < getPrice(pool2, 1), 'buying YES lowers NO price');
});

// ─── suite 2: k (invariant product) ─────────────────────────────────────────

suite('Constant-product invariant (k)', () => {
  const cases = [2, 3, 5];
  for (const n of cases) {
    const pool = initPool(n, 100);
    const k0 = product(pool);

    const { newPool: afterBuy } = applyBuy(pool, 0, 75);
    assertNear(product(afterBuy), k0, `k preserved after buy — ${n}-outcome`, 1e-9, true);

    const { newPool: afterSell } = applySell(afterBuy, 0, 20);
    assertNear(product(afterSell), k0, `k preserved after sell — ${n}-outcome`, 1e-9, true);

    // Multiple trades
    let p = [...pool];
    let k = k0;
    for (let i = 0; i < 5; i++) {
      const idx = i % n;
      ({ newPool: p } = applyBuy(p, idx, 30));
      assertNear(product(p), k, `k preserved after buy #${i+1} — ${n}-outcome`, 1e-9, true);
    }
  }
});

// ─── suite 3: round-trip — sell immediately after buy ────────────────────────

suite('Round-trip: buy then sell same shares (expect loss ≤ spread)', () => {
  const costs = [1, 10, 50, 100, 500];
  const pool0 = initPool(2, 100);

  for (const cost of costs) {
    const { newPool, sharesOut } = applyBuy(pool0, 0, cost);
    const { payout } = applySell(newPool, 0, sharesOut);

    // Must always get back ≤ what was spent (AMM takes spread)
    assert(payout <= cost + 1e-9, `round-trip payout (${payout.toFixed(4)}) ≤ cost (${cost})`);

    // Should get back most of it when pool is large relative to trade
    if (cost <= 10) {
      assert(payout > cost * 0.95, `round-trip recovers >95% for small trade (${cost}g)`);
    }
  }

  // Same for 3-outcome
  const pool3 = initPool(3, 100);
  const { newPool: np3, sharesOut: s3 } = applyBuy(pool3, 1, 50);
  const { payout: p3 } = applySell(np3, 1, s3);
  assert(p3 <= 50 + 1e-9, `3-outcome round-trip payout ≤ cost`);
});

// ─── suite 4: sell return monotonicity ──────────────────────────────────────

suite('Sell return monotonicity (more shares → more grist)', () => {
  const pool = initPool(2, 100);
  // Buy a bunch first so we have shares to sell
  const { newPool } = applyBuy(pool, 0, 200);

  let prevPayout = -Infinity;
  for (const shares of [1, 5, 10, 20, 40]) {
    const { payout } = applySell(newPool, 0, shares);
    assert(payout > prevPayout, `sell ${shares} shares returns more than ${prevPayout.toFixed(4)}`);
    prevPayout = payout;
  }
});

// ─── suite 5: solvency — total payout ≤ total grist in ──────────────────────

suite('Solvency: total payout ≤ total grist in system', () => {

  function checkSolvency(label, numOutcomes, liquidity, trades, resolveOption) {
    const { gristIn, gristOut, winningShares } = simulate(numOutcomes, liquidity, trades, resolveOption);
    const available = gristIn - gristOut;
    const solvent = winningShares <= available + 1e-6;
    if (solvent) {
      console.log(`  ✓ ${label}`);
      console.log(`    gristIn=${gristIn.toFixed(2)}  gristOut=${gristOut.toFixed(2)}  available=${available.toFixed(2)}  winShares=${winningShares.toFixed(4)}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}  INSOLVENT!`);
      console.error(`    gristIn=${gristIn.toFixed(2)}  gristOut=${gristOut.toFixed(2)}  available=${available.toFixed(2)}  winShares=${winningShares.toFixed(4)}  overflow=${(winningShares - available).toFixed(4)}`);
      failed++;
    }
  }

  // Simple binary: one buyer, no sells
  checkSolvency('binary — 1 buyer YES wins', 2, 100, [
    { type: 'buy', optionIndex: 0, amount: 50 },
  ], 0);

  checkSolvency('binary — 1 buyer NO wins (loser pays nothing)', 2, 100, [
    { type: 'buy', optionIndex: 0, amount: 50 },
  ], 1);

  // Both sides bet
  checkSolvency('binary — both sides bet, YES wins', 2, 100, [
    { type: 'buy', optionIndex: 0, amount: 100 },
    { type: 'buy', optionIndex: 1, amount: 80 },
  ], 0);

  // Buy then partial sell then resolve
  checkSolvency('binary — buy, partial sell, resolve', 2, 100, [
    { type: 'buy',  optionIndex: 0, amount: 100 },
    { type: 'sell', optionIndex: 0, amount: 30 },
    { type: 'buy',  optionIndex: 0, amount: 60 },
  ], 0);

  // 3-outcome
  checkSolvency('3-outcome — mixed bets, option 2 wins', 3, 100, [
    { type: 'buy', optionIndex: 0, amount: 40 },
    { type: 'buy', optionIndex: 1, amount: 60 },
    { type: 'buy', optionIndex: 2, amount: 80 },
    { type: 'sell', optionIndex: 0, amount: 10 },
  ], 2);

  // Large imbalance: one side gets most bets
  checkSolvency('binary — heavy skew to YES, YES wins', 2, 100, [
    { type: 'buy', optionIndex: 0, amount: 500 },
    { type: 'buy', optionIndex: 0, amount: 500 },
    { type: 'buy', optionIndex: 1, amount: 20 },
  ], 0);

  // Everyone sells before resolution — remaining winners tiny
  checkSolvency('binary — most sold back, remainder resolves', 2, 100, [
    { type: 'buy',  optionIndex: 0, amount: 200 },
    { type: 'sell', optionIndex: 0, amount: 150 },
    { type: 'buy',  optionIndex: 1, amount: 100 },
    { type: 'sell', optionIndex: 1, amount: 80 },
  ], 0);
});

// ─── suite 6: edge cases ────────────────────────────────────────────────────

suite('Edge cases', () => {
  // Tiny buy
  const pool = initPool(2, 100);
  const { sharesOut: tiny } = applyBuy(pool, 0, 0.01);
  assert(tiny > 0, `tiny buy (0.01g) gives positive shares: ${tiny.toFixed(8)}`);

  // Very large buy (approaches pool depletion)
  const { newPool: big, sharesOut: bigShares } = applyBuy(pool, 0, 10000);
  assert(bigShares > 0, `large buy (10000g) gives positive shares: ${bigShares.toFixed(4)}`);
  assert(big[0] > 0, `pool[0] stays positive after large buy: ${big[0].toFixed(8)}`);
  assert(getPrice(big, 0) < 1, `YES price after large buy < 1: ${getPrice(big, 0).toFixed(6)}`);
  assertNear(priceSum(big), 1, 'prices still sum to 1 after large buy', 1e-9);

  // Zero shares returned from sell of 0 (not a real use-case, just a guard)
  const { newPool: np5 } = applyBuy(pool, 0, 50);
  const k5 = product(np5);
  const { newPool: nsell } = applySell(np5, 0, 0.001);
  assertNear(product(nsell), k5, 'k preserved after tiny sell', 1e-6);

  // 5-outcome: Newton solve
  const pool5 = initPool(5, 100);
  const { newPool: np5a, sharesOut: s5 } = applyBuy(pool5, 2, 100);
  assertNear(priceSum(np5a), 1, '5-outcome prices sum to 1 after buy', 1e-9);
  const { payout: p5 } = applySell(np5a, 2, s5 / 2);
  assert(p5 > 0, `5-outcome sell returns positive grist: ${p5.toFixed(6)}`);
  assert(p5 < 100, `5-outcome sell returns less than cost`);
});

// ─── suite 7: getSharesForCost / getSellReturn wrappers ──────────────────────

suite('Public wrapper functions match internal applyBuy/applySell', () => {
  const pool = initPool(2, 100);

  const s1 = getSharesForCost(pool, 0, 50);
  const { sharesOut: s2 } = applyBuy(pool, 0, 50);
  assertNear(s1, s2, 'getSharesForCost matches applyBuy.sharesOut');

  const { newPool } = applyBuy(pool, 0, 50);
  const r1 = getSellReturn(newPool, 0, s2);
  const { payout: r2 } = applySell(newPool, 0, s2);
  assertNear(r1, r2, 'getSellReturn matches applySell.payout');
});

// ─── suite 8: stress test ────────────────────────────────────────────────────

if (STRESS) {
  suite('Stress test: 10 000 random trades, solvency check', () => {
    const RNG_SEED = 42;
    // Simple seeded LCG so results are reproducible
    let seed = RNG_SEED;
    function rand() {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0x100000000;
    }

    const numOutcomes = 4;
    const liquidity   = 500;
    const initialPool = initPool(numOutcomes, liquidity);
    let pool = [...initialPool];

    let gristIn  = liquidity * numOutcomes;
    let gristOut = 0;
    const userShares = Array(numOutcomes).fill(0);

    const NUM_TRADES = 10_000;
    let tradesDone = 0;

    for (let i = 0; i < NUM_TRADES; i++) {
      const optionIndex = Math.floor(rand() * numOutcomes);
      const isSell      = rand() < 0.35 && userShares[optionIndex] > 0;

      if (isSell) {
        const maxShares = userShares[optionIndex];
        const numShares = maxShares * (rand() * 0.9 + 0.01);
        const { newPool, payout } = applySell(pool, optionIndex, numShares);
        pool = newPool;
        gristOut += payout;
        userShares[optionIndex] -= numShares;
      } else {
        const cost = rand() * 200 + 0.5;
        const { newPool, sharesOut } = applyBuy(pool, optionIndex, cost);
        pool = newPool;
        gristIn += cost;
        userShares[optionIndex] += sharesOut;
      }
      tradesDone++;

      // Invariant checks every 1000 trades
      if ((i + 1) % 1000 === 0) {
        // Just check prices sum to 1 (k invariance is validated per-trade in suite 2).
        const ps = priceSum(pool);
        assert(Math.abs(ps - 1) < 1e-8, `[iter ${i+1}] prices sum to 1 (${ps.toFixed(10)})`);
        assert(pool.every(p => p > 0), `[iter ${i+1}] all pool values positive`);
      }
    }

    // Solvency across all outcomes
    for (let opt = 0; opt < numOutcomes; opt++) {
      const available = gristIn - gristOut;
      const winShares = userShares[opt];
      const solvent   = winShares <= available + 1e-4;
      assert(solvent,
        `solvency if option ${opt} wins: winShares=${winShares.toFixed(4)} ≤ available=${available.toFixed(4)}`);
    }

    console.log(`  ℹ  ${tradesDone} trades completed. gristIn=${gristIn.toFixed(2)} gristOut=${gristOut.toFixed(2)} available=${(gristIn - gristOut).toFixed(2)}`);
  });
}

// ─── summary ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAIL — one or more checks failed');
  process.exit(1);
} else {
  console.log('PASS — all checks OK');
}
