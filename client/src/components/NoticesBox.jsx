import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, Info, XCircle } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

const ICON = { critical: XCircle, warning: AlertTriangle, info: Info };
const COLOR = { critical: C.red, warning: C.accent, info: C.blue };

/**
 * Notices box: open problems of this workspace (template rejected, wallet low,
 * number quality drop, setup unfinished, payment failed). The same notices are
 * emailed. Shows nothing when there is nothing to do.
 */
export const NoticesBox = () => {
  const navigate = useNavigate();
  const [state, setState] = useState({ notices: [], unread: 0 });

  const load = async () => {
    try { setState(await api.getNotices()); } catch { /* the box is optional: stay empty */ }
  };
  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  const open = async (notice) => {
    await api.markNoticeRead(notice.id).catch(() => {});
    if (notice.action_path) navigate(notice.action_path);
    else load();
  };

  if (!state.notices.length) return null;
  return (
    <section aria-label="Notices" style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 12, padding: 16, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontWeight: 700, fontSize: 14 }}>
          <Bell size={16} /> Notices {state.unread > 0 && <span style={{ background: C.red, color: '#fff', borderRadius: 10, fontSize: 10, padding: '1px 7px' }}>{state.unread} new</span>}
        </div>
        {state.unread > 0 && (
          <button type="button" onClick={async () => { await api.markAllNoticesRead().catch(() => {}); load(); }} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 11, cursor: 'pointer' }}>Mark all as read</button>
        )}
      </div>
      {state.notices.map((notice) => {
        const Icon = ICON[notice.severity] || Info;
        return (
          <button key={notice.id} type="button" onClick={() => open(notice)} style={{ display: 'flex', gap: 10, width: '100%', textAlign: 'left', background: notice.read ? 'transparent' : C.surface, border: '1px solid ' + C.border, borderRadius: 9, padding: 11, marginBottom: 8, cursor: 'pointer' }}>
            <Icon size={16} color={COLOR[notice.severity] || C.muted} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <span style={{ display: 'block', color: C.text, fontSize: 13, fontWeight: notice.read ? 500 : 700 }}>{notice.title}</span>
              <span style={{ display: 'block', color: C.muted, fontSize: 12, lineHeight: 1.5 }}>{notice.message}</span>
              {notice.advice && <span style={{ display: 'block', color: C.muted, fontSize: 12, marginTop: 3 }}>{notice.advice}</span>}
            </span>
          </button>
        );
      })}
    </section>
  );
};

export default NoticesBox;
