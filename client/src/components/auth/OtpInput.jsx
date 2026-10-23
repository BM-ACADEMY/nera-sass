import React, { useRef } from 'react';
const cn = (...parts) => parts.filter(Boolean).join(' ');

// Six separate digit boxes: typing moves forward, Backspace moves back, and a
// pasted or auto-filled code fills every box. onComplete fires on the 6th digit.
const OtpInput = ({ value, onChange, onComplete, length = 6, disabled = false, invalid = false, autoFocus = true }) => {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const setAt = (index, digit) => {
    const next = digits.slice();
    next[index] = digit;
    const joined = next.join('').slice(0, length);
    onChange(joined);
    if (joined.length === length && !joined.includes('') && /^\d+$/.test(joined)) onComplete?.(joined);
  };

  const fill = (text, from = 0) => {
    const clean = text.replace(/\D/g, '').slice(0, length - from);
    if (!clean) return;
    const next = digits.slice();
    clean.split('').forEach((d, i) => { next[from + i] = d; });
    const joined = next.join('');
    onChange(joined);
    refs.current[Math.min(from + clean.length, length - 1)]?.focus();
    if (joined.length === length && /^\d+$/.test(joined)) onComplete?.(joined);
  };

  const onKeyDown = (index) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[index]) setAt(index, '');
      else if (index > 0) { refs.current[index - 1]?.focus(); setAt(index - 1, ''); }
    } else if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    else if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  };

  const onInput = (index) => (e) => {
    const typed = e.target.value.replace(/\D/g, '');
    if (!typed) return;
    if (typed.length > 1) { fill(typed, index); return; }
    setAt(index, typed);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2" onPaste={(e) => { e.preventDefault(); fill(e.clipboardData.getData('text')); }}>
      {digits.map((digit, i) => (
        <React.Fragment key={i}>
          {i === length / 2 && <span className="self-center text-slate-300" aria-hidden>–</span>}
          <input
            ref={(el) => { refs.current[i] = el; }}
            value={digit}
            onChange={onInput(i)}
            onKeyDown={onKeyDown(i)}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            maxLength={length}
            aria-label={`Digit ${i + 1}`}
            className={cn(
              'h-11 w-11 min-w-0 shrink-0 rounded-xl border-2 bg-white p-0 text-center text-xl font-bold text-slate-900 shadow-sm outline-none transition-all sm:h-12 sm:w-12',
              'focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15',
              digit ? 'border-slate-300' : 'border-slate-200',
              invalid && 'animate-[shake_0.35s] border-red-400 focus:border-red-500 focus:ring-red-100',
              disabled && 'opacity-60',
            )}
          />
        </React.Fragment>
      ))}
    </div>
  );
};

export default OtpInput;
