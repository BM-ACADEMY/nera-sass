import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Bot, ChevronDown, ChevronUp, X, Users } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { initials, timeAgo } from '../leads/leadsPolicy.js';
import { TEAM_COLUMNS, defaultTeamSort, formatDuration, sortMembers, teamHasActivity } from '../../utils/reportFormat.js';

// Reports > Team: one row per person in the workspace for the chosen dates
// (GET /api/reports/team), a totals row and an AI row. Click a person to see
// their latest actions. Owner and Admin (with Reports) only (the page hides the tab
// for others and the server refuses them).

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', staff: 'Staff', manager: 'Staff', agent: 'Staff' };
const AVATAR_COLOURS = [C.blue, C.purple, C.green, C.pink, '#0891b2', '#d97706'];
const colourFor = (id) => AVATAR_COLOURS[Math.abs(Number(id) || 0) % AVATAR_COLOURS.length];

const cell = { padding: '10px 12px', fontSize: 12, color: C.text, whiteSpace: 'nowrap', textAlign: 'right' };
const headCell = { ...cell, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.4px', cursor: 'pointer', userSelect: 'none', borderBottom: `2px solid ${C.border}` };

const Avatar = ({ name, id, size = 30 }) => (
  <span style={{ width: size, height: size, borderRadius: '50%', background: `${colourFor(id)}18`, color: colourFor(id), fontSize: size > 30 ? 13 : 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {initials(name)}
  </span>
);

const Empty = ({ children }) => (
  <div style={{ textAlign: 'center', padding: '40px 16px', color: C.muted, fontSize: 13 }}>{children}</div>
);

function valueText(key, row) {
  if (key === 'avg_first_reply_seconds') return formatDuration(row[key]);
  if (key === 'last_active_at') return row[key] ? timeAgo(row[key]) : '—';
  return row[key] ?? 0;
}

function MemberActivity({ member, params, canOpenLog, onClose }) {
  const [state, setState] = useState({ loading: true, events: [], error: '' });
  useEffect(() => {
    let active = true;
    api.getTeamMemberActivity(member.user_id, { ...params, limit: 20 })
      .then((res) => { if (active) setState({ loading: false, events: res.events || [], error: '' }); })
      .catch((err) => { if (active) setState({ loading: false, events: [], error: err.message || 'Could not load this person\'s activity.' }); });
    return () => { active = false; };
  }, [member.user_id, params]);

  return (
    <div role="dialog" aria-label={`${member.name} activity`} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 9000, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 100%)', height: '100%', background: C.surface, borderLeft: `1px solid ${C.border}`, padding: 20, overflowY: 'auto', boxShadow: '-8px 0 24px rgba(15,23,42,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Avatar name={member.name} id={member.user_id} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</p>
            <p style={{ fontSize: 11, color: C.muted }}>{ROLE_NAMES[member.role] || member.role || 'Member'} · latest actions in this period</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 0, color: C.muted, padding: 4 }}><X size={18} /></button>
        </div>
        {state.loading && <Empty><Activity size={18} color={C.accent} style={{ animation: 'spin 1.5s linear infinite' }} /></Empty>}
        {!state.loading && state.error && <Empty>{state.error}</Empty>}
        {!state.loading && !state.error && !state.events.length && <Empty>No activity in this period.</Empty>}
        {!state.loading && state.events.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {state.events.map((e) => (
              <li key={e.id} style={{ padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{e.action}</span>
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{timeAgo(e.at)}</span>
                </div>
                {e.details && <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{e.details}</p>}
              </li>
            ))}
          </ul>
        )}
        {canOpenLog && (
          <Link to="/settings/activity" style={{ display: 'inline-block', marginTop: 16, fontSize: 12, fontWeight: 600, color: C.accent }}>
            Open the full activity log
          </Link>
        )}
      </div>
    </div>
  );
}

export function TeamReport({ params, role }) {
  const [state, setState] = useState({ key: null, data: null, error: '' });
  const [sort, setSort] = useState({ key: 'replies', dir: 'desc' });
  const [selected, setSelected] = useState(null);
  const key = JSON.stringify(params);
  const loading = state.key !== key;

  useEffect(() => {
    let active = true;
    api.getTeamReport(params)
      .then((data) => { if (active) setState({ key, data, error: '' }); })
      .catch((err) => { if (active) setState({ key, data: null, error: err.message || 'Could not load the team report.' }); });
    return () => { active = false; };
  }, [key, params]);

  const data = state.data;
  const rows = useMemo(() => sortMembers(data?.members || [], sort.key, sort.dir), [data, sort]);
  const changeSort = (column) => setSort((current) => (current.key === column
    ? { key: column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key: column, dir: defaultTeamSort(column) }));

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 };

  if (loading) {
    return (
      <div style={{ ...card, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Activity size={24} color={C.accent} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }
  if (state.error) return <div style={card}><Empty>{state.error}</Empty></div>;

  const ai = data.ai || {};
  const totals = data.totals || {};
  const hasActivity = teamHasActivity(data);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}><Users size={15} color={C.accent} />Team performance</h3>
          <span style={{ fontSize: 11, color: C.muted }}>Click a person to see what they did</span>
        </div>

        {!rows.length ? (
          <Empty>No team members yet.</Empty>
        ) : (
          <>
            {!hasActivity && <p style={{ fontSize: 12, color: C.muted, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>No data yet for this period. Replies, status changes, notes and tasks show here as your team works.</p>}
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {TEAM_COLUMNS.map((column) => {
                      const active = sort.key === column.key;
                      const Arrow = sort.dir === 'asc' ? ChevronUp : ChevronDown;
                      return (
                        <th key={column.key} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          onClick={() => changeSort(column.key)}
                          style={{ ...headCell, textAlign: column.key === 'name' ? 'left' : 'right', color: active ? C.text : C.muted }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            {column.label}{active && <Arrow size={12} />}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.user_id} className="hover-highlight" onClick={() => setSelected(m)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}`, opacity: m.active === false ? 0.6 : 1 }}>
                      <td style={{ ...cell, textAlign: 'left' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                          <Avatar name={m.name} id={m.user_id} />
                          <span>
                            <span style={{ display: 'block', fontWeight: 600 }}>{m.name}</span>
                            <span style={{ display: 'block', fontSize: 10, color: C.muted }}>{ROLE_NAMES[m.role] || m.role || 'Member'}{m.active === false ? ' · disabled' : ''}</span>
                          </span>
                        </span>
                      </td>
                      {TEAM_COLUMNS.slice(1).map((column) => (
                        <td key={column.key} style={{ ...cell, color: column.key === 'tasks_overdue' && m.tasks_overdue ? C.red : column.key === 'converted' && m.converted ? C.green : C.text, fontWeight: column.key === 'replies' ? 600 : 400 }}>
                          {valueText(column.key, m)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: C.bg, borderTop: `2px solid ${C.border}` }}>
                    <td style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>Team total</td>
                    {TEAM_COLUMNS.slice(1).map((column) => (
                      <td key={column.key} style={{ ...cell, fontWeight: 700 }}>{valueText(column.key, totals)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td style={{ ...cell, textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 30, height: 30, borderRadius: '50%', background: `${C.purple}18`, color: C.purple, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Bot size={15} /></span>
                        <span>
                          <span style={{ display: 'block', fontWeight: 600 }}>AI replies</span>
                          <span style={{ display: 'block', fontSize: 10, color: C.muted }}>{ai.handovers || 0} handed to a person</span>
                        </span>
                      </span>
                    </td>
                    <td style={cell}>—</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{ai.replies || 0}</td>
                    <td style={cell}>{formatDuration(ai.avg_first_reply_seconds)}</td>
                    <td style={cell} colSpan={6} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      <p style={{ fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
        <b>Replies</b>: WhatsApp messages and templates the person sent from Getnera. <b>Avg first reply</b>: time from a customer&apos;s message to the first answer, when this person sent that answer (waits over {data.first_reply_lookback_days || 7} days are left out; reply times are recorded from this update on). <b>Converted / Lost</b>: status changes they made in this period. <b>Leads open</b> and <b>Overdue</b> are as of now.
      </p>

      {selected && (
        <MemberActivity member={selected} params={params} canOpenLog={['owner', 'admin'].includes(role)} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
