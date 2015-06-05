var localStorage = window.localStorage;
exports.isEnabled = !!localStorage;

/**
 * Each Lock class is used to interact with a single lock "key". It
 * provides method to lock and unlock on that key.
 *
 * @param {String} key
 * @param {Object} [options]
 * @property {Number} [options.lockCheck=5]
 *           Time to wait after a lock to ensure it's not going to
 *           be written over by another tab.
 * @property {Number} [options.retryInterval=2]
 *           Duration between retries on mustAcquire.
 * @property {Number} [options.maintainInterval=1000]
 *           How often the maintainer should touch the lock.
 */
function Lock (key, options) {
    if (!exports.isEnabled) {
        throw new Error('Attempted to use Lockal in an environment' +
            ' which does not support localStorage.');
    }

    this.key = key;
    this.uid = Math.random().toString();

    options = options || {};
    this.lockCheck = options.lockCheck || 5;
    this.retryInterval = options.retryInterval || 2;
    this.maintainInterval = options.maintainInterval || 1000;
    this.isMaintaining = false;
}

/**
 * Attempts to lock on the key. The lock will remain in place for the
 * TTL, given in milliseconds, or until explicitly unlocked.
 *
 * Callback will be called with an Error as its first argument if a
 * lock wasn't made. Otherwise, a function will be passed as the
 * second argument to release the lock.
 *
 * @param  {Number}   [ttl]
 * @param  {Function} callback
 */
Lock.prototype.acquire = function (ttl, callback) {
    var args = resolveArgs(ttl, callback);
    var lt = this.lockedTo();
    if (lt && lt !== this.uid) {
        return args.callback(new Error('Key already locked'));
    }

    var unlock = this.unlock.bind(this);
    var maintain = this.maintain.bind(this);
    var self = this;
    this.addLock(args.ttl);

    setTimeout(function () {
        if (self.lockedTo() !== self.uid) {
            args.callback(new Error('Lock was unable to be acquired.'));
        } else {
            if (args.ttl) {
                setTimeout(function () {
                    if (!self.isMaintaining) unlock();
                }, args.ttl);
            }

            args.callback(undefined, unlock, maintain);
        }
    }, this.lockCheck);
};

/**
 * Similar to lock.acquire, but only runs the callback after a lock
 * was successfully established.
 *
 * @param  {Number}   ttl
 * @param  {Function} callback
 */
Lock.prototype.mustAcquire = function (ttl, callback) {
    var args = resolveArgs(ttl, callback);
    var self = this;

    this.acquire(args.ttl, function (err) {
        if (err) {
            // localStorage queries are pretty fast, so frequent
            // querying should not be an issue here.
            setTimeout(function () {
                self.mustAcquire(ttl, callback);
            }, self.retryInterval);
        } else {
            args.callback.apply(self, arguments);
        }
    });
};

/**
 * Unlocks a key if it was locked by this Locker instance. If
 * `force` is given to be true, the key is unlocked even if the
 * original lock was not put in place by this locker instance.
 *
 * @param  {Boolean} [force=false]
 * @return {Boolean}
 */
Lock.prototype.unlock = function (force) {
    if (force || this.lockedTo() === this.uid) {
        localStorage.setItem(this.getKey(), null);
    }
};

/**
 * Keeps updating the expiration on the lock, so long as the
 * lock is acquired.
 */
Lock.prototype.maintain = function () {
    if (this.lockedTo() === this.uid) {
        this.isMaintaining = true;
        this.addLock(this.maintainInterval * 1.1);

        var self = this;
        setTimeout(function () {
            self.maintain();
        }, this.maintainInterval);

    } else {
        this.isMaintaining = false;
    }

};

/**
 * Returns the localStorage key for this lock.
 * @private
 * @return {String}
 */
Lock.prototype.getKey = function () {
    return '__lockal_' + this.key;
};

/**
 * Returns the uid that the localStore is locked to, or null.
 * @private
 * @return {String}
 */
Lock.prototype.lockedTo = function () {
    var item = localStorage.getItem(this.getKey());
    if (!item) return null;

    item = item.split('-');

    if (item[1] === '0' || parseInt(item[1], 10) >= Date.now()) {
        return item[0];
    } else {
        return null;
    }
};

/**
 * Adds a lock for this instance in storage.
 * @param {Number} [ttl]
 */
Lock.prototype.addLock = function (ttl) {
    var ends = ttl ? (Date.now() + ttl) : 0;
    localStorage.setItem(this.getKey(), this.uid + '-' + ends);
};

exports.Lock = Lock;

/**
 * Resolves a set of arguments into an object.
 * @param  {Number}   [ttl]
 * @param  {Function} [callback]
 * @return {Object}
 */
function resolveArgs(ttl, callback) {
    if (typeof ttl === 'function') {
        return { callback: ttl, ttl: undefined };
    } else {
        return { callback: callback || noop, ttl: ttl };
    }
}

function noop () {}

