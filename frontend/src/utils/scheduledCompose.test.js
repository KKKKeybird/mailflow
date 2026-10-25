// The composer's side of scheduled send (#543): the edit hold and its lease, the create key, and
// what the server's refusals tell the user.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_RENEW_MS, SCHEDULED_VIEW, createEditHold, isScheduledEdit, needsConfirmation, newClientKey,
  openScheduledView, scheduleErrorText, sendNowUndoMs, undoSchedule, undoSendNow,
} from './scheduledCompose.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const settle = () => new Promise(r => setTimeout(r, 0));
const t = (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key);

// A fake api.scheduled and a timer the test fires by hand.
function harness({ hold } = {}) {
  const calls = [];
  const timers = [];
  const api = {
    hold: async (id, token) => {
      calls.push(['hold', id, token]);
      return hold ? hold(token, calls) : { editToken: token || 'tok-1', version: 3, statusBefore: 'scheduled' };
    },
    release: async (id, token) => { calls.push(['release', id, token]); return { status: 'scheduled' }; },
    releaseOnUnload: (id, token) => { calls.push(['releaseOnUnload', id, token]); },
  };
  const deps = {
    api,
    schedule: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    unschedule: timer => { if (timer) timer.cleared = true; },
  };
  const fire = async () => {
    const live = timers.filter(x => !x.cleared);
    for (const timer of live) timer.cleared = true;
    for (const timer of live) await timer.fn();
  };
  const pending = () => timers.filter(x => !x.cleared);
  return { api, deps, calls, fire, pending };
}

describe('createEditHold', () => {
  test('takes the hold, renews it with its token every five minutes, and releases it', async () => {
    const h = harness();
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    const r = await hold.start();
    assert.deepEqual(r, { ok: true, version: 3, statusBefore: 'scheduled', stale: false });
    assert.equal(hold.isHeld(), true);
    assert.equal(hold.token(), 'tok-1');
    assert.equal(h.pending()[0].ms, HOLD_RENEW_MS);
    await h.fire();
    assert.deepEqual(h.calls[1], ['hold', 'm1', 'tok-1'], 'a renewal passes the token');
    assert.equal(h.pending().length, 1, 'and arms the next one');
    await hold.release();
    assert.deepEqual(h.calls.at(-1), ['release', 'm1', 'tok-1']);
    assert.equal(h.pending().length, 0);
    assert.equal(hold.isHeld(), false);
  });

  test('renews the hold the opener already took', async () => {
    const h = harness();
    const hold = createEditHold({ id: 'm1', version: 3, editToken: 'given' }, h.deps);
    await hold.start();
    assert.deepEqual(h.calls[0], ['hold', 'm1', 'given']);
  });

  test('says when the message it opened is older than what the server has', async () => {
    const h = harness({ hold: () => ({ editToken: 'tok-1', version: 5 }) });
    const r = await createEditHold({ id: 'm1', version: 3 }, h.deps).start();
    assert.equal(r.ok, true);
    assert.equal(r.stale, true);
  });

  test('a refused hold is not held, and nothing is released', async () => {
    const h = harness({ hold: () => { throw Object.assign(new Error('This message is being sent now.'), { status: 409 }); } });
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    const r = await hold.start();
    assert.equal(r.ok, false);
    assert.equal(r.error.message, 'This message is being sent now.');
    await hold.release();
    assert.equal(h.calls.filter(c => c[0] === 'release').length, 0);
  });

  test('a renewal the server refuses tells the composer it lost the message', async () => {
    let n = 0;
    const h = harness({ hold: () => { if (n++ === 0) return { editToken: 'tok-1', version: 3 }; throw Object.assign(new Error('gone'), { status: 409 }); } });
    const lost = [];
    const hold = createEditHold({ id: 'm1', version: 3 }, { ...h.deps, onLost: err => lost.push(err.code) });
    await hold.start();
    await h.fire();
    assert.deepEqual(lost, ['hold_lost']);
    assert.equal(hold.isHeld(), false);
    assert.equal(h.pending().length, 0, 'no more renewals');
    await hold.release();
    assert.equal(h.calls.filter(c => c[0] === 'release').length, 0, 'a lost hold is not released');
  });

  test('a renewal that finds a newer version is a conflict', async () => {
    let n = 0;
    const h = harness({ hold: () => ({ editToken: 'tok-2', version: n++ === 0 ? 3 : 4 }) });
    const lost = [];
    const hold = createEditHold({ id: 'm1', version: 3 }, { ...h.deps, onLost: err => lost.push(err.code) });
    await hold.start();
    await h.fire();
    assert.deepEqual(lost, ['version_conflict']);
  });

  test('a renewal that fails on the network tries again at the next one', async () => {
    let n = 0;
    const h = harness({ hold: () => { if (n++ === 1) throw new TypeError('Failed to fetch'); return { editToken: 'tok-1', version: 3 }; } });
    const lost = [];
    const hold = createEditHold({ id: 'm1', version: 3 }, { ...h.deps, onLost: err => lost.push(err) });
    await hold.start();
    await h.fire();
    assert.equal(lost.length, 0);
    assert.equal(hold.isHeld(), true);
    assert.equal(h.pending().length, 1);
    await h.fire();
    assert.equal(h.calls.filter(c => c[0] === 'hold').length, 3);
  });

  test('closed while the hold was being taken, it hands the message straight back', async () => {
    let resolveHold;
    const h = harness({ hold: () => new Promise(r => { resolveHold = r; }) });
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    const started = hold.start();
    await settle();
    await hold.release();
    resolveHold({ editToken: 'tok-9', version: 3 });
    const r = await started;
    await settle();
    assert.equal(r.closed, true);
    assert.deepEqual(h.calls.at(-1), ['release', 'm1', 'tok-9']);
    assert.equal(h.pending().length, 0);
  });

  test('after a save or an unschedule it neither renews nor releases', async () => {
    const h = harness();
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    await hold.start();
    hold.settle();
    assert.equal(h.pending().length, 0);
    await hold.release();
    assert.equal(h.calls.filter(c => c[0] === 'release').length, 0);
  });

  test('a page going away releases with keepalive', async () => {
    const h = harness();
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    await hold.start();
    await hold.release({ unloading: true });
    assert.deepEqual(h.calls.at(-1), ['releaseOnUnload', 'm1', 'tok-1']);
  });

  test('markLost stops the renewals for a hold a save found lost', async () => {
    const h = harness();
    const hold = createEditHold({ id: 'm1', version: 3 }, h.deps);
    await hold.start();
    hold.markLost();
    assert.equal(hold.isHeld(), false);
    assert.equal(h.pending().length, 0);
  });
});

describe('newClientKey', () => {
  test('is a v4 UUID, also without crypto.randomUUID (plain HTTP)', () => {
    assert.match(newClientKey(), UUID_V4);
    const insecure = { getRandomValues: a => globalThis.crypto.getRandomValues(a) };
    const key = newClientKey(insecure);
    assert.match(key, UUID_V4);
    assert.notEqual(newClientKey(insecure), key);
  });
});

describe('scheduleErrorText', () => {
  const now = Date.parse('2026-10-24T10:00:00Z');
  test('leads with the server message and explains a clock that is off', () => {
    const err = Object.assign(new Error('The scheduled time must be at least a minute from now.'), { code: 'too_soon', serverNow: '2026-10-24T10:07:00.000Z' });
    const text = scheduleErrorText(err, t, { now, locale: 'en-US' });
    assert.match(text, /^The scheduled time must be at least a minute from now\. compose\.scheduleSend\.errors\.clockBehind:/);
    assert.match(text, /"minutes":7/);
    const ahead = Object.assign(new Error('A message can be scheduled at most 366 days ahead.'), { code: 'too_far', serverNow: '2026-10-24T09:50:00.000Z' });
    assert.match(scheduleErrorText(ahead, t, { now, locale: 'en-US' }), /clockAhead:.*"minutes":10/);
  });

  test('a clock that is right adds nothing', () => {
    const err = Object.assign(new Error('Too soon.'), { code: 'too_soon', serverNow: '2026-10-24T10:00:20.000Z' });
    assert.equal(scheduleErrorText(err, t, { now }), 'Too soon.');
  });

  test('a lost hold and a newer version are told in the composer text', () => {
    assert.equal(scheduleErrorText({ code: 'hold_lost', message: 'x' }, t), 'compose.scheduleSend.errors.holdLost');
    assert.equal(scheduleErrorText({ code: 'version_conflict', message: 'x' }, t), 'compose.scheduleSend.errors.versionConflict');
  });

  test('limits and rate limits are told in the server text', () => {
    for (const code of ['too_many', 'too_much_storage', 'payload_too_large', 'rate_limited']) {
      assert.equal(scheduleErrorText(Object.assign(new Error(`server says ${code}`), { code }), t), `server says ${code}`);
    }
    assert.equal(scheduleErrorText({}, t), 'compose.scheduleSend.errors.failed');
  });
});

describe('the rest', () => {
  test('needsConfirmation is the two questions the server asks', () => {
    assert.equal(needsConfirmation({ code: 'confirm_uncertain' }), true);
    assert.equal(needsConfirmation({ code: 'confirm_restored' }), true);
    assert.equal(needsConfirmation({ code: 'hold_lost' }), false);
    assert.equal(needsConfirmation(null), false);
  });

  test('isScheduledEdit is a composer opened on a scheduled message', () => {
    assert.equal(isScheduledEdit({ scheduled: { id: 'm1' } }), true);
    assert.equal(isScheduledEdit({}), false);
    assert.equal(isScheduledEdit(null), false);
  });

  test('openScheduledView selects the Scheduled view with no account', () => {
    const seen = [];
    openScheduledView({ getState: () => ({ setSelectedAccount: (...args) => seen.push(args) }) });
    assert.deepEqual(seen, [[null, SCHEDULED_VIEW]]);
    assert.equal(SCHEDULED_VIEW, '__scheduled__');
  });
});

describe('undoing a schedule', () => {
  test('cancels it, then reopens the composer with it', async () => {
    const order = [];
    const ok = await undoSchedule({ id: 's1', restoreData: { subject: 'Hi' } }, {
      cancel: async id => { order.push(['cancel', id]); },
      reopen: data => { order.push(['reopen', data.subject]); },
      notify: n => order.push(['notify', n]),
      t,
    });
    assert.equal(ok, true);
    assert.deepEqual(order, [['cancel', 's1'], ['reopen', 'Hi']]);
  });

  test('a refused cancel says the server message and reopens nothing', async () => {
    const seen = [];
    const ok = await undoSchedule({ id: 's1', restoreData: {} }, {
      cancel: async () => { throw new Error('This message has already been sent.'); },
      reopen: () => seen.push('reopen'),
      notify: n => seen.push(n),
      t,
    });
    assert.equal(ok, false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].type, 'error');
    assert.equal(seen[0].body, 'This message has already been sent.');
  });
});

describe('undoing Send now', () => {
  test('the window counts from when the request went out', () => {
    assert.equal(sendNowUndoMs(1000, 1000), 10_000);
    assert.equal(sendNowUndoMs(1000, 2500), 8500);
    assert.equal(sendNowUndoMs(1000, 20_000), 0);
  });

  test('puts back what it replaced and says when it goes, or that it is back as it was', async () => {
    const seen = [];
    const calls = [];
    await undoSendNow({ id: 'm1', undoToken: 'tok', subject: 'Hi' }, {
      undo: async (id, token) => { calls.push([id, token]); return { status: 'scheduled', sendAt: '2026-10-28T07:00:00.000Z' }; },
      notify: n => seen.push(n), t, locale: 'en-US',
    });
    assert.deepEqual(calls, [['m1', 'tok']]);
    assert.match(seen[0].title, /^compose\.scheduleSend\.scheduledFor:/);
    await undoSendNow({ id: 'm1', undoToken: 'tok', subject: 'Hi' }, {
      undo: async () => ({ status: 'paused', sendAt: null }), notify: n => seen.push(n), t,
    });
    assert.equal(seen[1].title, 'compose.scheduleSend.sendNow.undone');
  });

  test('a refused undo says the server message', async () => {
    const seen = [];
    const ok = await undoSendNow({ id: 'm1', undoToken: 'tok', subject: 'Hi' }, {
      undo: async () => { throw new Error('Too late to undo: the message is going out.'); },
      notify: n => seen.push(n), t,
    });
    assert.equal(ok, false);
    assert.equal(seen[0].type, 'error');
    assert.equal(seen[0].body, 'Too late to undo: the message is going out.');
  });
});
