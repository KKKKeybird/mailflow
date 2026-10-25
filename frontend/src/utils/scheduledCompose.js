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

// What the server answers when an action could send a message that may already have gone out,
// or one a restored backup paused: it asks first, and the same request with confirm: true goes on.
export const needsConfirmation = err => err?.code === 'confirm_uncertain' || err?.code === 'confirm_restored';

// The edit hold of one scheduled message while the composer has it open. `api` is
// api.scheduled. start() takes the hold (or renews the one the opener took), renewals keep it
// every HOLD_RENEW_MS, settle() ends it after a save or an unschedule (the server cleared it),
// release() hands the message back when the composer closes without saving. `onLost(err)` is
// told when a renewal finds the message is no longer this composer's.
export function createEditHold({ id, version, editToken = null }, {
  api, onLost = () => {}, schedule = setTimeout, unschedule = clearTimeout, renewMs = HOLD_RENEW_MS,
}) {
  let token = editToken;
  let state = 'starting'; // 'held' | 'lost' | 'done'
  let timer = null;

  const arm = () => { unschedule(timer); timer = schedule(renew, renewMs); };
  const lose = err => {
    if (state === 'done' || state === 'lost') return;
    state = 'lost';
    unschedule(timer);
    onLost(err);
  };

  async function renew() {
    if (state !== 'held') return;
    try {
      const r = await api.hold(id, token);
      if (state !== 'held') return;
      // A different token means the hold had lapsed and this took it again; the content is still
      // what this composer opened only if nobody saved it meanwhile.
      token = r.editToken;
      if (r.version !== version) return lose(Object.assign(new Error('version_conflict'), { code: 'version_conflict' }));
      arm();
    } catch (err) {
      if (state !== 'held') return;
      // The server says the message is not this composer's to edit (being sent, deleted).
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
        // Closed while the hold was being taken: hand it straight back.
        if (state === 'done') {
          api.release(id, token).catch(() => {});
          return { ok: false, closed: true };
        }
        state = 'held';
        arm();
        return { ok: true, version: r.version, statusBefore: r.statusBefore ?? null, stale: r.version !== version };
      } catch (err) {
        if (state !== 'done') state = 'lost';
        return { ok: false, error: err };
      }
    },
    token: () => token,
    isHeld: () => state === 'held',
    // The server said this composer no longer holds it (hold_lost on a save).
    markLost() { if (state === 'held') { state = 'lost'; unschedule(timer); } },
    settle() { state = 'done'; unschedule(timer); },
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
