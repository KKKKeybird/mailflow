import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  browserTimeZone, checkSendAt, dateBounds, defaultCustom, formatSendAt, localDateTimeValue, localDateValue,
  localTimeValue, presets, resolveCustom, resolveLocalDateTime,
} from '../utils/scheduleTimes.js';

// The composer's Send later (#543, design 5.1 and 5.4): the menu of the split Send button on
// desktop, the sheet behind the clock button on phones, the date and time picker both share, the
// strip a scheduled message shows while it is edited, and the dialogs scheduling asks with.

const PRESET_LABELS = {
  tomorrowMorning: 'compose.scheduleSend.tomorrowMorning',
  tomorrowAfternoon: 'compose.scheduleSend.tomorrowAfternoon',
  mondayMorning: 'compose.scheduleSend.mondayMorning',
};

const PROBLEM_TEXT = {
  invalid: 'compose.scheduleSend.errors.invalid',
  past: 'compose.scheduleSend.errors.past',
  tooSoon: 'compose.scheduleSend.errors.tooSoon',
  tooFar: 'compose.scheduleSend.errors.tooFar',
};

const clockIcon = (size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
export const SendLaterIcon = ({ size }) => clockIcon(size);

const fieldStyle = (mobile) => ({
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-hover)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text-primary)', fontSize: mobile ? 16 : 13,
  padding: mobile ? '10px 10px' : '6px 8px', outline: 'none', colorScheme: 'dark light',
  minHeight: mobile ? 44 : undefined,
});
const labelStyle = { display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 };

// Picks a date and a time, in the browser's time zone. `variant` 'split' has a date and a time
// input (desktop, as the snooze picker), 'single' one datetime-local input, which brings the
// platform's own picker on iOS and Android. The limits here only guide; the server decides.
export function SchedulePicker({ variant = 'split', now, onSubmit, submitLabel, busy = false, autoFocus = true }) {
  const { t } = useTranslation();
  const id = useId();
  const opened = useMemo(() => now ?? new Date(), [now]);
  const start = defaultCustom(opened);
  const [date, setDate] = useState(() => localDateValue(start));
  const [time, setTime] = useState(() => localTimeValue(start));
  const [dateTime, setDateTime] = useState(() => localDateTimeValue(start));
  const firstRef = useRef(null);
  useEffect(() => { if (autoFocus) firstRef.current?.focus(); }, [autoFocus]);

  const at = variant === 'single' ? resolveLocalDateTime(dateTime) : resolveCustom(date, time);
  const problem = checkSendAt(at, now ?? new Date());
  const bounds = dateBounds(opened);
  const zone = browserTimeZone();
  const statusId = `${id}-status`;
  const mobile = variant === 'single';

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (!problem && !busy) onSubmit(at); }}
      style={{ padding: mobile ? '12px 20px 4px' : '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {variant === 'single' ? (
        <div>
          <label htmlFor={`${id}-dt`} style={labelStyle}>{t('compose.scheduleSend.dateTimeLabel')}</label>
          <input
            ref={firstRef} id={`${id}-dt`} type="datetime-local" value={dateTime} step={60}
            min={`${bounds.min}T00:00`} max={`${bounds.max}T23:59`}
            aria-invalid={problem ? 'true' : undefined} aria-describedby={statusId}
            onChange={e => setDateTime(e.target.value)} style={fieldStyle(true)}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor={`${id}-date`} style={labelStyle}>{t('compose.scheduleSend.dateLabel')}</label>
            <input
              ref={firstRef} id={`${id}-date`} type="date" value={date} min={bounds.min} max={bounds.max}
              aria-invalid={problem ? 'true' : undefined} aria-describedby={statusId}
              onChange={e => setDate(e.target.value)} style={fieldStyle(false)}
            />
          </div>
          <div style={{ width: 110, flexShrink: 0 }}>
            <label htmlFor={`${id}-time`} style={labelStyle}>{t('compose.scheduleSend.timeLabel')}</label>
            <input
              id={`${id}-time`} type="time" value={time} step={60}
              aria-invalid={problem ? 'true' : undefined} aria-describedby={statusId}
              onChange={e => setTime(e.target.value)} style={fieldStyle(false)}
            />
          </div>
        </div>
      )}
      <div id={statusId} aria-live="polite" data-schedule-status=""
        style={{ fontSize: 12, minHeight: 16, color: problem ? 'var(--red)' : 'var(--text-secondary)' }}>
        {problem ? t(PROBLEM_TEXT[problem]) : t('compose.scheduleSend.sendsAt', { when: formatSendAt(at, undefined, opened) })}
      </div>
      {zone && <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('compose.scheduleSend.timeZone', { zone })}</div>}
      <button
        type="submit" disabled={Boolean(problem) || busy}
        style={{
          width: '100%', background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 6,
          padding: mobile ? '12px 0' : '7px 0', minHeight: mobile ? 44 : undefined, fontSize: mobile ? 15 : 13, fontWeight: 500,
          cursor: problem || busy ? 'default' : 'pointer', opacity: problem || busy ? 0.5 : 1,
        }}
      >
        {submitLabel || t('compose.scheduleSend.schedule')}
      </button>
    </form>
  );
}

const menuItemStyle = {
  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px',
  background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer',
  fontSize: 13, color: 'var(--text-primary)', outline: 'none',
};
const hover = { onMouseEnter: e => { e.currentTarget.style.background = 'var(--bg-hover)'; }, onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; },
  onFocus: e => { e.currentTarget.style.background = 'var(--bg-hover)'; }, onBlur: e => { e.currentTarget.style.background = 'transparent'; } };

// The desktop menu, opened from the split Send button's chevron (`triggerRef`). It is an ARIA
// menu: arrow keys, Home and End move, Escape closes it and gives focus back to the chevron, Tab
// leaves it. "Pick date and time" turns it into a small dialog with the picker; Escape there goes
// back to the list. `onPick(date)` schedules; `editing` adds Unschedule.
export function SendLaterMenu({ triggerRef, onClose, onPick, editing = false, onUnschedule, now: nowProp, busy = false }) {
  const { t } = useTranslation();
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [view, setView] = useState('menu');
  const boxRef = useRef(null);
  const pickItemRef = useRef(null);
  const items = presets(now);

  const close = (refocus = true) => {
    onClose();
    if (refocus) triggerRef?.current?.focus();
  };

  useEffect(() => {
    if (view !== 'menu') return;
    const first = boxRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
  }, [view]);

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current?.contains(e.target) || triggerRef?.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, triggerRef]);

  const onMenuKeyDown = (e) => {
    const list = [...(boxRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    const at = list.indexOf(document.activeElement);
    const move = (i) => { e.preventDefault(); list[(i + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at < 0 ? list.length - 1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };

  const onPickKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setView('menu');
    setTimeout(() => pickItemRef.current?.focus(), 0);
  };

  return (
    <div
      ref={boxRef}
      style={{
        position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 20,
        width: 320, maxWidth: 'calc(100vw - 32px)', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', overflow: 'hidden', padding: view === 'menu' ? '4px 0' : 0,
      }}
    >
      {view === 'menu' ? (
        <div role="menu" aria-label={t('compose.scheduleSend.title')} onKeyDown={onMenuKeyDown}>
          <div aria-hidden="true" style={{ padding: '6px 14px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {editing ? t('compose.scheduleSend.changeTime') : t('compose.scheduleSend.title')}
          </div>
          {items.map(p => (
            <button key={p.id} type="button" role="menuitem" tabIndex={-1} disabled={busy}
              data-preset={p.id} onClick={() => { onClose(); onPick(p.at); }} style={menuItemStyle} {...hover}>
              <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{clockIcon()}</span>
              <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{t(PRESET_LABELS[p.id])}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatSendAt(p.at, undefined, now)}</span>
            </button>
          ))}
          <div role="separator" style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
          <button ref={pickItemRef} type="button" role="menuitem" tabIndex={-1} aria-haspopup="dialog" disabled={busy}
            data-preset="pick" onClick={() => setView('pick')} style={menuItemStyle} {...hover}>
            <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </span>
            <span style={{ flex: 1 }}>{t('compose.scheduleSend.pick')}</span>
          </button>
          {editing && (
            <>
              <div role="separator" style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
              <button type="button" role="menuitem" tabIndex={-1} disabled={busy} data-preset="unschedule"
                onClick={() => { onClose(); onUnschedule?.(); }} style={menuItemStyle} {...hover}>
                <span style={{ flex: 1 }}>{t('compose.scheduleSend.edit.unschedule')}</span>
              </button>
            </>
          )}
        </div>
      ) : (
        <div role="dialog" aria-label={t('compose.scheduleSend.pick')} onKeyDown={onPickKeyDown}>
          <button type="button" onClick={() => { setView('menu'); }}
            style={{ ...menuItemStyle, gap: 8, fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }} {...hover}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            {t('common.back')}
          </button>
          <SchedulePicker variant="split" now={nowProp} busy={busy}
            submitLabel={editing ? t('compose.scheduleSend.edit.update') : t('compose.scheduleSend.schedule')}
            onSubmit={at => { onClose(); onPick(at); }} />
        </div>
      )}
    </div>
  );
}

const sheetButton = {
  width: '100%', minHeight: 52, padding: '12px 20px', textAlign: 'left', background: 'none', border: 'none',
  borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 12, WebkitTapHighlightColor: 'transparent',
};

// The phone sheet behind the composer's clock button: the same presets and picker, as a modal
// dialog. Focus goes to its first option and back to `returnFocusRef` when it closes.
export function SendLaterSheet({ onClose, onPick, editing = false, onUnschedule, returnFocusRef, now: nowProp, busy = false }) {
  const { t } = useTranslation();
  const titleId = useId();
  const now = useMemo(() => nowProp ?? new Date(), [nowProp]);
  const [picking, setPicking] = useState(false);
  const sheetRef = useRef(null);
  const items = presets(now);

  useEffect(() => {
    if (!picking) sheetRef.current?.querySelector('button')?.focus();
  }, [picking]);
  useEffect(() => {
    const back = returnFocusRef?.current;
    return () => { back?.focus?.(); };
  }, [returnFocusRef]);

  const choose = (at) => { onClose(); onPick(at); };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.4)' }} />
      <div
        ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2101, background: 'var(--bg-elevated)',
          borderRadius: '16px 16px 0 0', paddingBottom: 'calc(var(--sab) + 8px)', boxShadow: 'var(--shadow-modal)',
          animation: 'sheet-enter 0.22s var(--ease-emphasized) both', maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div id={titleId} style={{ padding: '16px 20px 8px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}>
          {editing ? t('compose.scheduleSend.changeTime') : t('compose.scheduleSend.title')}
        </div>
        {picking ? (
          <SchedulePicker variant="single" now={nowProp} busy={busy}
            submitLabel={editing ? t('compose.scheduleSend.edit.update') : t('compose.scheduleSend.schedule')}
            onSubmit={choose} />
        ) : (
          <>
            {items.map(p => (
              <button key={p.id} type="button" data-preset={p.id} disabled={busy} onClick={() => choose(p.at)} style={sheetButton}>
                <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>{clockIcon(16)}</span>
                <span style={{ flex: 1 }}>{t(PRESET_LABELS[p.id])}</span>
                <span style={{ fontSize: 14, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatSendAt(p.at, undefined, now)}</span>
              </button>
            ))}
            <button type="button" data-preset="pick" disabled={busy} onClick={() => setPicking(true)} style={sheetButton}>
              <span style={{ flex: 1 }}>{t('compose.scheduleSend.pick')}</span>
            </button>
            {editing && (
              <button type="button" data-preset="unschedule" disabled={busy} onClick={() => { onClose(); onUnschedule?.(); }} style={sheetButton}>
                <span style={{ flex: 1 }}>{t('compose.scheduleSend.edit.unschedule')}</span>
              </button>
            )}
          </>
        )}
        <button type="button" onClick={onClose} style={{ ...sheetButton, borderBottom: 'none', color: 'var(--text-secondary)' }}>
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}

// Under the composer's header while a scheduled message is edited: when it goes, and Change.
export function ScheduledStrip({ sendAt, onChange, mobile = false }) {
  const { t } = useTranslation();
  return (
    <div data-scheduled-strip="" style={{
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      padding: mobile ? '8px 16px' : '6px 14px', borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--accent-dim)', color: 'var(--text-primary)', fontSize: mobile ? 14 : 12,
    }}>
      <span style={{ color: 'var(--accent)', display: 'flex' }}>{clockIcon(mobile ? 16 : 13)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{t('compose.scheduleSend.scheduledFor', { when: formatSendAt(sendAt) })}</span>
      <button type="button" onClick={onChange}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 'inherit', fontWeight: 600, cursor: 'pointer', padding: mobile ? '10px 4px' : '2px 4px', minHeight: mobile ? 44 : undefined }}>
        {t('compose.scheduleSend.change')}
      </button>
    </div>
  );
}

// A question scheduling has to ask, as the composer's other dialogs look: centered on desktop, a
// bottom sheet on phones. `actions` are { label, onClick, kind: 'primary' | 'danger' | 'plain' };
// Escape and the backdrop are `onCancel`. Focus starts on the first action.
export function ComposeQuestion({ mobile = false, title, body, actions, onCancel }) {
  const titleId = useId();
  const bodyId = useId();
  const boxRef = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    boxRef.current?.querySelector('button')?.focus();
    return () => { if (before?.isConnected) before.focus?.(); };
  }, []);
  const color = kind => kind === 'primary' ? (mobile ? 'var(--accent)' : 'var(--accent-text)') : kind === 'danger' ? 'var(--red)' : 'var(--text-secondary)';
  return (
    <>
      <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,0.4)' }} />
      <div
        ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={body ? bodyId : undefined}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
        style={mobile ? {
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 2101, background: 'var(--bg-elevated)',
          borderRadius: '16px 16px 0 0', paddingBottom: 'calc(var(--sab) + 8px)', boxShadow: 'var(--shadow-modal)',
          animation: 'sheet-enter 0.22s var(--ease-emphasized) both',
        } : {
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2101,
          background: 'var(--bg-elevated)', borderRadius: 12, boxShadow: 'var(--shadow-modal)',
          minWidth: 280, maxWidth: 400, padding: '20px 24px 16px',
        }}
      >
        <div id={titleId} style={mobile
          ? { padding: '16px 20px 4px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }
          : { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: body ? 8 : 16 }}>
          {title}
        </div>
        {body && (
          <div id={bodyId} style={mobile
            ? { padding: '6px 20px 12px', fontSize: 13, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }
            : { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.45 }}>
            {body}
          </div>
        )}
        <div style={mobile ? {} : { display: 'flex', flexDirection: 'column', gap: 8 }}>
          {actions.map(a => (
            <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled}
              style={mobile ? {
                width: '100%', minHeight: 52, padding: '16px 20px', textAlign: 'left', background: 'none', border: 'none',
                borderBottom: '1px solid var(--border-subtle)', color: color(a.kind), fontSize: 16, fontWeight: 500, cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              } : {
                padding: '8px 16px', borderRadius: 7, fontSize: 13, cursor: 'pointer', textAlign: 'center',
                background: a.kind === 'primary' ? 'var(--accent)' : 'none', color: color(a.kind),
                border: a.kind === 'primary' ? 'none' : a.kind === 'danger' ? '1px solid var(--border)' : 'none',
                fontWeight: a.kind === 'primary' ? 600 : 400,
              }}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
