import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { splitSenderIdentity } from '../utils/senderIdentity.js';

const identityLabel = key => {
  const { name, email } = splitSenderIdentity(key);
  return name ? `${name} <${email}>` : email;
};
const control = { padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', background: 'var(--bg-tertiary)' };

function Rule({ identity, rules, mappings, labels, saving, run }) {
  const { t } = useTranslation();
  const [name, setName] = useState(labels[identity] || '');
  const [target, setTarget] = useState('');
  return <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12, marginTop: 10 }}>
    <div style={{ overflowWrap: 'anywhere', marginBottom: 8 }}>{identityLabel(identity)}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <input aria-label={t('senderGrouping.label')} placeholder={t('senderGrouping.label')} maxLength={100} value={name} onChange={e => setName(e.target.value)} style={control} />
      <button disabled={saving} style={control} onClick={() => run(() => useStore.getState().saveSenderGroups({ senderGroupLabels: { ...useStore.getState().senderGroupLabels, [identity]: name.trim() } }))}>{t('common.save')}</button>
      <button disabled={saving} style={control} onClick={() => run(() => useStore.getState().toggleSenderGrouping(identity))}>{t('contextMenu.ungroupSender')}</button>
    </div>
    {rules.length > 1 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      <select aria-label={t('senderGrouping.mergeInto')} value={target} onChange={e => setTarget(e.target.value)} style={{ ...control, maxWidth: '100%' }}>
        <option value="">{t('senderGrouping.mergeInto')}</option>
        {rules.filter(key => key !== identity).map(key => <option key={key} value={key}>{labels[key] || identityLabel(key)}</option>)}
      </select>
      <button disabled={saving || !target} style={control} onClick={() => run(() => useStore.getState().mergeSenderGroups(identity, target))}>{t('senderGrouping.merge')}</button>
    </div>}
    {Object.entries(mappings).filter(([, leader]) => leader === identity).map(([source]) => <div key={source} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ flex: 1, overflowWrap: 'anywhere', fontSize: 12, color: 'var(--text-secondary)' }}>{identityLabel(source)}</span>
      <button disabled={saving} style={control} onClick={() => run(() => useStore.getState().splitSenderGroup(source))}>{t('senderGrouping.split')}</button>
    </div>)}
  </div>;
}

export default function SenderGroupingSettings() {
  const { t } = useTranslation();
  const rules = useStore(s => s.groupedSenders);
  const mappings = useStore(s => s.senderGroupMappings);
  const labels = useStore(s => s.senderGroupLabels);
  const saving = useStore(s => s.senderGroupingSaving);
  const [error, setError] = useState('');
  const run = async action => { setError(''); try { await action(); } catch (err) { setError(err.message); } };
  return <section style={{ marginBottom: 24, color: 'var(--text-primary)' }}>
    <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('senderGrouping.settings')}</h3>
    <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{t('senderGrouping.description')}</p>
    {!rules.length && <p style={{ fontSize: 12 }}>{t('senderGrouping.empty')}</p>}
    {rules.map(identity => <Rule key={identity} {...{ identity, rules, mappings, labels, saving, run }} />)}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </section>;
}
