import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api.js';

// Microsoft's device-code sign-in: shows the code to enter at microsoft.com/devicelogin and
// polls until the person finishes. Starts as soon as it mounts; unmounting stops polling.
//
// accountId: sign in again for that account. The server then refuses a different address
// (status 'wrong_account') rather than adding a second account.
// onSuccess({ accountId }) runs once the server has stored the sign-in.
export default function MicrosoftDeviceCode({ accountId = null, onSuccess, onCancel, successText }) {
  const { t } = useTranslation();
  const [flow, setFlow] = useState(null); // { userCode, verificationUri, interval }
  const [status, setStatus] = useState('starting'); // starting|pending|success|declined|expired|error|wrong_account
  const [wrong, setWrong] = useState(null); // { signedInAs, expected }
  const [errorText, setErrorText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pollRef = useRef(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let cancelled = false;
    const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    setStatus('starting');
    setFlow(null);
    setWrong(null);
    setErrorText('');
    api.startMsDeviceFlow(accountId).then((data) => {
      if (cancelled) return;
      setFlow(data);
      setStatus('pending');
      pollRef.current = setInterval(async () => {
        try {
          const result = await api.pollMsDeviceFlow();
          if (cancelled || result.status === 'pending') return;
          stop();
          setStatus(result.status);
          if (result.status === 'wrong_account') setWrong({ signedInAs: result.signedInAs, expected: result.expected });
          if (result.status === 'error') setErrorText(result.error || '');
          if (result.status === 'success') onSuccessRef.current?.({ accountId: result.accountId });
        } catch (err) {
          if (cancelled) return;
          stop();
          setStatus('error');
          setErrorText(err?.message || '');
        }
      }, (data.interval || 5) * 1000);
    }).catch((err) => {
      if (cancelled) return;
      setStatus('error');
      setErrorText(err?.message || '');
    });
    return () => { cancelled = true; stop(); };
  }, [accountId, attempt]);

  const small = { fontSize: 12, color: 'var(--text-secondary)' };
  const ended = ['declined', 'expired', 'error', 'wrong_account'].includes(status);

  return (
    <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {status === 'success' ? (
        <div role="status" style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>
          {successText || t('admin.integrations.microsoft.connectedNote')}
        </div>
      ) : status === 'wrong_account' ? (
        <div role="alert" style={{ color: 'var(--red)', fontSize: 13, lineHeight: 1.5 }}>
          {t('accountErrors.wrongAccount', { signedInAs: wrong?.signedInAs, expected: wrong?.expected })}
        </div>
      ) : status === 'declined' ? (
        <div role="alert" style={{ color: 'var(--red)', fontSize: 13 }}>{t('admin.integrations.microsoft.deviceCodeDeclined')}</div>
      ) : status === 'expired' ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{t('admin.integrations.microsoft.deviceCodeExpired')}</div>
      ) : status === 'error' ? (
        <div role="alert">
          <div style={{ color: 'var(--red)', fontSize: 13 }}>{t('admin.integrations.microsoft.deviceCodeError')}</div>
          {errorText && <div style={{ ...small, color: 'var(--text-tertiary)', marginTop: 6, overflowWrap: 'anywhere' }}>{errorText}</div>}
        </div>
      ) : status === 'starting' ? (
        <div style={{ ...small, color: 'var(--text-tertiary)' }}>{t('admin.integrations.microsoft.deviceCodeWaiting')}</div>
      ) : (
        <>
          <div style={{ ...small, marginBottom: 10 }}>{t('admin.integrations.microsoft.deviceCodeInstructions')}</div>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginRight: 6 }}>{t('admin.integrations.microsoft.deviceCodeVisit')}</span>
            <a href={flow?.verificationUri} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 500 }}>
              {flow?.verificationUri}
            </a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t('admin.integrations.microsoft.deviceCodeEnter')}</span>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700,
              letterSpacing: '0.15em', color: 'var(--text-primary)',
              padding: '6px 14px', background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)', borderRadius: 6,
            }}>
              {flow?.userCode}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1.5s linear infinite' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            {t('admin.integrations.microsoft.deviceCodeWaiting')}
          </div>
        </>
      )}
      {status !== 'success' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {ended && (
            <button type="button" onClick={() => setAttempt(a => a + 1)} style={{
              padding: '5px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11,
            }}>
              {t('accountErrors.action.startOver')}
            </button>
          )}
          <button type="button" onClick={onCancel} style={{
            padding: '5px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11,
          }}>
            {t('admin.integrations.microsoft.deviceCodeCancel')}
          </button>
        </div>
      )}
    </div>
  );
}
