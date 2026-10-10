import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { api } from '../utils/api.js';

const control = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13 };

export default function McpSettings() {
  const { t } = useTranslation();
  const accounts = useStore(state => state.accounts);
  const [tokens, setTokens] = useState([]);
  const [events, setEvents] = useState([]);
  const [name, setName] = useState('Codex');
  const [accountIds, setAccountIds] = useState([]);
  const [allowSend, setAllowSend] = useState(false);
  const [days, setDays] = useState(90);
  const [freshToken, setFreshToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const endpoint = `${window.location.origin}/api/mcp`;
  const refresh = async () => {
    const [list, audit] = await Promise.all([api.mcp.listTokens(), api.mcp.events()]);
    setTokens(list.tokens);
    setEvents(audit.events);
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.mcp.listTokens(), api.mcp.events()]).then(([list, audit]) => {
      if (!cancelled) { setTokens(list.tokens); setEvents(audit.events); setLoaded(true); }
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);
  const create = async event => {
    event.preventDefault();
    setBusy(true); setError(''); setFreshToken('');
    try {
      const result = await api.mcp.createToken({ name, accountIds, allowSend, expiresInDays: days });
      setFreshToken(result.token);
      setAllowSend(false);
      await refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const revoke = async id => {
    setBusy(true); setError(''); setFreshToken('');
    try { await api.mcp.revokeToken(id); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const config = `[mcp_servers.mailflow]\nurl = "${endpoint}"\nbearer_token_env_var = "MAILFLOW_MCP_TOKEN"`;
  return (
    <section style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{t('mcp.title')}</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>{t('mcp.description')}</p>
      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>{t('mcp.permissionNote')}</p>
      <form onSubmit={create} style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('mcp.name')}<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} style={control} />
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('mcp.mailboxes')}</legend>
          {accounts.filter(account => account.enabled !== false).map(account => (
            <label key={account.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-primary)', padding: '4px 0', overflowWrap: 'anywhere' }}>
              <input type="checkbox" checked={accountIds.includes(account.id)} onChange={event => setAccountIds(ids => event.target.checked ? [...ids, account.id] : ids.filter(id => id !== account.id))} />
              {account.name} · {account.email_address}
            </label>
          ))}
        </fieldset>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={allowSend} onChange={event => setAllowSend(event.target.checked)} />{t('mcp.allowSend')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          {t('mcp.expiry')}<select value={days} onChange={event => setDays(Number(event.target.value))} style={control}>
            {[7, 30, 90, 365].map(value => <option key={value} value={value}>{t('mcp.days', { count: value })}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || !loaded || !name.trim() || !accountIds.length} style={{ ...control, cursor: 'pointer', justifySelf: 'start' }}>{busy ? t('common.loading') : t('mcp.create')}</button>
      </form>
      {error && <p role="alert" style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      {freshToken && <div style={{ marginTop: 14 }}>
        <p style={{ color: 'var(--amber)', fontSize: 13, marginBottom: 6 }}>{t('mcp.once')}</p>
        <textarea readOnly aria-label={t('mcp.token')} value={freshToken} rows={2} style={{ ...control, width: '100%', resize: 'none', fontFamily: 'monospace' }} />
        <button type="button" onClick={() => setFreshToken('')} style={{ ...control, marginTop: 6 }}>{t('mcp.hide')}</button>
      </div>}
      <details style={{ marginTop: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
        <summary style={{ cursor: 'pointer' }}>{t('mcp.codexConfig')}</summary>
        <p style={{ margin: '8px 0' }}>{t('mcp.configHelp')}</p>
        <pre style={{ ...control, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
      </details>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {!tokens.length && <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('mcp.noTokens')}</p>}
        {tokens.map(token => {
          const inactive = token.revoked_at || Date.parse(token.expires_at) <= Date.now();
          return <div key={token.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <div style={{ flex: '1 1 180px', fontSize: 13, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
              <strong>{token.name}</strong> · {token.allow_send ? t('mcp.readSend') : t('mcp.readOnly')}
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{inactive ? t('mcp.inactive') : t('mcp.expires', { date: new Date(token.expires_at).toLocaleDateString() })}</p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{(token.account_ids || []).map(id => accounts.find(account => account.id === id)?.email_address || id).join(', ')}</p>
            </div>
            {!inactive && <button type="button" disabled={busy} onClick={() => revoke(token.id)} style={control}>{t('mcp.revoke')}</button>}
          </div>;
        })}
      </div>
      <details style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
        <summary style={{ cursor: 'pointer' }}>{t('mcp.activity')}</summary>
        {events.map(event => <p key={event.id} style={{ marginTop: 6 }}>{new Date(event.created_at).toLocaleString()} · {event.token_name} · {event.tool} · {event.success ? t('mcp.success') : t('mcp.failed')}</p>)}
      </details>
    </section>
  );
}
