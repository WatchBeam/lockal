import { expect } from 'chai';
import * as cookie from 'js-cookie'; // tslint:disable-line
import * as sinon from 'sinon';

import { CookieStrategy, Lock, LockFailedError, MemoryStrategy } from './lockal';

class MockCookieStore {
  private store: { [key: string]: any } = {};

  public set(key: string, value: any) { // tslint:disable-line
    this.store[key] = value;
  }

  public getJSON(key: string): any {
    return this.store[key];
  }

  public remove(key: string) {
    delete this.store[key];
  }
}

let cookieSet: sinon.SinonStub;
let cookieGet: sinon.SinonStub;
let cookieRemove: sinon.SinonStub;
let cookieStore: MockCookieStore;
let clock: sinon.SinonFakeTimers;

beforeEach(() => {
  clock = sinon.useFakeTimers();
  cookieStore = new MockCookieStore();
  cookieSet = sinon.stub(cookie, 'set')
    .callsFake((key: string, value: any) => cookieStore.set(key, value));
  cookieGet = sinon.stub(cookie, 'getJSON')
    .callsFake((key: string) => cookieStore.getJSON(key));
  cookieRemove = sinon.stub(cookie, 'remove')
    .callsFake((key: string) => cookieStore.remove(key));
});

afterEach(() => {
  cookieSet.restore();
  cookieGet.restore();
  cookieRemove.restore();
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

describe('cookie-specific behavior', () => {
  it('sets the expiration days correctly', async () => {
    const lock = new Lock('asdf', { strategy: new CookieStrategy('lockal-', 0) });
    await lock.acquire(1000);
    expect(cookieSet.getCall(0).args[2]).to.deep.equal({ expires: 1 });
    await lock.release();

    await lock.acquire(1000 * 60 * 60 * 24 * 1.4);
    expect(cookieSet.getCall(1).args[2]).to.deep.equal({ expires: 2 });
    lock.release();
  });

  it('aborts if someone locked in the meantime', async () => {
    const lock1 = new Lock('asdf', { strategy: new CookieStrategy() });

    const acquire1 = lock1.acquire(1000);
    await waitTick();
    expect(cookieStore.getJSON('lockal-asdf')).to.not.be.undefined;
    clock.tick(10);
    cookieStore.set('lockal-asdf', { id: 'wut '});
    await expect(acquire1).to.eventually.be.rejectedWith(LockFailedError);
  });
});

[
  {
    name: 'cookies',
    lock1: new Lock('asdf', { strategy: new CookieStrategy('lockal-', 0) }),
    lock2: new Lock('asdf', { strategy: new CookieStrategy('lockal-', 0) }),
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
