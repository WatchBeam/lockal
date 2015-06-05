var sinon = require('sinon');
var expect = require('chai').expect;

GLOBAL.window = {
    localStorage: (function () {
        var data = {};

        return {
            setItem: function (key, value) {
                data[key] = value;
            },
            getItem: function (key) {
                return (key in data) ? data[key] : null;
            },
            clear: function () {
                data = {};
            }
        }
    })()
};
var lockal = require('./');
var lock1 = new lockal.Lock('asdf');
var lock2 = new lockal.Lock('asdf');
var clock;

beforeEach(function () {
    window.localStorage.clear();
    clock = sinon.useFakeTimers(100);
});

afterEach(function () {
    clock.restore();
});

describe('the localStorage fixture', function () {
    it('gets null by default', function () {
        expect(window.localStorage.getItem('asdf')).to.be.null;
    });
    it('sets and gets', function () {
        window.localStorage.setItem('asdf', false)
        expect(window.localStorage.getItem('asdf')).to.be.false;
    });
});

describe('lock', function () {
    it('detects that localStorage is enabled', function () {
        expect(lockal.isEnabled).to.be.true;
    });

    it('acquires and persists a lock', function (done) {
        lock1.acquire(function (err, unlock) {
            expect(err).to.be.undefined;

            lock2.acquire(function (err) {
                expect(err).not.to.be.undefined;
                unlock();

                lock2.acquire(function (err) {
                    expect(err).to.be.undefined;
                    done();
                });
                clock.tick(5);
            });
            clock.tick(5);
        });
        clock.tick(5);
    });

    it('unlocks after a ttl', function (done) {
        lock1.acquire(10, function (err, unlock) {
            expect(err).to.be.undefined;
            clock.tick(15);

            lock2.acquire(function (err) {
                expect(err).to.be.undefined;
                done();
            });
            clock.tick(5);
        });
        clock.tick(5);
    });

    it('blocks on mustRequire until available', function (done) {
        lock1.acquire(100, function (err, unlock) {
            expect(err).to.be.undefined;

            var called = false;
            lock2.mustAcquire(function () {
                called = true;
            });

            expect(called).to.be.false;
            clock.tick(90);
            expect(called).to.be.false;
            clock.tick(20);
            expect(called).to.be.true;
            done();
        });
        clock.tick(5);
    });

    it('unlocks own lock when requested', function (done) {
        lock1.acquire(function (err) {
            lock1.unlock();

            lock2.acquire(function (err) {
                expect(err).to.be.undefined;
                done();
            });
            clock.tick(5);
        });
        clock.tick(5);
    });

    it('does not unlock another\'s lock when not forced', function (done) {
        lock1.acquire(function (err) {
            lock2.unlock();

            lock2.acquire(function (err) {
                expect(err).not.to.be.undefined;
                done();
            });
            clock.tick(5);
        });
        clock.tick(5);
    });

    it('unlocks another\'s lock when forced', function (done) {
        lock1.acquire(function (err) {
            lock2.unlock(true);

            lock2.acquire(function (err) {
                expect(err).to.be.undefined;
                done();
            });
            clock.tick(5);
        });
        clock.tick(5);
    });

    it('intercepts locking', function (done) {
        var c = 0;
        lock1.acquire(function (err) {
            expect(err).to.be.undefined;
            c++;
        });
        clock.tick(3);
        lock2.acquire(function (err) {
            expect(err).to.be.defined;
            c++;
        });
        clock.tick(7);
        expect(c).to.equal(2);
        done();
    });
});
