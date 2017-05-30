import { expect } from 'chai';
import * as sinon from 'sinon';

import { LocalStorageStrategy, Lock, LockFailedError, MemoryStrategy } from './lockal';

class MockLocalStorage {
  private store: { [key: string]: any } = {};

  public get length() {
    return Object.keys(this.store).length;
  }

  public setItem(key: string, value: string) { // tslint:disable-line
    this.store[key] = value;
  }

  public getItem(key: string): any {
    return this.store[key];
  }

  public removeItem(key: string) {
    delete this.store[key];
  }

  public key(n: number): string | null {
    return Object.keys(this.store)[n];
  }

  public clear() {
    this.store = {};
  }
}

declare const global: any;
declare const localStorage: MockLocalStorage;

global.localStorage = new MockLocalStorage();
let clock: sinon.SinonFakeTimers;

beforeEach(() => {
  clock = sinon.useFakeTimers();
  (<any> LocalStorageStrategy).lastGarbageCollection = 0;
});

afterEach(() => {
  localStorage.clear();
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

describe('localStorage-specific behavior', () => {
  it('runs garbage collection', async () => {
    const lock = new Lock('asdf', { strategy: new LocalStorageStrategy('lockal-', 0) });
    await lock.acquire(1000);
    clearTimeout((<any> lock).clearTimeout);

    // should NOT have run GC, just ran
    new LocalStorageStrategy(); // tslint:disable-line
    expect(localStorage.length).to.equal(1);

    clock.tick(1000 * 60);
    expect(localStorage.length).to.equal(1);

    // should have run GC
    new LocalStorageStrategy(); // tslint:disable-line

    expect(localStorage.length).to.equal(0);
  });
});

[
  {
    name: 'localStroage',
    lock1: new Lock('asdf', { strategy: new LocalStorageStrategy('lockal-', 0) }),
    lock2: new Lock('asdf', { strategy: new LocalStorageStrategy('lockal-', 0) }),
  },
  {
    name: 'memory',
    lock1: new Lock('asdf', { strategy: new MemoryStrategy() }),
    lock2: new Lock('asdf', { strategy: new MemoryStrategy() }),
  },
].forEach(({ name, lock1, lock2 }) => {
  afterEach(() => {
    lock1.release();
    lock2.release();
  });

  describe(`works with ${name} locks`, () => {
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
});
