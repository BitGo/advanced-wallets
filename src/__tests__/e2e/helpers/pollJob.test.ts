import 'should';
import { pollUntil } from './pollJob';

describe('pollUntil', () => {
  it('returns the first result that satisfies the predicate', async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      (n) => n >= 3,
      { intervalMs: 1, timeoutMs: 1000 },
    );
    result.should.equal(3);
    calls.should.equal(3);
  });

  it('returns immediately when already done', async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      () => true,
      { intervalMs: 1, timeoutMs: 1000 },
    );
    result.should.equal(1);
    calls.should.equal(1);
  });

  it('throws when the timeout elapses before done', async () => {
    await pollUntil(
      async () => 'pending',
      (v) => v === 'done',
      { intervalMs: 1, timeoutMs: 10 },
    ).should.be.rejectedWith(/timed out/);
  });
});
