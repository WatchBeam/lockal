export interface ILockStrategy {
  /**
   * Attempts to acquire the lock, rejecting with LockFailedError if it
   * cannot.
   */
  acquire(key: string, id: string, ttl: number): Promise<void>;

  /**
   * Releases the lock, if we're holding it.
   */
  release(key: string, id: string): void;
}

function delay(duration: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(() => resolve(), duration));
}

interface ICookieContents {
  expiresAt: number;
  id: string;
}

/**
 * LocalStorageStrategy _attempts_ to maintain locks using the browser's cookie
 * store. This allows cross-tab locking to occur, but it is possible for
 * races to happen, though we make an effort to avoid them.
 */
export class LocalStorageStrategy implements ILockStrategy {
  private static lastGarbageCollection = 0;
  private static garbageCollectionInterval = 1000 * 60;

  private releaseTimeout: number;

  constructor(
    private readonly prefix: string = 'lockal-',
    private readonly checkDelay: number = 5,
  ) {
    // Collect garbage every once and a while so we don't orphan locks
    // forever if, for example, the locking tab is closed.
    const nextGc = LocalStorageStrategy.lastGarbageCollection + LocalStorageStrategy.garbageCollectionInterval;
    if (nextGc <= Date.now()) {
      this.garbageCollect();
    }
  }

  /**
   * @override
   */
  public acquire(key: string, id: string, ttl: number): Promise<void> {
    if (ttl < this.checkDelay) {
      throw new Error(`The lock TTL may not be less then ${this.checkDelay}ms (got ${ttl})`);
    }

    clearTimeout(this.releaseTimeout);
    const holder = this.getHolder(key);
    if (holder && holder !== id) {
      return Promise.reject(new LockFailedError('That key is already locked'));
    }

    this.setValue(key, { id, expiresAt: Date.now() + ttl });
    if (this.checkDelay === 0) {
      return Promise.resolve();
    }

    return delay(this.checkDelay).then(() => {
      if (this.getHolder(key) !== id) {
        throw new LockFailedError('Failed to acquire the lock');
      } else {
        setTimeout(() => this.release(key, id), ttl);
      }
    });
  }

  /**
   * @override
   */
  public release(key: string, id: string) {
    const holder = this.getHolder(key);
    if (!holder || holder === id) {
      localStorage.removeItem(this.prefix + key);
    }
  }

  private getHolder(key: string): string | null {
    const value = this.getValue(key);
    if (value && value.expiresAt > Date.now()) {
      return value.id;
    }

    return null;
  }

  private getValue(sourceKey: string): ICookieContents | null {
    const value = localStorage.getItem(this.prefix + sourceKey);
    try {
      return value && JSON.parse(value);
    } catch (e) {
      return null;
    }
  }

  private setValue(sourceKey: string, value: ICookieContents) {
    return localStorage.setItem(this.prefix + sourceKey, JSON.stringify(value));
  }

  private garbageCollect() {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.prefix)) {
        continue;
      }

      if (!this.getHolder(key.slice(this.prefix.length))) {
        localStorage.removeItem(key);
        i -= 1;
      }
    }

    LocalStorageStrategy.lastGarbageCollection = Date.now();
  }
}

interface IMemoryContents extends ICookieContents {
  removerTimeout: number;
}

const memoryStore: { [key: string]: IMemoryContents } = Object.create(null);

/**
 * MemoryStrategy stores locks in memory locally. It is fully atomic.
 */
export class MemoryStrategy implements ILockStrategy {
  /**
   * @override
   */
  public acquire(key: string, id: string, ttl: number): Promise<void> {
    const value = memoryStore[key];
    const now = Date.now();
    if (value && now < value.expiresAt) {
      if (value.id === id) {
        clearTimeout(value.removerTimeout);
      } else {
        return Promise.reject(new LockFailedError('Failed to acquire the lock'));
      }
    }

    const removerTimeout = setTimeout(() => { delete memoryStore[key]; }, ttl);
    memoryStore[key] = { id, expiresAt: now + ttl, removerTimeout };
    return Promise.resolve();
  }

  /**
   * @override
   */
  public release(key: string, id: string): void {
    const value = memoryStore[key];
    if (value && value.id === id) {
      clearTimeout(value.removerTimeout);
      delete memoryStore[key];
    }
  }
}

/**
 * A LockFailedError is thrown when an attempt to acquire a lock fails.
 */
export class LockFailedError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, LockFailedError.prototype);
  }
}

/**
 * ILockOptions are passed into the Lock to configure it.
 */
export interface ILockOptions {
  /**
   * Strategy to use for locking (LocalStorageStragy by default).
   */
  strategy: ILockStrategy;

  /**
   * Duration between retries, in milliseconds, when using mustAcquire.
   * Defaults to 20ms.
   */
  retryInterval: number;
}

/**
 * Each Lock class is used to interact with a single lock "key". It provides
 * methods to lock and unlock that key.
 */
export class Lock {
  private readonly options: ILockOptions;
  private readonly id = `${Date.now()}-${Math.random()}`;
  private maintenanceLoop: number | null = null;

  constructor(
    private readonly key: string,
    options: Partial<ILockOptions> = {},
  ) {
    this.options = {
      strategy: new MemoryStrategy(),
      retryInterval: 20,
      ...options,
    };
  }

  /**
   * Attempts to lock on the key. The lock will remain in place for the
   * TTL, given in milliseconds, or until explicitly unlocked.
   *
   * The promise will reject with a LockFailedError if the lock cannot be made
   * at this time. In contrast to mustAcquire, this will not retry.
   */
  public acquire(ttl: number): Promise<void> {
    return this.options.strategy.acquire(this.key, this.id, ttl);
  }

  /**
   * Releases the lock, if we're holding it.
   */
  public release(): void {
    if (this.maintenanceLoop !== null) {
      clearInterval(this.maintenanceLoop);
      this.maintenanceLoop = null;
    }

    return this.options.strategy.release(this.key, this.id);
  }

  /**
   * mustAcquire attempts to get the lock, waiting until it either does so
   * or the timeout occurs, at which point it can throw a LockFailedError.
   */
  public mustAcquire(ttl: number, timeout: number = 10 * 1000): Promise<void> {
    const startedAt = Date.now();
    const run = (): Promise<void> => {
      if (Date.now() >= startedAt + timeout) {
        return Promise.reject(new LockFailedError('Timed out trying to acquire lock'));
      }

      return this.acquire(ttl).catch(err => {
        if (err instanceof LockFailedError) {
          return delay(this.options.retryInterval).then(run);
        }

        throw err;
      });
    };

    return run();
  }

  /**
   * whilst holds and maintains the lock until the wrapped promise resolves
   * or rejects, using mustAcquire. It touches the lock occasionally to ensure
   * that no one else grabs it while the transaction is running.
   *
   * @example
   * lock.whilst(() => doSomeTransaction())
   *   .then(result => console.log('transaction result': result));
   */
  public whilst<T>(fn: () => Promise<T> | T, ttl: number = 1000, timeout?: number): Promise<T> {
    return this.mustAcquire(ttl, timeout)
      .then(() => {
        this.maintenanceLoop = setInterval(() => {
          this.acquire(ttl).catch(() => undefined);
        }, ttl / 2);

        return fn();
      })
      .then(value => {
        this.release();
        return value;
      })
      .catch(err => {
        this.release();
        throw err;
      });
  }
}
