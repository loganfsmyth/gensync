// Benchmarks for gensync
//
//     node --experimental-bench --bench benchmark.mjs
//
// Other runner options can be appended, e.g.
// `--bench-name-pattern=all` or `--bench-reporter=json`.

import { bench, suite } from "node:bench";
import gensync from "./index.js";

// Leaf operations that the generators below delegate to. Each one returns its
// argument plus one.

// Only a sync implementation: in async mode it resumes the caller
// synchronously.
const syncLeaf = gensync({ sync: x => x + 1 });

// Resolves through a promise, so every call suspends the caller.
const promiseLeaf = gensync({
  sync: x => x + 1,
  async: x => Promise.resolve(x + 1),
});

// Calls back from a microtask, so every call suspends the caller.
const errbackLeaf = gensync({
  sync: x => x + 1,
  errback: (x, cb) => queueMicrotask(() => cb(null, x + 1)),
});

// `steps` sequential calls to `leaf`.
const sequence = leaf =>
  gensync(function* (steps) {
    let x = 0;
    for (let index = 0; index < steps; index++) {
      x = yield* leaf(x);
    }
    return x;
  });

// A chain of `depth` nested generators around a single call to `leaf`.
const nested = leaf => {
  const fn = gensync(function* (depth) {
    if (depth === 0) {
      return yield* leaf(0);
    }
    return (yield* fn(depth - 1)) + 1;
  });
  return fn;
};

// `gensync.all` / `gensync.race` over `steps` calls to `leaf`.
const combine = (combinator, leaf) =>
  gensync(function* (steps) {
    const items = [];
    for (let index = 0; index < steps; index++) {
      items.push(leaf(index));
    }
    const result = yield* combinator(items);
    return Array.isArray(result) ? result.length : result;
  });

const all = leaf => combine(gensync.all, leaf);
const race = leaf => combine(gensync.race, leaf);

// Promisifies an errback-style call.
const viaErrback = (fn, ...args) =>
  new Promise((resolve, reject) => {
    fn.errback(...args, (err, value) => (err ? reject(err) : resolve(value)));
  });

// `steps` is the number of leaf calls, or the nesting depth for `nested`.
const inputs = [1, 10, 100].map(steps => ({
  steps,
  params: { steps },
}));

// Fast operations are repeated within each sample until the sample takes at
// least this long, so that timer reads and per-sample overhead don't dominate
// the result.
const TARGET_SAMPLE_NS = 10_000_000n; // 10 ms
const MAX_REPEAT = 1 << 20;

// Each benchmark takes up to `MAX_SAMPLES` measured samples, but stops early
// via `context.done()` once it has `MIN_SAMPLES` and has spent
// `TIME_BUDGET_NS` in measured regions.
const MAX_SAMPLES = 15;
const MIN_SAMPLES = 5;
const TIME_BUDGET_NS = 1_000_000_000n; // 1 s

// Declares one benchmark per input.
//
// * `run(input)` performs the measured operation and returns a number derived
//   from its result, or a promise for one when `async` is true. The sum over
//   all repetitions is checked after each sample, so the work can't be
//   optimized away. Async runs are awaited one after another, so a sample
//   measures latency rather than throughput.
// * `operations(input)` is the number of operations one call to `run`
//   performs. **Default:** 1.
//
// The warmup invocation calibrates how often `run` is repeated per sample by
// doubling the repeat count until a batch reaches `TARGET_SAMPLE_NS`. When
// warmup is disabled (`--bench-warmup=0`), the first measured sample
// calibrates instead. Every sample's `detail` records the repeat count.
const benchEach = (name, { run, async = false, operations = () => 1 }) => {
  for (const input of inputs) {
    const operationsPerRun = operations(input);
    let repeat = 0;
    let expected;
    let elapsed = 0n;

    const runAll = async
      ? async count => {
          let total = 0;
          for (let index = 0; index < count; index++) {
            total += await run(input);
          }
          return total;
        }
      : count => {
          let total = 0;
          for (let index = 0; index < count; index++) {
            total += run(input);
          }
          return total;
        };
    const check = (total, count) => {
      if (total !== expected * count) {
        throw new Error(
          `Unexpected result: ${total} after ${count} runs, expected ` +
            `${expected} per run`
        );
      }
    };
    // Stops the benchmark once it has used up its time budget.
    const account = (b, sample) => {
      if (b.phase !== "measurement") {
        return;
      }
      elapsed += sample.duration_ns;
      if (b.index + 1 >= MIN_SAMPLES && elapsed >= TIME_BUDGET_NS) {
        b.done();
      }
    };

    bench(
      name,
      {
        samples: MAX_SAMPLES,
        warmup: 1,
        params: input.params,
      },
      async b => {
        if (!repeat) {
          expected = await run(input);
          let count = 1;
          let total;
          let duration;
          for (;;) {
            const start = process.hrtime.bigint();
            total = runAll(count);
            if (async) total = await total;
            duration = process.hrtime.bigint() - start;
            if (duration >= TARGET_SAMPLE_NS || count >= MAX_REPEAT) {
              break;
            }
            count *= 2;
          }
          check(total, count);
          repeat = count;
          account(
            b,
            b.record({
              operations: count * operationsPerRun,
              duration_ns: duration,
              detail: { repeat },
            })
          );
          return;
        }
        // Collect garbage from earlier samples outside the measured region,
        // when running with `--expose-gc`.
        globalThis.gc?.();
        b.start();
        let total = runAll(repeat);
        if (async) total = await total;
        const sample = b.end(repeat * operationsPerRun, { detail: { repeat } });
        check(total, repeat);
        account(b, sample);
      }
    );
  }
};

const steps = ({ steps }) => steps;

suite("sync", () => {
  const sequenceFn = sequence(syncLeaf);
  benchEach("sequence", {
    run: ({ steps }) => sequenceFn.sync(steps),
    operations: steps,
  });

  const nestedFn = nested(syncLeaf);
  benchEach("nested", {
    run: ({ steps }) => nestedFn.sync(steps),
    operations: steps,
  });

  const allFn = all(syncLeaf);
  benchEach("all", {
    run: ({ steps }) => allFn.sync(steps),
    operations: steps,
  });
});

suite("async", () => {
  const syncSequenceFn = sequence(syncLeaf);
  benchEach("sequence, sync leaf", {
    async: true,
    run: ({ steps }) => syncSequenceFn.async(steps),
    operations: steps,
  });

  const promiseSequenceFn = sequence(promiseLeaf);
  benchEach("sequence, promise leaf", {
    async: true,
    run: ({ steps }) => promiseSequenceFn.async(steps),
    operations: steps,
  });

  const errbackSequenceFn = sequence(errbackLeaf);
  benchEach("sequence, errback leaf", {
    async: true,
    run: ({ steps }) => errbackSequenceFn.async(steps),
    operations: steps,
  });

  const nestedFn = nested(promiseLeaf);
  benchEach("nested, promise leaf", {
    async: true,
    run: ({ steps }) => nestedFn.async(steps),
    operations: steps,
  });

  const allFn = all(promiseLeaf);
  benchEach("all, promise leaf", {
    async: true,
    run: ({ steps }) => allFn.async(steps),
    operations: steps,
  });

  const raceFn = race(promiseLeaf);
  benchEach("race, promise leaf", {
    async: true,
    run: ({ steps }) => raceFn.async(steps),
    operations: steps,
  });
});

suite("errback", () => {
  const syncSequenceFn = sequence(syncLeaf);
  benchEach("sequence, sync leaf, via errback", {
    async: true,
    run: ({ steps }) => viaErrback(syncSequenceFn, steps),
    operations: steps,
  });

  const errbackSequenceFn = sequence(errbackLeaf);
  benchEach("sequence, errback leaf, via errback", {
    async: true,
    run: ({ steps }) => viaErrback(errbackSequenceFn, steps),
    operations: steps,
  });
});
