import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { api } from '../utils/api.js';
import { formatDate } from '../utils/formatDate.js';
import { senderColor } from '../themes.js';
import SenderAvatarImage from './SenderAvatarImage.jsx';

export default function SenderGroup({ message, cacheKey, params, expanded, onToggle, renderRow, applyReadGuard, isMobile, isNarrow, showMobileAvatars, showMessagePreviews }) {
  const { t } = useTranslation();
  const generation = useRef(0);
  const saving = useStore(s => s.senderGroupingSaving);
  const rows = useStore(s => s.threadMessages[cacheKey] || []);
  const setThreadMessages = useStore(s => s.setThreadMessages);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hovered, setHovered] = useState(false);
  const paramsJson = JSON.stringify(params);
  const refreshToken = useStore(s => s.senderMembersRevision);
  const unreadCount = message.sender_unread_count;
  const hasUnread = Number(unreadCount) > 0;
  const showAvatar = (!isNarrow && !isMobile) || (isMobile && showMobileAvatars);
  const controlStyle = {
    margin: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
    border: '1px solid var(--border)', borderRadius: 6,
  };

  useEffect(() => {
    const version = ++generation.current;
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.getMessages({ ...JSON.parse(paramsJson), sender: message.sender_group, limit: Math.min(Math.max(useStore.getState().threadMessages[cacheKey]?.length || 0, 50), 500), offset: 0 })
      .then(data => {
        if (cancelled) return;
        setThreadMessages(cacheKey, applyReadGuard(data.messages));
        setTotal(data.total);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; generation.current = version + 1; };
  }, [expanded, cacheKey, paramsJson, message.sender_group, message.date, refreshToken, retry, setThreadMessages, applyReadGuard]);

  const loadMore = async () => {
    const version = generation.current;
    setLoading(true);
    setError(false);
    try {
      const data = await api.getMessages({ ...params, sender: message.sender_group, limit: 50, offset: rows.length });
      if (generation.current !== version) return;
      const current = useStore.getState().threadMessages[cacheKey] || [];
      const ids = new Set(current.map(row => row.id));
      setThreadMessages(cacheKey, [...current, ...applyReadGuard(data.messages).filter(row => !ids.has(row.id))]);
      setTotal(data.total);
    } catch {
      if (generation.current === version) setError(true);
    } finally {
      if (generation.current === version) setLoading(false);
    }
  };

  return (
    <section data-sender-group={message.sender_group} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
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
          fontSize: 13, fontWeight: 600, color: 'white', background: senderColor(message.sender_group),
        }}>
          {message.sender_group[0].toUpperCase()}
          <SenderAvatarImage email={message.sender_group} hasContactPhoto={message.has_contact_photo} />
        </span>}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
            <span title={message.sender_group} style={{
              flex: 1, minWidth: 0, fontSize: 13, fontWeight: hasUnread ? 600 : 400,
              color: hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{message.sender_group}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
                {expanded ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
              </svg>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatDate(message.date)}</span>
            </span>
          </span>
          <span style={{
            display: 'block', fontSize: 13, fontWeight: hasUnread ? 500 : 400, marginBottom: 3,
            color: hasUnread ? 'var(--text-primary)' : 'var(--text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t('messageList.senderGroupCounts', { unread: unreadCount, count: message.sender_message_count })}</span>
          {/* Match ordinary row height without using one message's preview as the group label. */}
          {showMessagePreviews && <span aria-hidden="true" style={{ display: 'block', fontSize: 12 }}>{'\u00a0'}</span>}
        </span>
      </button>
      {expanded && <div style={{ borderLeft: '2px solid var(--accent)', marginLeft: 12 }}>
        {rows.map(renderRow)}
        {error && <button type="button" style={controlStyle} onClick={() => setRetry(v => v + 1)}>{t('messageList.senderGroupLoadError')}</button>}
        {loading && <div role="status" style={{ padding: 12 }}>{t('common.loading')}</div>}
        {!loading && !error && rows.length < total && <button type="button" style={controlStyle} onClick={loadMore}>{t('messageList.loadMore')}</button>}
        <button type="button" disabled={saving} onClick={() => useStore.getState().toggleSenderGrouping(message.sender_group)
          .catch(err => useStore.getState().addNotification({ type: 'error', title: t('common.error'), body: err.message }))}
          style={controlStyle}>{t('contextMenu.ungroupSender')}</button>
      </div>}
    </section>
  );
}
