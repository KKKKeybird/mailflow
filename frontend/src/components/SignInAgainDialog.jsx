import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MicrosoftDeviceCode from './MicrosoftDeviceCode.jsx';

// "Sign in again" for one account whose sign-in stopped working. The sign-in names the
// account, so signing in as a different address is refused and explained instead of adding a
// second account. Microsoft uses the device-code sign-in; Google opens its own page in a tab.
export default function SignInAgainDialog({ account, onClose, onSignedIn }) {
  const { t } = useTranslation();
  const [googleState, setGoogleState] = useState(null); // null | 'waiting' | 'success' | { signedInAs, expected } | { error }
  const closeTimer = useRef(null);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const succeed = () => {
    onSignedInRef.current?.();
    closeTimer.current = setTimeout(onClose, 2500);
  };

  useEffect(() => {
    if (account?.oauth_provider !== 'google') return undefined;
    const handle = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'oauth_success' && e.data?.provider === 'google') { setGoogleState('success'); succeed(); }
      else if (e.data?.type === 'oauth_error' && e.data?.error === 'wrong_account') setGoogleState({ signedInAs: e.data.signedInAs, expected: e.data.expected });
      else if (e.data?.type === 'oauth_error') setGoogleState({ error: e.data.error });
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- succeed reads the latest callback through a ref
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  if (!account) return null;

  const openGoogle = () => {
    setGoogleState('waiting');
    // A real anchor click, as for the first Google connection: window.open is intercepted by
    // some browser extensions.
    const a = document.createElement('a');
    a.href = `/oauth/google?accountId=${encodeURIComponent(account.id)}`;
    a.target = '_blank';
    a.rel = 'opener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const button = {
    padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)',
    color: 'var(--accent-text)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.55)',
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sign-in-again-title" style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 12,
        padding: '22px 22px 18px', maxWidth: 440, width: '100%', boxShadow: 'var(--shadow-modal)',
      }} onClick={e => e.stopPropagation()}>
        <p id="sign-in-again-title" style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('accountErrors.signInDialog.title')}
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {t('accountErrors.signInDialog.body', { email: account.email_address })}
        </p>

        {account.oauth_provider === 'microsoft' && (
          <MicrosoftDeviceCode
            accountId={account.id}
            successText={t('accountErrors.signInDialog.success')}
            onSuccess={succeed}
            onCancel={onClose}
          />
        )}

        {account.oauth_provider === 'google' && (
          <div>
            {googleState === 'success' ? (
              <div role="status" style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>{t('accountErrors.signInDialog.success')}</div>
            ) : googleState?.signedInAs ? (
              <div role="alert" style={{ color: 'var(--red)', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                {t('accountErrors.wrongAccount', { signedInAs: googleState.signedInAs, expected: googleState.expected })}
              </div>
            ) : googleState?.error ? (
              <div role="alert" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, overflowWrap: 'anywhere' }}>
                {t('common.error', { message: googleState.error })}
              </div>
            ) : googleState === 'waiting' ? (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>{t('accountErrors.signInDialog.waitingGoogle')}</div>
            ) : null}
            {googleState !== 'success' && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={onClose} style={{ ...button, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                  {t('common.cancel')}
                </button>
                <button type="button" onClick={openGoogle} style={button}>{t('accountErrors.signInDialog.continueGoogle')}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
