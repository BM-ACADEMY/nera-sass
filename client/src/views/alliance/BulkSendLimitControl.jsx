import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';

export const BulkSendLimitControl = ({ channel, recipientCount = 0 }) => {
  const [mode, setMode] = useState('unlimited');
  const [customLimit, setCustomLimit] = useState(100);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.getAllianceBulkSendLimits().then((data) => {
      const policy = data.limits?.find((item) => item.channel === channel);
      if (active && policy) {
        setMode(policy.limit_mode);
        setCustomLimit(policy.custom_limit || 100);
      }
    }).catch((error) => active && toast.error(error.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [channel]);

  const save = async () => {
    const limit = Number(customLimit);
    if (mode === 'custom' && (!Number.isInteger(limit) || limit < 1 || limit > 100000)) return toast.error('Enter a limit from 1 to 100,000');
    setSaving(true);
    try {
      const result = await api.updateAllianceBulkSendLimit(channel, { limit_mode: mode, custom_limit: mode === 'custom' ? limit : null });
      toast.success(result.message);
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  };

  const exceeds = !loading && mode === 'custom' && recipientCount > Number(customLimit);
  return <div className={`al-bulk-limit${exceeds ? ' exceeds' : ''}`}>
    <div className="al-bulk-limit-head"><span className="al-bulk-limit-icon">{channel === 'email' ? '@' : 'WA'}</span><div><b>{channel === 'email' ? 'Email' : 'WhatsApp'} send limit</b><small>Global campaign safety rule</small></div></div>
    <div className="al-bulk-limit-modes" role="group" aria-label="Bulk send limit mode">
      <button type="button" className={mode === 'unlimited' ? 'active' : ''} disabled={loading || saving} onClick={() => setMode('unlimited')}><b>Unlimited</b><small>No campaign recipient cap</small></button>
      <button type="button" className={mode === 'custom' ? 'active' : ''} disabled={loading || saving} onClick={() => setMode('custom')}><b>Custom</b><small>Set maximum recipients</small></button>
    </div>
    {mode === 'custom' && <div className="al-bulk-limit-input"><label htmlFor={`bulk-limit-${channel}`}>Maximum recipients per campaign</label><input id={`bulk-limit-${channel}`} type="number" min="1" max="100000" disabled={loading || saving} value={customLimit} onChange={(event) => setCustomLimit(event.target.value)} /><small>Allowed range: 1 to 100,000</small></div>}
    <button type="button" className="al-btn al-bulk-limit-save" disabled={loading || saving} onClick={save}>{saving ? 'Saving...' : `Save ${channel === 'email' ? 'email' : 'WhatsApp'} limit`}</button>
    <div className="al-bulk-limit-note">Checked by the server for every bulk campaign. Provider and sender daily limits still apply.</div>
    {exceeds && <div className="al-bulk-limit-warning">Selection blocked: {recipientCount.toLocaleString()} recipients exceeds the {Number(customLimit).toLocaleString()} limit.</div>}
  </div>;
};
