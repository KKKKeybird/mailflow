import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api.js';

export default function ProxyConnectionTest({ type, host, port }) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setResult(null);
    return () => { generation.current = current + 1; };
  }, [type, host, port]);
  const test = async () => {
    if (inFlight.current) return;
    const current = generation.current;
    inFlight.current = true;
    setTesting(true);
    setResult(null);
    try {
      const value = await api.testProxy({ proxy_type: type, proxy_host: host, proxy_port: Number(port) });
      if (generation.current === current) setResult(value);
    } catch (err) {
      if (generation.current === current) setResult({ ok: false, error: err.message });
    } finally {
      inFlight.current = false;
      setTesting(false);
    }
  };
  const failures = {
    timeout: t('admin.accounts.proxy.testFailure.timeout'),
    dns: t('admin.accounts.proxy.testFailure.dns'),
    refused: t('admin.accounts.proxy.testFailure.refused'),
    unreachable: t('admin.accounts.proxy.testFailure.unreachable'),
  };
  return <div style={{ margin: '8px 0 12px' }}>
    <button type="button" onClick={test} disabled={testing || !host?.trim() || !port} aria-busy={testing}
      style={{ padding: '7px 12px', border: '1px solid var(--border)', borderRadius: 6,
        background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: 12, cursor: testing ? 'default' : 'pointer' }}>
      {t(testing ? 'admin.accounts.proxy.testing' : 'admin.accounts.proxy.test')}
    </button>
    {result && <div role="status" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5,
      color: result.ok ? 'var(--accent)' : 'var(--danger)' }}>
      {result.ok ? t('admin.accounts.proxy.testSuccess', { ms: result.latencyMs })
        : result.error || failures[result.reason] || failures.unreachable}
    </div>}
    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
      {t('admin.accounts.proxy.testNote')}
    </div>
  </div>;
}
