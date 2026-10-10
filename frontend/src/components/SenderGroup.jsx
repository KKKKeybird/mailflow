import { senderMemberCacheKey } from '../utils/messageRowTree.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { api } from '../utils/api.js';
import { formatDate } from '../utils/formatDate.js';
import { senderColor } from '../themes.js';
import { splitSenderIdentity } from '../utils/senderIdentity.js';
import SenderAvatarImage from './SenderAvatarImage.jsx';

export default function SenderGroup({ message, cacheKey, params, expanded, onToggle, renderRow, applyReadGuard, isMobile, isNarrow, showMobileAvatars, showMessagePreviews, onContextMenu, onFilterChange, detail = false, toolbar, listRef, onListKeyDown }) {
  const { t } = useTranslation();
  const generation = useRef(0);
  const view = useStore(s => s.senderViewState[cacheKey]);
  const unreadOnly = !!view?.unreadOnly;
  const memberKey = senderMemberCacheKey(cacheKey, unreadOnly);
  const rows = useStore(s => s.threadMessages[memberKey] || []);
  const customLabel = useStore(s => s.senderGroupLabels[message.sender_group]);
  const ownListRef = useRef(null);
  const scrollRef = listRef || ownListRef;
  const restored = useRef(false);
  const lastPreview = useRef({ id: message.preview_message_id, date: message.date });
  const [newMail, setNewMail] = useState(false);
  const scrollField = unreadOnly ? 'scrollUnread' : 'scrollAll';
  const requestParams = { ...params, unreadOnly, sender: message.sender_group };
  const requestJson = JSON.stringify(requestParams);
  const setThreadMessages = useStore(s => s.setThreadMessages);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hovered, setHovered] = useState(false);
  const refreshToken = useStore(s => s.senderMembersRevision);
  const { email, name } = splitSenderIdentity(message.sender_group);
  const label = name ? `${name} <${email}>` : email;
  const unreadCount = message.sender_unread_count;
  const hasUnread = Number(unreadCount) > 0;
  const showAvatar = (!isNarrow && !isMobile) || (isMobile && showMobileAvatars);
  const controlStyle = {
    margin: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 6,
  };

  useLayoutEffect(() => { restored.current = false; }, [memberKey, detail]);
  useLayoutEffect(() => {
    if (!detail || !rows.length || restored.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = useStore.getState().senderViewState[cacheKey]?.[scrollField] || 0;
    restored.current = true;
  }, [detail, rows, cacheKey, scrollField, scrollRef]);
  useEffect(() => {
    const previous = lastPreview.current;
    if (detail && previous.id !== message.preview_message_id && new Date(message.date) > new Date(previous.date)) setNewMail(true);
    lastPreview.current = { id: message.preview_message_id, date: message.date };
  }, [detail, message.preview_message_id, message.date]);
  useEffect(() => {
    const version = ++generation.current;
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const el = scrollRef.current;
    const anchor = el && [...el.querySelectorAll('[data-msgid]')].find(row => row.getBoundingClientRect().bottom > el.getBoundingClientRect().top);
    const anchorId = anchor?.dataset.msgid;
    const anchorOffset = anchor && anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
    (async () => {
      const desired = Math.max(useStore.getState().threadMessages[memberKey]?.length || 0, 50);
      let messages = [], total;
      do {
        const data = await api.getMessages({ ...JSON.parse(requestJson), limit: Math.min(500, desired - messages.length), offset: messages.length });
        if (cancelled) return;
        messages = [...messages, ...data.messages]; total = data.total;
        if (!data.messages.length) break;
      } while (messages.length < desired && messages.length < total);
      if (cancelled) return;
      setThreadMessages(memberKey, applyReadGuard(messages));
      setTotal(total);
      if (anchorId) requestAnimationFrame(() => {
        if (cancelled || !el.isConnected) return;
        const current = [...el.querySelectorAll('[data-msgid]')].find(row => row.dataset.msgid === anchorId);
        if (current) el.scrollTop += current.getBoundingClientRect().top - el.getBoundingClientRect().top - anchorOffset;
      });
    })().catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; generation.current = version + 1; };
  }, [expanded, memberKey, requestJson, message.date, refreshToken, retry, setThreadMessages, applyReadGuard, scrollRef]);

  const loadMore = async () => {
    const version = generation.current;
    setLoading(true);
    setError(false);
    try {
      const data = await api.getMessages({ ...requestParams, limit: 50, offset: rows.length });
      if (generation.current !== version) return;
      const current = useStore.getState().threadMessages[memberKey] || [];
      const ids = new Set(current.map(row => row.id));
      setThreadMessages(memberKey, [...current, ...applyReadGuard(data.messages).filter(row => !ids.has(row.id))]);
      setTotal(data.total);
    } catch {
      if (generation.current === version) setError(true);
    } finally {
      if (generation.current === version) setLoading(false);
    }
  };

  return (
    <section data-sender-group={message.sender_group} data-sender-list={detail || undefined} style={{ borderBottom: '1px solid var(--border-subtle)', ...(detail ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } : {}) }}>
      {!detail && <div style={{ position: 'relative' }} onContextMenu={e => onContextMenu?.(e, message)}>
      <button type="button" aria-expanded={expanded} onClick={onToggle}
        onMouseEnter={() => !isMobile && setHovered(true)}
        onMouseLeave={() => !isMobile && setHovered(false)} style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
        padding: 'var(--layout-row-py, 11px) var(--layout-row-px, 14px)',
        background: hovered ? 'var(--bg-tertiary)' : (isMobile ? 'var(--bg-primary)' : 'transparent'),
        color: 'var(--text-primary)', border: 0, cursor: 'pointer', textAlign: 'left',
        position: 'relative', transition: 'background 0.1s',
      }}>
        {hasUnread && <span aria-hidden="true" className="unread-dot" style={{
          position: 'absolute', left: 3, top: '50%', transform: 'translateY(-50%)',
          width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
        }} />}
        {showAvatar && <span aria-hidden="true" style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          position: 'relative', overflow: 'hidden', marginTop: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 600, color: 'white', background: senderColor(email),
        }}>
          {(name || email)[0].toUpperCase()}
          <SenderAvatarImage email={email} hasContactPhoto={message.has_contact_photo} />
        </span>}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <span title={label} style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: hasUnread ? 600 : 400,
              color: hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{customLabel || name || email}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8, marginRight: isMobile ? 28 : 0 }}>
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatDate(message.date)}</span>
            </span>
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, fontWeight: hasUnread ? 500 : 400, marginBottom: 3,
            color: hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {message.subject || t('message.noSubject')}
            </span>
            <span data-sender-count style={{
              flexShrink: 0, minWidth: 16, padding: '0 3px', borderRadius: 3,
              border: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)',
              fontSize: 10, fontWeight: 400, lineHeight: '14px', textAlign: 'center',
            }}>{message.sender_message_count}</span>
          </span>
          {showMessagePreviews && <span style={{
            display: 'block', fontSize: 12, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{message.snippet || '\u00a0'}</span>}
        </span>
      </button>
      {isMobile && <button type="button" aria-label={t('message.more')} aria-haspopup="menu"
        onClick={e => { e.stopPropagation(); onContextMenu?.(e, message); }} style={{
          position: 'absolute', top: 'var(--layout-row-py, 11px)', right: 'var(--layout-row-px, 14px)',
          padding: 4, margin: '-4px -6px 0 0', background: 'none', border: 0,
          color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex',
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg>
      </button>}
      </div>}
      {detail && <header style={{ padding: isMobile ? 'calc(var(--sat, 0px) + 10px) 14px 12px' : '14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button type="button" onClick={onToggle} aria-label={t('common.back')} style={{ background: 'none', border: 0, color: 'var(--text-primary)', padding: 4, cursor: 'pointer', display: 'flex' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button type="button" aria-label={t('message.more')} aria-haspopup="menu" onClick={e => onContextMenu?.(e, message)} style={{ background: 'none', border: 0, color: 'var(--text-primary)', padding: 4, cursor: 'pointer', display: 'flex' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </button>
        </div>
        <div title={label} style={{ fontSize: 18, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customLabel || name || email}</div>
        {name && <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={unreadOnly === value} style={{ ...controlStyle, margin: 0, color: unreadOnly === value ? 'var(--accent)' : 'var(--text-secondary)' }} onClick={() => { onFilterChange?.(); useStore.getState().setSenderViewState(cacheKey, { unreadOnly: value }); }}>{t(value ? 'senderGrouping.unread' : 'senderGrouping.all')}</button>)}
          {newMail && <button type="button" style={{ ...controlStyle, margin: 0 }} onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setNewMail(false); }}>{t('senderGrouping.newMail')}</button>}
        </div>
      </header>}
      {expanded && <div ref={scrollRef} onScroll={e => { if (detail && restored.current) useStore.getState().setSenderViewState(cacheKey, { [scrollField]: e.currentTarget.scrollTop }); }} onKeyDown={onListKeyDown} tabIndex={0} style={{ flex: 1, minHeight: 0, overflowY: 'auto', outline: 'none', overscrollBehavior: 'contain' }}>
        {toolbar}
        {rows.map(renderRow)}
        {!loading && !error && !rows.length && <div style={{ padding: 20, color: 'var(--text-tertiary)', textAlign: 'center' }}>{t('senderGrouping.noMail')}</div>}
        {error && <button type="button" style={controlStyle} onClick={() => setRetry(v => v + 1)}>{t('messageList.senderGroupLoadError')}</button>}
        {loading && <div role="status" style={{ padding: 12 }}>{t('common.loading')}</div>}
        {!loading && !error && rows.length < total && <button type="button" style={controlStyle} onClick={loadMore}>{t('messageList.loadMore')}</button>}

      </div>}
    </section>
  );
}
