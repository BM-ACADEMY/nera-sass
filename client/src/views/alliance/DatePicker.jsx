import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Accepts either a date-only string ("2026-08-14") or a datetime-local string
// ("2026-08-14T14:30") — only the date part is ever used for grid/day math.
const fromISO = (value) => {
  if (!value) return null;
  const [y, m, d] = value.split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};
const timePartOf = (value) => (value && value.includes('T') ? value.split('T')[1] : '');
const formatDisplay = (value, withTime) => {
  const date = fromISO(value);
  if (!date) return '';
  const dateStr = `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
  if (!withTime) return dateStr;
  const timePart = timePartOf(value);
  if (!timePart) return `${dateStr} --:--`;
  const [hour24, minute] = timePart.split(':').map(Number);
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${dateStr} ${pad(hour12)}:${pad(minute)} ${hour24 >= 12 ? 'PM' : 'AM'}`;
};
const sameDay = (a, b) => Boolean(a) && Boolean(b)
  && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => i);

const buildGrid = (year, month) => {
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push({ date: new Date(year, month, i - startOffset + 1), outside: true });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({ date: new Date(year, month, d), outside: false });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const last = cells[cells.length - 1].date;
    const next = new Date(last);
    next.setDate(last.getDate() + 1);
    cells.push({ date: next, outside: true });
  }
  return cells;
};

// Custom themed replacement for <input type="date"> (and, with withTime,
// <input type="datetime-local"> too) — the native popup can't be restyled to
// match the app theme, so this renders its own dropdown grid instead.
export const DatePicker = ({ value, onChange, min, max, placeholder, withTime = false }) => {
  const [open, setOpen] = useState(false);
  const [showQuickNav, setShowQuickNav] = useState(false);
  const rootRef = useRef(null);
  const selected = fromISO(value);
  const minDate = fromISO(min);
  const maxDate = fromISO(max);
  const timePart = timePartOf(value);
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewYear, setViewYear] = useState((selected || today).getFullYear());
  const [viewMonth, setViewMonth] = useState((selected || today).getMonth());
  const effectivePlaceholder = placeholder || (withTime ? 'dd-mm-yyyy --:--' : 'dd-mm-yyyy');

  useEffect(() => {
    if (!open) return;
    const base = selected || today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setShowQuickNav(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const handleKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const isDisabled = (date) => (minDate && date < minDate) || (maxDate && date > maxDate);

  const pick = (date) => {
    if (isDisabled(date)) return;
    if (withTime) {
      const liveNow = new Date();
      liveNow.setMinutes(liveNow.getMinutes() + 1, 0, 0);
      const liveTime = `${pad(liveNow.getHours())}:${pad(liveNow.getMinutes())}`;
      onChange(`${toISO(date)}T${timePart || liveTime}`);
    } else {
      onChange(toISO(date));
      setOpen(false);
    }
  };

  const pickToday = () => {
    const liveNow = new Date();
    if (withTime) {
      // Scheduling at the exact current minute is already in the past once
      // submitted, so default to the next minute using a fresh clock value.
      liveNow.setMinutes(liveNow.getMinutes() + 1, 0, 0);
      onChange(`${toISO(liveNow)}T${pad(liveNow.getHours())}:${pad(liveNow.getMinutes())}`);
    } else {
      onChange(toISO(liveNow));
      setOpen(false);
    }
    setViewYear(liveNow.getFullYear());
    setViewMonth(liveNow.getMonth());
  };

  const changeTime = (newTime) => {
    const datePart = value ? value.split('T')[0] : toISO(selected || today);
    onChange(`${datePart}T${newTime}`);
  };

  const [h24Raw, mRaw] = timePart ? timePart.split(':').map(Number) : [now.getHours(), now.getMinutes()];
  const hour12 = ((h24Raw + 11) % 12) + 1;
  const minute = mRaw;
  const period = h24Raw >= 12 ? 'PM' : 'AM';
  const setTimeParts = (newHour12, newMinute, newPeriod) => {
    let hour24 = newHour12 % 12;
    if (newPeriod === 'PM') hour24 += 12;
    changeTime(`${pad(hour24)}:${pad(newMinute)}`);
  };

  const stepMonth = (delta) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const yearOptions = () => {
    const base = selected ? selected.getFullYear() : today.getFullYear();
    const start = Math.min(base, today.getFullYear()) - 6;
    const end = Math.max(base, today.getFullYear()) + 2;
    const years = [];
    for (let y = start; y <= end; y += 1) years.push(y);
    return years;
  };

  const cells = buildGrid(viewYear, viewMonth);

  return (
    <div className="al-dp" ref={rootRef}>
      <button type="button" className="al-dp-trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'al-dp-placeholder'}>{value ? formatDisplay(value, withTime) : effectivePlaceholder}</span>
        <Calendar size={15} />
      </button>
      {open && (
        <div className="al-dp-panel" role="dialog">
          <div className="al-dp-head">
            <button type="button" className="al-dp-nav" onClick={() => stepMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <button type="button" className="al-dp-label" onClick={() => setShowQuickNav((s) => !s)}>{MONTHS[viewMonth]} {viewYear}</button>
            <button type="button" className="al-dp-nav" onClick={() => stepMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
          {showQuickNav && (
            <div className="al-dp-quicknav">
              <select value={viewMonth} onChange={(event) => setViewMonth(Number(event.target.value))}>
                {MONTHS.map((m, index) => <option key={m} value={index}>{m}</option>)}
              </select>
              <select value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))}>
                {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}
          <div className="al-dp-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="al-dp-grid">
            {cells.map(({ date, outside }, index) => {
              const disabled = isDisabled(date);
              const isSelected = sameDay(date, selected);
              const isToday = sameDay(date, today);
              return (
                <button
                  type="button"
                  key={index}
                  disabled={disabled}
                  className={['al-dp-cell', outside ? 'outside' : '', isSelected ? 'selected' : '', isToday && !isSelected ? 'today' : ''].filter(Boolean).join(' ')}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          {withTime && (
            <div className="al-dp-time-row">
              <label>Time</label>
              <div className="al-dp-time-controls">
                <select value={hour12} onChange={(event) => setTimeParts(Number(event.target.value), minute, period)}>
                  {HOURS_12.map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                </select>
                <span>:</span>
                <select value={minute} onChange={(event) => setTimeParts(hour12, Number(event.target.value), period)}>
                  {MINUTES_60.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                </select>
                <div className="al-dp-ampm">
                  <button type="button" className={period === 'AM' ? 'active' : ''} onClick={() => setTimeParts(hour12, minute, 'AM')}>AM</button>
                  <button type="button" className={period === 'PM' ? 'active' : ''} onClick={() => setTimeParts(hour12, minute, 'PM')}>PM</button>
                </div>
              </div>
            </div>
          )}
          <div className="al-dp-foot">
            <button type="button" className="al-dp-link" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="al-dp-link" onClick={pickToday}>Today</button>
              {withTime && <button type="button" className="al-dp-link" onClick={() => setOpen(false)}>Done</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
