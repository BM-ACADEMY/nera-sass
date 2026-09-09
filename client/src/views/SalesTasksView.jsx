import React, { useState, useEffect } from 'react';
import { C } from '../constants/theme.js';
import { api, allianceInboxApi } from '../services/api.js';
import { RefreshCw, User, Trash2, X, AlertTriangle, ChevronDown, ChevronUp, MessageSquare, Search, CalendarDays, Tag, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';

export const SalesTasksView = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [notesTask, setNotesTask] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [bulkDeleteMode, setBulkDeleteMode] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState(null);
  const tasksPerPage = 10;

  const fetchCalendarStatus = async () => {
    try { setCalendarStatus(await api.get('/calendar/status')); }
    catch { setCalendarStatus({ connected: false }); }
  };

  const openLead = async (leadId) => {
    try { await api.put(`/sales-tasks/lead/${leadId}/read`, {}); } catch { /* navigation should still work */ }
    setTasks(current => current.map(task => task.lead_id === leadId ? { ...task, unread: false } : task));
    navigate('/inbox', { state: { leadId } });
  };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/sales-tasks');
      if (res.success) {
        setTasks(res.tasks || []);
        setSelectedTaskIds(current => current.filter(id => (res.tasks || []).some(task => task.id === id)));
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
      toast.error('Failed to refresh tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      fetchTasks();
      fetchCalendarStatus();
      allianceInboxApi.getTags().then(setAvailableTags).catch(console.error);
    }, 0);
    const socket = socketIO(api.baseUrl, { transports: ['websocket', 'polling'] });
    socket.on('sales_task_update', fetchTasks);
    return () => {
      window.clearTimeout(initialLoad);
      socket.disconnect();
    };
  }, []);

  const updateStatus = async (id, status) => {
    try {
      const res = await api.put(`/sales-tasks/${id}/status`, { status });
      if (res.success) {
        setTasks(current => current.map(t => t.id === id ? { ...t, ...res.task } : t));
        toast.success(`Task marked as ${status}`);
      }
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Failed to update task status');
    }
  };

  const executeDeleteTask = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      const res = await api.delete(`/sales-tasks/${deleteConfirmId}`);
      if (res.success) {
        setTasks(tasks.filter(t => t.id !== deleteConfirmId));
        setCurrentPage(1);
        toast.success('Task deleted successfully');
        setDeleteConfirmId(null);
      }
    } catch (err) {
      console.error('Error deleting task:', err);
      toast.error('Failed to delete task');
    } finally {
      setIsDeleting(false);
    }
  };

  const executeBulkDelete = async () => {
    const deletingBySelection = bulkDeleteMode === 'selected';
    if (deletingBySelection && selectedTaskIds.length === 0) return;
    if (!deletingBySelection && (!dateFrom || !dateTo || dateFrom > dateTo)) {
      return toast.error('Choose a valid from and to date');
    }
    setIsDeleting(true);
    try {
      const body = deletingBySelection ? { ids: selectedTaskIds } : { from: dateFrom, to: dateTo };
      const res = await api.post('/sales-tasks/bulk-delete', body);
      if (res.success) {
        const deletedIds = new Set(res.deletedIds || []);
        setTasks(current => current.filter(task => !deletedIds.has(task.id)));
        setCurrentPage(1);
        setSelectedTaskIds([]);
        setBulkDeleteMode(null);
        toast.success(`${res.deletedCount} task${res.deletedCount === 1 ? '' : 's'} deleted`);
      }
    } catch (err) {
      toast.error('Failed to delete tasks: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusStyles = (status) => {
    switch(status) {
      case 'completed': 
        return { bg: 'rgba(16, 185, 129, 0.1)', text: '#10b981', border: 'rgba(16, 185, 129, 0.2)' };
      case 'processing': 
        return { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6', border: 'rgba(59, 130, 246, 0.2)' };
      default: // pending
        return { bg: 'rgba(245, 158, 11, 0.1)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.2)' };
    }
  };

  const formatTaskType = (type) => {
    switch(type) {
      case 'hot_lead': return '🔥 Hot Lead';
      case 'call': return '📞 Scheduled Call';
      case 'followup': return '💬 Follow-up';
      case 'overdue': return '⚠️ Overdue Task';
      default: return type;
    }
  };

  const updateLeadStatus = async (leadId, status) => {
    try {
      const res = await api.put(`/sales-tasks/lead/${leadId}/sales-status`, { status });
      setTasks(current => current.map(task => task.lead_id === leadId ? { ...task, ...res.lead } : task));
      toast.success('Lead status updated');
    } catch (err) { toast.error('Failed to update lead status: ' + err.message); }
  };

  const saveNote = async () => {
    if (!noteText.trim() || !notesTask) return toast.error('Enter a note');
    setSavingNote(true);
    try {
      if (editingNoteId) {
        const res = await api.put(`/sales-tasks/notes/${editingNoteId}`, { note: noteText.trim() });
        setTasks(current => current.map(task => task.lead_id === notesTask.lead_id ? {
          ...task, latest_sales_note: res.note.note, latest_sales_note_at: res.note.created_at,
        } : task));
        toast.success('Note updated');
      } else {
        const res = await api.post(`/sales-tasks/lead/${notesTask.lead_id}/notes`, { note: noteText.trim() });
        setTasks(current => current.map(task => task.lead_id === notesTask.lead_id ? {
          ...task, ...res.lead, latest_sales_note: res.note.note, latest_sales_note_at: res.note.created_at, latest_sales_note_id: res.note.id
        } : task));
        toast.success(res.lead.sales_followup_stopped ? 'Note saved — automated follow-ups stopped' : res.lead.sales_followup_at ? 'Note saved — follow-up rescheduled' : 'Note saved');
      }
      setNotesTask(null);
      setNoteText('');
      setEditingNoteId(null);
    } catch (err) { toast.error('Failed to save note: ' + err.message); }
    finally { setSavingNote(false); }
  };

  const deleteNote = async (noteId, leadId) => {
    try {
      setSavingNote(true);
      const res = await api.delete(`/sales-tasks/notes/${noteId}`);
      setTasks(current => current.map(task => task.lead_id === leadId ? {
        ...task,
        latest_sales_note: res.latest_note?.note || null,
        latest_sales_note_at: res.latest_note?.created_at || null,
        latest_sales_note_id: res.latest_note?.id || null
      } : task));
      setNotesTask(null);
      setNoteText('');
      setEditingNoteId(null);
      toast.success('Note deleted');
    } catch (err) {
      toast.error('Failed to delete note: ' + err.message);
    } finally {
      setSavingNote(false);
    }
  };

  const formatDateTime = (value) => value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  const normalizedSearch = search.trim().toLowerCase();
  const searchDigits = search.replace(/\D/g, '');
  const filteredTasks = tasks.filter(task => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (tagFilter && !(task.tags || []).some(t => t.id === Number(tagFilter))) return false;
    if (!normalizedSearch) return true;
    const nameMatches = String(task.name || '').toLowerCase().includes(normalizedSearch);
    const phoneDigits = String(task.phone || '').replace(/\D/g, '');
    return nameMatches || Boolean(searchDigits && phoneDigits.includes(searchDigits));
  });
  const indexOfLastTask = currentPage * tasksPerPage;
  const currentTasks = filteredTasks.slice(indexOfLastTask - tasksPerPage, indexOfLastTask);
  const currentTaskIds = currentTasks.map(task => task.id);
  const allCurrentSelected = currentTaskIds.length > 0 && currentTaskIds.every(id => selectedTaskIds.includes(id));
  const dateRangeMatchCount = dateFrom && dateTo && dateFrom <= dateTo
    ? tasks.filter(task => {
        const date = new Date(task.created_at);
        const localDate = Number.isNaN(date.getTime()) ? '' : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
        return localDate >= dateFrom && localDate <= dateTo;
      }).length
    : 0;

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%', background: C.bg, position: 'relative' }}>
      
      {/* Custom select css overrides */}
      <style>{`
        .task-status-select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg fill='%2364748b' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'><path d='M7 10l5 5 5-5z'/><path d='M0 0h24v24H0z' fill='none'/></svg>");
          background-repeat: no-repeat;
          background-position: right 6px center;
          background-size: 16px;
          padding-right: 22px !important;
        }
      `}</style>

      {/* --- HEADER CONTROLS --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 26 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            Sales Tasks
            <User size={18} color={C.accent} />
          </h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
            Booked demos, hot leads, and follow-ups requiring sales attention
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <div style={{ height: 38, minWidth: 240, display: 'flex', alignItems: 'center', gap: 7, padding: '0 11px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9 }}>
          <Search size={13} color={C.muted} />
          <input value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search name or phone..." style={{ width: '100%', background: 'transparent', border: 0, outline: 'none', color: C.text, fontSize: 11 }} />
          {search && <button onClick={() => setSearch('')} title="Clear search" style={{ background: 'transparent', border: 0, padding: 2, cursor: 'pointer', display: 'flex' }}><X size={12} color={C.muted} /></button>}
        </div>
        <button
          disabled={filteredTasks.length === 0}
          onClick={() => {
            if (filteredTasks.length === 0) return toast.error('No tasks to export');
            toast.promise(
              api.exportSalesTasks(filteredTasks.map(t => t.id)),
              {
                loading: 'Exporting tasks...',
                success: 'Tasks exported successfully!',
                error: 'Failed to export tasks'
              }
            );
          }}
          style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '9px 13px', borderRadius: 9, cursor: filteredTasks.length ? 'pointer' : 'not-allowed', opacity: filteredTasks.length ? 1 : 0.5, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Download size={13} />
          Export
        </button>
        <button
          onClick={fetchTasks}
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            color: C.text,
            padding: '9px 16px',
            borderRadius: 9,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.2s ease'
          }}
          onMouseEnter={e => e.currentTarget.style.background = C.border}
          onMouseLeave={e => e.currentTarget.style.background = C.surface}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh Tasks
        </button>
        <button
          onClick={() => calendarStatus?.connected ? fetchCalendarStatus() : window.open(`${api.baseUrl}/api/auth/google`, '_blank', 'noopener,noreferrer')}
          title={calendarStatus?.connected ? 'Google Calendar is connected' : 'Connect the organizer Google Calendar'}
          style={{ background: calendarStatus?.connected ? 'rgba(16,185,129,.12)' : C.surface, border: `1px solid ${calendarStatus?.connected ? C.green : C.border}`, color: calendarStatus?.connected ? C.green : C.text, padding: '9px 13px', borderRadius: 9, cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <CalendarDays size={13} />
          {calendarStatus?.connected ? 'Calendar Connected' : 'Connect Calendar'}
        </button>
        </div>
      </div>

      <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
        <div><strong style={{ color: C.red, fontSize: 11 }}>🔥 Hot Lead</strong><p style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>Lead status is Hot and requires priority sales attention.</p></div>
        <div><strong style={{ color: C.blue, fontSize: 11 }}>📞 Scheduled Call</strong><p style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>A demo call is booked and remains active until completed or its lead status changes.</p></div>
        <div><strong style={{ color: C.purple, fontSize: 11 }}>💬 Follow-up</strong><p style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>The lead has an active next follow-up date and is not booked, converted, lost, or opted out.</p></div>
        <div><strong style={{ color: '#f59e0b', fontSize: 11 }}>⚠ Overdue</strong><p style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>The scheduled follow-up time has passed and still needs action.</p></div>
      </div>

      <div style={{ marginBottom: 12, padding: 12, border: `1px solid ${C.border}`, background: C.surface, borderRadius: 8, display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 5, color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
          Task status
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }} style={{ minWidth: 140, height: 34, background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '0 9px', fontSize: 11 }}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
          Tag
          <select value={tagFilter} onChange={e => { setTagFilter(e.target.value); setCurrentPage(1); }} style={{ minWidth: 140, height: 34, background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '0 9px', fontSize: 11 }}>
            <option value="">All Tags</option>
            {availableTags.map(tag => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
          From date
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ height: 32, colorScheme: 'dark', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '0 9px', fontSize: 11 }} />
        </label>
        <label style={{ display: 'grid', gap: 5, color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>
          To date
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)} style={{ height: 32, colorScheme: 'dark', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '0 9px', fontSize: 11 }} />
        </label>
        <button disabled={!dateFrom || !dateTo || dateFrom > dateTo || dateRangeMatchCount === 0} onClick={() => setBulkDeleteMode('date')} style={{ height: 34, background: 'transparent', border: `1px solid ${C.red}`, color: C.red, borderRadius: 7, padding: '0 11px', cursor: dateRangeMatchCount ? 'pointer' : 'not-allowed', opacity: dateRangeMatchCount ? 1 : .45, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700 }}>
          <Trash2 size={13} /> Delete date range ({dateRangeMatchCount})
        </button>
        <button disabled={selectedTaskIds.length === 0} onClick={() => setBulkDeleteMode('selected')} style={{ height: 34, marginLeft: 'auto', background: selectedTaskIds.length ? C.red : 'transparent', border: `1px solid ${selectedTaskIds.length ? C.red : C.border}`, color: selectedTaskIds.length ? '#fff' : C.muted, borderRadius: 7, padding: '0 11px', cursor: selectedTaskIds.length ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700 }}>
          <Trash2 size={13} /> Delete selected ({selectedTaskIds.length})
        </button>
      </div>

      {/* --- TASKS TABLE --- */}
      <div className="table-responsive" style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, overflow: 'hidden' }}>
        {loading && tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted }}>Loading your tasks...</div>
        ) : filteredTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: C.muted, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <User size={36} color={C.border} />
            <span style={{ fontSize: 13 }}>{search ? 'No leads match that name or phone number.' : "No active sales tasks. You're all caught up!"}</span>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid ' + C.border }}>
                <th style={{ width: 36, padding: '12px 8px 12px 14px' }}>
                  <input type="checkbox" aria-label="Select tasks on this page" checked={allCurrentSelected} onChange={() => setSelectedTaskIds(current => allCurrentSelected ? current.filter(id => !currentTaskIds.includes(id)) : [...new Set([...current, ...currentTaskIds])])} />
                </th>
                {['Lead', 'Contact', 'Tags', 'Lead Status', 'Task Type', 'Task Date', 'Task Status', 'Notes', 'Details'].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                return currentTasks.map((task, idx) => {
                  const styles = getStatusStyles(task.status);
                  const isExpanded = expandedTaskId === task.id;
                  return (
                    <React.Fragment key={task.id}>
                    <tr 
                      onClick={() => openLead(task.lead_id)}
                    style={{ 
                      borderBottom: '1px solid ' + C.border, 
                      background: task.unread ? `${C.accent}08` : (idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'),
                      cursor: 'pointer',
                    }}
                  >
                    <td onClick={e => e.stopPropagation()} style={{ padding: '14px 8px 14px 14px' }}>
                      <input type="checkbox" aria-label={`Select ${task.name || 'task'}`} checked={selectedTaskIds.includes(task.id)} onChange={() => setSelectedTaskIds(current => current.includes(task.id) ? current.filter(id => id !== task.id) : [...current, task.id])} />
                    </td>
                    {/* Lead Detail */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: `${C.accent}15`, display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: C.accent, flexShrink: 0
                        }}>
                          {task.name ? task.name[0].toUpperCase() : 'L'}
                        </div>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>{task.name || 'Unknown Lead'}{task.unread && <span title="Unread" style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent, display: 'inline-block' }} />}</p>
                          <span style={{ fontSize: 10, color: C.muted, textTransform: 'capitalize' }}>
                            Stage: {task.lead_status || 'New'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Contact Info */}
                    <td style={{ padding: '14px 16px' }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{task.phone || '-'}</p>
                    </td>

                    {/* Tags */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 140 }}>
                        {task.tags && task.tags.length > 0 ? task.tags.map(tag => (
                          <span key={tag.id} style={{ fontSize: 9, fontWeight: 700, background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44`, padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                            {tag.name}
                          </span>
                        )) : <span style={{ fontSize: 10, color: C.dim }}>-</span>}
                      </div>
                    </td>

                    {/* Task Type */}
                    <td style={{ padding: '14px 16px' }}>
                      <select value={task.sales_status || 'new'} onClick={e => e.stopPropagation()} onChange={e => updateLeadStatus(task.lead_id, e.target.value)} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 8px', fontSize: 10, outline: 'none', cursor: 'pointer' }}>
                        <option value="new">New</option><option value="contacted">Contacted</option><option value="processing">Processing</option><option value="follow_up">Follow-up</option><option value="converted">Converted</option><option value="not_interested">Not Interested</option><option value="closed">Closed</option>
                      </select>
                    </td>

                    {/* Task Type */}
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ 
                        fontSize: 11, 
                        fontWeight: 600,
                        color: task.task_type === 'hot_lead' ? C.red : task.task_type === 'call' ? C.blue : C.purple, 
                        background: task.task_type === 'hot_lead' ? 'rgba(239, 68, 68, 0.1)' : task.task_type === 'call' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(139, 92, 246, 0.1)', 
                        padding: '4px 10px', 
                        borderRadius: 12 
                      }}>
                        {formatTaskType(task.task_type)}
                      </span>
                    </td>

                    <td style={{ padding: '14px 16px', color: C.muted, fontSize: 10, whiteSpace: 'nowrap' }}>
                      {formatDateTime(task.created_at)}
                    </td>

                    {/* Status Action & Delete */}
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <select 
                          value={task.status}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateStatus(task.id, e.target.value)}
                          className="task-status-select"
                          style={{
                            backgroundColor: styles.bg,
                            color: styles.text,
                            border: '1px solid ' + styles.border,
                            borderRadius: 14,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            outline: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <option value="pending" style={{ background: C.card, color: '#f59e0b' }}>Pending</option>
                          <option value="processing" style={{ background: C.card, color: '#3b82f6' }}>Processing</option>
                          <option value="completed" style={{ background: C.card, color: '#10b981' }}>Completed</option>
                        </select>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(task.id); }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: C.muted,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            borderRadius: '4px',
                            transition: 'color 0.2s ease'
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.muted}
                          title="Delete Task"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {task.latest_sales_note ? (
                        <div onClick={e => { e.stopPropagation(); setNotesTask(task); setNoteText(task.latest_sales_note || ''); setEditingNoteId(task.latest_sales_note_id || null); }} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', padding: '6px 10px', borderRadius: 8, border: `1px solid ${C.border}` }} title="Click to edit note">
                          <MessageSquare size={12} color={C.blue} style={{ flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: C.text, maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.latest_sales_note}</span>
                        </div>
                      ) : (
                        <button onClick={e => { e.stopPropagation(); setNotesTask(task); setNoteText(''); }} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, padding: '6px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}><MessageSquare size={12} /> Add Note</button>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedTaskId(isExpanded ? null : task.id); }}
                        aria-expanded={isExpanded}
                        style={{ background: isExpanded ? `${C.accent}18` : 'transparent', border: `1px solid ${isExpanded ? C.accent : C.border}`, color: isExpanded ? C.accent : C.muted, padding: '6px 10px', borderRadius: 7, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {isExpanded ? 'Hide Details' : 'View Details'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: 'rgba(255,255,255,0.018)', borderBottom: `1px solid ${C.border}` }}>
                      <td colSpan={10} style={{ padding: '0 16px 16px' }}>
                        <div onClick={e => e.stopPropagation()} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12, padding: 16, borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
                          {[
                            ['Brand', task.brand_name || '—'],
                            ['Source', task.source || '—'],
                            ['Interest', task.interest || '—'],
                            ['Lead Score', task.score ?? 0],
                            ['Assigned To', task.assigned_name || 'Unassigned'],
                            [task.task_type === 'call' ? 'Demo Call' : 'Next Follow-up', formatDateTime(task.task_type === 'call' ? task.call_booked_at : task.next_followup_due)],
                            ['Calendar Status', task.booking_status || (task.task_type === 'call' ? 'Pending' : '—')],
                            ['Lead Created', formatDateTime(task.lead_created_at)],
                            ['Last Contact', formatDateTime(task.last_contact)],
                            ['Latest Sales Note', task.latest_sales_note || '—'],
                            ['Next AI Follow-up', task.sales_followup_stopped ? 'Stopped' : formatDateTime(task.sales_followup_at || task.next_followup_due)],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <p style={{ margin: 0, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: .6 }}>{label}</p>
                              <p style={{ margin: '4px 0 0', fontSize: 11, color: C.text, fontWeight: 600 }}>{value}</p>
                            </div>
                          ))}
                          {task.calendar_event_url && <a href={task.calendar_event_url} target="_blank" rel="noreferrer" style={{ alignSelf: 'center', justifySelf: 'start', color: C.blue, fontSize: 10, fontWeight: 700 }}>Open Google Calendar</a>}
                          {task.google_meet_link && <a href={task.google_meet_link} target="_blank" rel="noreferrer" style={{ alignSelf: 'center', justifySelf: 'start', color: C.green, fontSize: 10, fontWeight: 700 }}>Join Google Meet</a>}
                          {task.unread && <button onClick={() => openLead(task.lead_id)} style={{ alignSelf: 'center', justifySelf: 'start', background: `${C.accent}18`, color: C.accent, border: `1px solid ${C.accent}55`, borderRadius: 7, padding: '7px 10px', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>Mark as Read & Open Chat</button>}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        )}

        {/* Pagination Controls */}
        {filteredTasks.length > tasksPerPage && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: C.card, borderTop: '1px solid ' + C.border }}>
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>
              Showing {((currentPage - 1) * tasksPerPage) + 1} to {Math.min(currentPage * tasksPerPage, filteredTasks.length)} of {filteredTasks.length} entries
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                style={{ padding: '6px 14px', background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6, color: currentPage === 1 ? C.muted : C.text, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1, fontSize: 13, fontWeight: 500, transition: 'all 0.2s' }}
              >
                Previous
              </button>
              <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                Page {currentPage} of {Math.ceil(filteredTasks.length / tasksPerPage)}
              </span>
              <button 
                disabled={currentPage === Math.ceil(filteredTasks.length / tasksPerPage)}
                onClick={() => setCurrentPage(p => Math.min(Math.ceil(filteredTasks.length / tasksPerPage), p + 1))}
                style={{ padding: '6px 14px', background: 'transparent', border: '1px solid ' + C.border, borderRadius: 6, color: currentPage === Math.ceil(filteredTasks.length / tasksPerPage) ? C.muted : C.text, cursor: currentPage === Math.ceil(filteredTasks.length / tasksPerPage) ? 'not-allowed' : 'pointer', opacity: currentPage === Math.ceil(filteredTasks.length / tasksPerPage) ? 0.5 : 1, fontSize: 13, fontWeight: 500, transition: 'all 0.2s' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {notesTask && (
        <div onClick={() => !savingNote && setNotesTask(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><h3 style={{ margin: 0, color: C.text, fontSize: 15 }}>{editingNoteId ? 'Edit Sales Note' : 'Add Sales Note'}</h3><p style={{ margin: '3px 0 0', color: C.muted, fontSize: 10 }}>{notesTask.name}</p></div><button onClick={() => { setNotesTask(null); setEditingNoteId(null); }} style={{ background: 'transparent', border: 0, cursor: 'pointer' }}><X size={16} color={C.muted} /></button></div>
            <textarea autoFocus value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Example: Customer requested a callback tomorrow at 5 PM." rows={5} style={{ width: '100%', marginTop: 14, resize: 'vertical', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, padding: 12, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            <p style={{ color: C.dim, fontSize: 9, lineHeight: 1.5, marginTop: 7 }}>AI evaluates this note before future messages. “Already enrolled”, “Not interested”, or “Do not contact” stops automation. A future callback time reschedules it.</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
              <div>
                {editingNoteId && (
                  <button onClick={() => { if(window.confirm('Delete this note?')) deleteNote(editingNoteId, notesTask.lead_id); }} disabled={savingNote} style={{ background: 'transparent', border: 'none', color: C.red, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}><Trash2 size={13} /> Delete</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setNotesTask(null); setEditingNoteId(null); }} disabled={savingNote} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, padding: '8px 14px', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveNote} disabled={savingNote} style={{ background: C.accent, border: 0, color: '#fff', padding: '8px 16px', borderRadius: 8, fontWeight: 700, cursor: savingNote ? 'wait' : 'pointer' }}>{savingNote ? 'Saving...' : 'Save Note'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteMode && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, width: '100%', maxWidth: 420, boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} color={C.red} />Delete Multiple Tasks</h3>
              <button onClick={() => setBulkDeleteMode(null)} disabled={isDeleting} title="Close" style={{ background: 'transparent', border: 0, cursor: 'pointer', color: C.muted }}><X size={16} /></button>
            </div>
            <div style={{ padding: '22px 20px', color: C.muted, fontSize: 12, lineHeight: 1.6 }}>
              {bulkDeleteMode === 'selected'
                ? `Permanently delete ${selectedTaskIds.length} selected task${selectedTaskIds.length === 1 ? '' : 's'}?`
                : `Permanently delete ${dateRangeMatchCount} task${dateRangeMatchCount === 1 ? '' : 's'} created from ${dateFrom} through ${dateTo}?`}
              <p style={{ margin: '8px 0 0', color: C.red, fontSize: 10 }}>This action cannot be undone.</p>
            </div>
            <div style={{ padding: '14px 20px', background: C.card, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setBulkDeleteMode(null)} disabled={isDeleting} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '8px 14px', borderRadius: 7, cursor: 'pointer' }}>Cancel</button>
              <button onClick={executeBulkDelete} disabled={isDeleting} style={{ background: C.red, border: 0, color: '#fff', padding: '8px 14px', borderRadius: 7, fontWeight: 700, cursor: isDeleting ? 'wait' : 'pointer', opacity: isDeleting ? .7 : 1 }}>{isDeleting ? 'Deleting...' : 'Delete Tasks'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 12, width: '100%', maxWidth: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid ' + C.border, background: C.card }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color={C.red} />
                Delete Task
              </h3>
              <button onClick={() => setDeleteConfirmId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '24px 20px', color: C.muted, fontSize: 13, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete this task? This action cannot be undone and will remove the task history.
            </div>
            <div style={{ padding: '16px 20px', background: C.card, borderTop: '1px solid ' + C.border, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button 
                onClick={() => setDeleteConfirmId(null)}
                style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.text, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={executeDeleteTask}
                disabled={isDeleting}
                style={{ background: C.red, border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.7 : 1 }}
              >
                {isDeleting ? 'Deleting...' : 'Delete Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
