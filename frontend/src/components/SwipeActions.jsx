const SWIPE_ACTIONS = {
  archive: { color: 'var(--amber, #d97706)' },
  delete: { color: 'var(--red, #ef4444)' },
  star: { color: 'var(--amber, #d97706)' },
  markRead: { color: 'var(--accent)' },
  reply: { color: 'var(--green, #22c55e)' },
  replyAll: { color: '#3b82f6' },
  disabled: { color: 'transparent' },
};

export function getSwipeActionView(action, message, t, unreadCount = null) {
  const unread = unreadCount != null ? unreadCount > 0 : !message.is_read;
  if (action === 'archive') return { label: t('message.archive'), color: SWIPE_ACTIONS.archive.color, icon: 'archive' };
  if (action === 'delete') return { label: t('contextMenu.delete'), color: SWIPE_ACTIONS.delete.color, icon: 'delete' };
  if (action === 'star') return { label: message.is_starred ? t('messageList.swipeUnstar') : t('messageList.swipeStar'), color: SWIPE_ACTIONS.star.color, icon: 'star' };
  if (action === 'markRead') return { label: unread ? t('contextMenu.markRead') : t('contextMenu.markUnread'), color: SWIPE_ACTIONS.markRead.color, icon: unread ? 'unread' : 'read' };
  if (action === 'reply') return { label: t('message.reply'), color: SWIPE_ACTIONS.reply.color, icon: 'reply' };
  if (action === 'replyAll') return { label: t('message.replyAll'), color: SWIPE_ACTIONS.replyAll.color, icon: 'replyAll' };
  return null;
}

function SwipeActionSvg({ icon, fill = 'none' }) {
  if (icon === 'delete') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>;
  if (icon === 'star') return <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke="white" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
  if (icon === 'markRead') return <svg width="18" height="18" viewBox="0 0 24 24" fill={fill} stroke="white" strokeWidth="2"><path style={{strokeLinecap: 'round'}} d="M22,9v9c0,1.1-.9,2-2,2H4c-1.1,0-2-.9-2-2v-9"/><polyline points="22 9 12 16 2 9"/><polyline points="2 9 12 2 22 9"/></svg>;
  if (icon === 'unread') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path style={{ strokeLinecap: 'round' }} d="M22,9v9c0,1.1-.9,2-2,2H4c-1.1,0-2-.9-2-2v-9"/><polyline points="22 9 12 16 2 9" /><polyline points="2 9 12 2 22 9" /></svg>;
  if (icon === 'read') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path style={{ strokeLinecap: 'round' }} d="M22,10.91v7.09c0,1.1-.9,2-2,2H4c-1.1,0-2-.9-2-2V6c0-1.1.9-2,2-2h11"/><polyline style={{ strokeLinecap: 'round' }} points="16.36 9.95 12 13 2 6"/><circle style={{ strokeMiterlimit: 10, fill: 'white' }} cx="19.96" cy="6" r="3"/></svg>;
  if (icon === 'reply') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>;
  if (icon === 'replyAll') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><polyline points="7 17 2 12 7 7"/><polyline points="12 17 7 12 12 7"/><path d="M22 18v-2a4 4 0 00-4-4H7"/></svg>;
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a1 1 0 001 1h14a1 1 0 001-1V8"/><polyline points="9 13 12 16 15 13"/><line x1="12" y1="11" x2="12" y2="16"/></svg>;
}

export function SwipeBackground({ side, actionView, innerRef, fullWidth = false }) {
  if (!actionView) return null;
  const isLeft = side === 'left';
  return (
    <div ref={innerRef} style={{
      position: 'absolute', [isLeft ? 'left' : 'right']: 0, top: 0, bottom: 0, width: fullWidth ? '100%' : '50%',
      background: actionView.color,
      display: 'none', alignItems: 'center', justifyContent: isLeft ? 'flex-start' : 'flex-end',
      paddingLeft: isLeft ? 20 : undefined, paddingRight: isLeft ? undefined : 20, gap: 6,
    }}>
      {isLeft && <SwipeActionSvg icon={actionView.icon} fill={actionView.fill} />}
      <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>{actionView.label}</span>
      {!isLeft && <SwipeActionSvg icon={actionView.icon} fill={actionView.fill} />}
    </div>
  );
}

