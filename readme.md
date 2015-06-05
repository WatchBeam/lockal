# Lockal

[![Build Status](https://img.shields.io/travis/MCProHosting/lockal.svg?style=flat-square)](https://travis-ci.org/MCProHosting/lockal) [![Coverage Status](https://img.shields.io/coveralls/MCProHosting/lockal.svg?style=flat-square)](https://coveralls.io/r/MCProHosting/lockal)

Lockal is a bespoke localStorage based locking system, allowing atomic* actions to be performed across tabs and browser windows.

## Usage

```js
var Lock = require('lockal').Lock;
var lock = new Lock('myAtomicAction');

lock.acquire(function (err, unlock) {
    if (err) {
        console.log('Unable to get lock!');
    } else{
        doSomethingAtomically();
        unlock();
    }
});
```

<sub><sup>* This is not atomic in the true sense, of course, since Javascript doesn't provide the kind of concurrency necessary to ensure entirely thread-safe operations across multiple tabs. This is as close as we can get, though, and should be "good enough" for 99% of use cases.</sup></sub>

### lockal.isEnabled

A boolean to indicate whether localStorage is available on the current platform. Attempting to instantiate a Lock class if isEnabled is false will result in an error being thrown.

### Class: lockal.Lock(key[, options])

Each Lock class is used to interact with a single lock "key". Options usually need not be given, but may be useful if you want to tweak some internals.

#### lock.acquire([ttl][, callback])

Attempts to lock on the key. The lock will remain in place for the TTL, given in milliseconds, or until explicitly unlocked.

Callback will be called with an Error as its first argument if a lock wasn't made. Otherwise, a function will be passed as the second argument to release the lock.

#### lock.mustAcquire([ttl][, callback])

Similar to lock.acquire, but only runs the callback after a lock was successfully established.

#### lock.unlock([force])

Unlocks a key if it was locked by this Locker instance. If `force` is given to be true, the key is unlocked even if the original lock was not put in place by this locker instance.

Returns whether or not the unlock was executed.

## License

This software is MIT licensed, copyright 2015 by Beam LLC.
