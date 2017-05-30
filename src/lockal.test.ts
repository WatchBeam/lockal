import { expect } from 'chai';
import * as sinon from 'sinon';

import { Lock, LockFailedError, MemoryStrategy } from './lockal';

const lock1 = new Lock('asdf', { strategy: new MemoryStrategy() });
const lock2 = new Lock('asdf', { strategy: new MemoryStrategy() });
let clock: sinon.SinonFakeTimers;

beforeEach(() => {
  clock = sinon.useFakeTimers();
});

afterEach(() => {
  lock1.release();
  lock2.release();
  clock.restore();
});

/**
 * Delays the world by two full cycles of the promise event queue. We use this
 * instead of setTimeout due to fake timers.
 */
const waitTick = () => {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());
};

describe('lock', () => {
  it('acquires and persists a lock', async () => {
    await lock1.acquire(1000);
    await expect(lock2.acquire(1000)).to.eventually.be.rejectedWith(LockFailedError);
    lock1.release();
    await lock2.acquire(1000);
  });

  it('unlocks after a ttl', async () => {
    await lock1.acquire(1000);
    await expect(lock2.acquire(1000)).to.eventually.be.rejectedWith(LockFailedError);
    clock.tick(1001);
    await lock2.acquire(1000);
  });

  it('blocks on mustRequire until available', async () => {
    const stub = sinon.stub();
    await lock1.acquire(1000);
    lock2.mustAcquire(1000).then(stub);

    await waitTick();
    expect(stub.called).to.be.false;
    clock.tick(999);

    await waitTick();
    expect(stub.called).to.be.false;
    clock.tick(100);

    await waitTick();
    expect(stub.called).to.be.true;
  });

  it('does not unlock another\'s lock', async () => {
    await lock1.acquire(1000);
    await expect(lock2.acquire(1000)).to.eventually.be.rejectedWith(LockFailedError);
    lock2.release();
    await expect(lock2.acquire(1000)).to.eventually.be.rejectedWith(LockFailedError);
  });

  it('mustAcquire runs after another unlocks', async () => {
    const stub = sinon.stub();
    await lock1.acquire(1000);
    lock2.mustAcquire(1000).then(stub);

    await waitTick();
    expect(stub.called).to.be.false;
    lock1.release();

    clock.tick(100);
    await waitTick();
    expect(stub.called).to.be.true;
  });

  it('locks around transactions, maintains', async () => {
    const stub = sinon.stub();
    const result = lock1.whilst(async () => {
      await waitTick();
      expect(stub.called).to.be.false;
      clock.tick(2000);

      await waitTick();
      expect(stub.called).to.be.false; // if we don't maintain, the sub would have been called
      return 42;
    });
    lock2.mustAcquire(1000).then(stub);

    await waitTick();
    expect(stub.called).to.be.false;
    await expect(result).to.eventually.equal(42);

    clock.tick(100);
    await waitTick();
    expect(stub.called).to.be.true;
  });
});
