import { clockSkewMs, formatSendAt } from './scheduleTimes.js';

// The composer's side of scheduled send (#543, design 2.2 and 2.3): the Scheduled view, the
// create key, the edit hold and what the server's refusals mean to the user.
//
// Scheduled edit mode. The Scheduled view opens a message by opening the composer with the
// fields of GET /api/mail/scheduled/:id's spec, as a reopened message has them (accountId,
// aliasId, to, cc, bcc, subject, body, quotedBody, quotedBodyHtml, signature, priority, inReplyTo,
// references and spec.compose), plus
//   scheduled: { id, version, sendAt, timeZone, attachments: [{ index, filename, size, contentType, kind }] }
// and optionally scheduled.editToken when it took the hold itself. The composer then holds the
// message while it is open, renews the lease, saves with PUT under that version, and releases the
// hold when it closes without saving.

// The Scheduled view's id (design 5.2): with no account selected it cannot be a folder's.
export const SCHEDULED_VIEW = '__scheduled__';

// The hold lasts 30 minutes on the server (EDIT_LEASE); it is renewed well before.
export const HOLD_RENEW_MS = 5 * 60_000;

export const isScheduledEdit = composeData => Boolean(composeData?.scheduled?.id);

// The view the schedule toast's View opens. MessageList renders it from step 8 on (design 5.2).
export function openScheduledView(store) {
  store.getState().setSelectedAccount(null, SCHEDULED_VIEW);
}

// A v4 UUID for the create's clientKey, which the server requires to be one. crypto.randomUUID
// needs a secure context, and MailFlow also runs over plain HTTP on a LAN; getRandomValues does not.
export function newClientKey(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const b = cryptoApi.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// How long the "Scheduled for ..." toast offers Undo. Cancel works for minutes on the server; the
// toast is what bounds it, so Undo is there exactly as long as the toast is.
export const SCHEDULE_UNDO_MS = 10_000;
// Send now from the composer saves changes first, and a save needs a time at least a minute
// ahead. When the time the message had has passed, it is saved this far ahead: the 10 s Send now
// sets comes long before, and an Undo of Send now leaves it there, said in its toast.
export const SEND_NOW_SAVE_AHEAD_MS = 5 * 60_000;
// A scheduled message whose time is less than this away is handed back paused when a release
// must not send it (Send now, a hold given back on its own): released as scheduled it would be
// due before the next request could reach the server, and the sender would claim it.
export const DUE_MARGIN_MS = 60_000;
// Send now goes 10 s later (SEND_NOW_DELAY_MS in routes/scheduled.js), the window of its Undo.
export const SEND_NOW_DELAY_MS = 10_000;

// What is left of Send now's window once its answer is in, counted from when the request went
// out rather than from the server's undoUntil, so a wrong clock here cannot shorten or stretch it.
export function sendNowUndoMs(startedAt, now = Date.now()) {
  return Math.max(0, Math.min(SEND_NOW_DELAY_MS, SEND_NOW_DELAY_MS - (now - startedAt)));
}

// Runs `fn` once: a second call (a double click on Undo while its toast fades out) does nothing
// and resolves what the first did.
export function once(fn) {
  let result = null;
  return (...args) => {
    if (!result) result = Promise.resolve().then(() => fn(...args));
    return result;
  };
}

// Undo of a schedule (design 2.2): cancel the message, then reopen the composer with it, as undo
// send does. Cancel is idempotent, so a failure that is not the server's refusal (a lost answer,
// a dropped connection) is tried once more. A refusal is said in the server's words. One that
// still fails points to the Scheduled view, where a cancelled message can be restored for
// minutes. Resolves whether the message came back.
export async function undoSchedule({ id, restoreData }, { cancel, reopen, notify, openView, t }) {
  let err = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await cancel(id);
      reopen(restoreData);
      return true;
    } catch (e) {
      err = e;
      if (e?.status === 409 || e?.status === 404) break;
    }
  }
  if (err?.status === 409 || err?.status === 404) {
    notify({ type: 'error', title: t('compose.scheduleSend.undoFailed'), body: err.message, allowWrap: true, persistent: true });
  } else {
    notify({
      type: 'error', title: t('compose.scheduleSend.undoFailedOpen'), body: err?.message || '', allowWrap: true, persistent: true,
      ...(openView ? { onAction: openView } : {}),
    });
  }
  return false;
}

// Undo of Send now: puts back what Send now replaced. Says when the message goes now, or that it
// is back as it was (paused or failed), or why it could not be undone.
export async function undoSendNow({ id, undoToken, subject }, { undo, notify, t, locale }) {
  try {
    const r = await undo(id, undoToken);
    notify(r?.status === 'scheduled'
      ? { title: t('compose.scheduleSend.scheduledFor', { when: formatSendAt(r.sendAt, locale) }), body: subject }
      : { title: t('compose.scheduleSend.sendNow.undone'), body: subject });
    return true;
  } catch (err) {
    notify({ type: 'error', title: t('compose.scheduleSend.sendNow.undoFailed'), body: err.message, allowWrap: true, persistent: true });
    return false;
  }
}

// What the server answers when an action could send a message that may already have gone out,
// or one a restored backup paused: it asks first, and the same request with confirm: true goes on.
export const needsConfirmation = err => err?.code === 'confirm_uncertain' || err?.code === 'confirm_restored';

// The edit hold of one scheduled message while the composer has it open. `api` is
// api.scheduled. start() takes the hold (or renews the one the opener took), renewals keep it
// every HOLD_RENEW_MS, settle() ends it after a save or an unschedule (the server cleared it),
// handBack() releases it and resolves once the server took it back (throwing, and still holding
// it, when a request failed on the way), and release() hands it back without waiting when the
// composer closes. `onLost(err)` is told when a renewal finds the message is no longer this
// composer's. `isDue()` says whether the message's time has passed, or is about to: a hold given
// back on its own (the message changed meanwhile) then leaves it paused, as one that fell due
// while open is never sent unconfirmed.
export function createEditHold({ id, version, editToken = null }, {
  api, onLost = () => {}, isDue = () => false, schedule = setTimeout, unschedule = clearTimeout, renewMs = HOLD_RENEW_MS,
}) {
  let token = editToken;
  let state = 'starting'; // 'held' | 'releasing' | 'lost' | 'done'
  let statusBefore = null;
  let timer = null;

  const conflict = () => Object.assign(new Error('version_conflict'), { code: 'version_conflict' });
  const arm = () => { unschedule(timer); timer = schedule(renew, renewMs); };
  // The content this composer opened is not the server's any more, so it gives the message back at
  // once rather than leave it held, unsendable, until the lease lapses.
  const giveBack = () => {
    const keepPaused = statusBefore === 'scheduled' && isDue();
    (keepPaused ? api.release(id, token, { keepPaused: true }) : api.release(id, token)).catch(() => {});
  };
  const lose = (err, { release = false } = {}) => {
    if (state !== 'held') return;
    state = 'lost';
    unschedule(timer);
    if (release) giveBack();
    onLost(err);
  };

  async function renew() {
    if (state !== 'held') return;
    try {
      const r = await api.hold(id, token);
      // Saved, released or closed meanwhile: the server refuses a renewal of a hold that ended,
      // so nothing was taken back, and there is nothing to do.
      if (state !== 'held') return;
      if (r.version !== version) return lose(conflict(), { release: true });
      arm();
    } catch (err) {
      if (state !== 'held') return;
      // The server says the message is not this composer's to edit (taken over after a lapsed
      // lease, being sent, deleted).
      if (err?.status === 404 || err?.status === 409) return lose(Object.assign(err, { code: err.code || 'hold_lost' }));
      // Offline or a server error: the lease has 25 more minutes, so the next renewal tries again.
      arm();
    }
  }

  return {
    async start() {
      try {
        const r = await api.hold(id, token);
        token = r.editToken;
        statusBefore = r.statusBefore ?? null;
        // Closed while the hold was being taken: hand it straight back.
        if (state === 'done') {
          api.release(id, token).catch(() => {});
          return { ok: false, closed: true };
        }
        // A newer version than the one opened: given back at once, nothing to save over.
        if (r.version !== version) {
          state = 'held';
          lose(conflict(), { release: true });
          return { ok: false, stale: true, error: conflict() };
        }
        state = 'held';
        arm();
        return { ok: true, version: r.version, statusBefore };
      } catch (err) {
        if (state !== 'done') state = 'lost';
        return { ok: false, error: err };
      }
    },
    token: () => token,
    isHeld: () => state === 'held',
    statusBefore: () => statusBefore,
    // The server said this composer no longer holds it (hold_lost on a save).
    markLost() { if (state === 'held') { state = 'lost'; unschedule(timer); } },
    settle() { state = 'done'; unschedule(timer); },
    // Releases it and waits for the server. Only a release that went through ends the hold: one
    // that failed on the way leaves it held and renewed, so the user can try again; one the
    // server refused (409, 404) means the hold was already gone.
    async handBack({ keepPaused = false } = {}) {
      if (state !== 'held') throw Object.assign(new Error('hold_lost'), { code: 'hold_lost', status: 409 });
      state = 'releasing';
      unschedule(timer);
      try {
        await (keepPaused ? api.release(id, token, { keepPaused: true }) : api.release(id, token));
        state = 'done';
      } catch (err) {
        if (err?.status === 404 || err?.status === 409) state = 'lost';
        else { state = 'held'; arm(); }
        throw err;
      }
    },
    release({ unloading = false } = {}) {
      const held = state === 'held';
      state = 'done';
      unschedule(timer);
      if (!held || !token) return Promise.resolve();
      if (unloading) { api.releaseOnUnload?.(id, token); return Promise.resolve(); }
      return api.release(id, token).then(() => {}, () => {});
    },
  };
}

// What to tell the user about a refused schedule or save. The server's own message leads, since
// it is the authority on its limits; a too_soon or too_far that a wrong clock on this device
// explains says so, with the server's time.
export function scheduleErrorText(err, t, { now = Date.now(), locale } = {}) {
  switch (err?.code) {
    case 'hold_lost':
      return t('compose.scheduleSend.errors.holdLost');
    case 'version_conflict':
      return t('compose.scheduleSend.errors.versionConflict');
    case 'too_soon':
    case 'too_far': {
      const skew = clockSkewMs(err.serverNow, now);
      if (skew == null) return err.message;
      const minutes = Math.max(1, Math.round(Math.abs(skew) / 60_000));
      const time = formatSendAt(err.serverNow, locale, new Date(now));
      const note = skew > 0
        ? t('compose.scheduleSend.errors.clockBehind', { minutes, time })
        : t('compose.scheduleSend.errors.clockAhead', { minutes, time });
      return `${err.message} ${note}`;
    }
    default:
      return err?.message || t('compose.scheduleSend.errors.failed');
  }
}
