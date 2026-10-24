import React, { useState } from 'react';
import { FiExternalLink, FiPhone, FiCopy, FiCornerUpLeft, FiList, FiImage, FiVideo, FiFileText } from 'react-icons/fi';
import { FaPlay, FaPause } from 'react-icons/fa';
import { cn } from '@/lib/utils';

// WhatsApp text formatting: *bold* _italic_ ~strike~ ```mono```, with
// variables replaced by their sample values (or left as {{1}} when empty).
function renderText(text, samples = {}) {
  const filled = String(text || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (match, name) => samples[name] || match);
  const parts = [];
  const pattern = /```([^`]+)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0;
  let key = 0;
  for (const m of filled.matchAll(pattern)) {
    if (m.index > last) parts.push(filled.slice(last, m.index));
    if (m[1]) parts.push(<code key={key++} className="font-mono text-[12.5px]">{m[1]}</code>);
    else if (m[2]) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3]}</em>);
    else if (m[4]) parts.push(<s key={key++}>{m[4]}</s>);
    last = m.index + m[0].length;
  }
  if (last < filled.length) parts.push(filled.slice(last));
  return parts;
}

const BUTTON_ICON = { URL: FiExternalLink, PHONE_NUMBER: FiPhone, COPY_CODE: FiCopy, OTP: FiCopy, QUICK_REPLY: FiCornerUpLeft };
const MEDIA_ICON = { IMAGE: FiImage, VIDEO: FiVideo, DOCUMENT: FiFileText };
const buttonLabel = (b) => (b.type === 'COPY_CODE' ? 'Copy offer code' : b.type === 'OTP' ? (b.text || 'Copy code') : b.text || 'Button');

/**
 * `template`: { header_format, header_text, media_url?, media_name?, body,
 *   footer, buttons: [{ type, text }], samples }, the editor's shape.
 * Use toEditorShape() to show a Meta template.
 */
const TemplatePreview = ({ template, title = 'Template preview', className, compact = false }) => {
  const [showSamples, setShowSamples] = useState(true);
  const samples = showSamples ? template.samples || {} : {};
  const buttons = template.buttons || [];
  // WhatsApp shows two buttons and folds the rest into "See all options".
  const visibleButtons = buttons.length > 3 ? buttons.slice(0, 2) : buttons;
  const MediaIcon = MEDIA_ICON[template.header_format];
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      {!compact && (
        <div className="flex items-center justify-between bg-white px-4 py-3">
          <span className="text-[15px] font-bold text-slate-900">{title}</span>
          <button
            type="button"
            onClick={() => setShowSamples((v) => !v)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-slate-400 bg-white text-slate-900 transition-colors hover:bg-slate-50"
            title={showSamples ? 'Showing sample values. Click to show the variables' : 'Showing variables. Click to show sample values'}
            aria-label={showSamples ? 'Show variables' : 'Show sample values'}
          >
            {showSamples ? <FaPlay className="size-3" /> : <FaPause className="size-3" />}
          </button>
        </div>
      )}
      <div className="bg-[#e9e2d7] bg-[radial-gradient(rgba(120,100,70,0.10)_1px,transparent_1px),radial-gradient(rgba(120,100,70,0.06)_1px,transparent_1px)] bg-size-[18px_18px,18px_18px] bg-position-[0_0,9px_9px] px-3 py-4">
        <div className="relative w-[92%] max-w-[320px] rounded-lg rounded-tl-none bg-white shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
          {/* WhatsApp's incoming-message tail, joined to the bubble's square top-left corner */}
          <svg viewBox="0 0 8 13" width="8" height="13" className="absolute top-0 -left-[7.5px] block text-white" aria-hidden>
            <path fill="rgba(11,20,26,0.06)" d="M1.533 3.568 8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" transform="translate(0 0.6)" />
            <path fill="currentColor" d="M1.533 2.568 8 11.193V0H2.812C1.042 0 .474 1.156 1.533 2.568z" />
          </svg>
          <div className="px-2.5 pt-2.5 pb-1.5">
            {MediaIcon && (
              template.media_url && template.header_format === 'IMAGE'
                ? <img src={template.media_url} alt="" className="mb-1.5 h-36 w-full rounded-md object-cover" />
                : (
                  <div className="mb-1.5 flex h-32 w-full flex-col items-center justify-center gap-1 rounded-md bg-slate-200 text-slate-500">
                    <MediaIcon className="size-8" />
                    <span className="max-w-[90%] truncate text-[11px]">{template.media_name || template.header_format.toLowerCase()}</span>
                  </div>
                )
            )}
            {template.header_format === 'TEXT' && template.header_text && (
              <div className="mb-1.5 text-[15px] font-bold break-words text-[#111b21]">{renderText(template.header_text, samples)}</div>
            )}
            <div className="text-[13.5px] leading-[1.4] break-words whitespace-pre-wrap text-[#111b21]">
              {template.body ? renderText(template.body, samples) : <span className="text-slate-400">Your message body appears here</span>}
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <span className="min-w-0 text-[12px] break-words text-[#8696a0]">{template.footer || ''}</span>
              <span className="shrink-0 text-[11px] text-[#667781]">{time}</span>
            </div>
          </div>
          {visibleButtons.length > 0 && (
            <div className="border-t border-slate-200">
              {visibleButtons.map((b, i) => {
                const Icon = BUTTON_ICON[b.type] || FiExternalLink;
                return (
                  <div key={i} className={cn('flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13.5px] font-medium text-[#1f8f7e]', i > 0 && 'border-t border-slate-200')}>
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{buttonLabel(b)}</span>
                  </div>
                );
              })}
              {buttons.length > 3 && (
                <div className="flex items-center justify-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-[13.5px] font-medium text-[#1f8f7e]">
                  <FiList className="size-4" /> See all options
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Meta template (components) -> the editor/preview shape.
export function toEditorShape(t) {
  const find = (type) => (t.components || []).find((c) => String(c.type).toUpperCase() === type);
  const header = find('HEADER');
  const body = find('BODY');
  const footer = find('FOOTER');
  const buttons = find('BUTTONS')?.buttons || [];
  const samples = {};
  const bodyExample = body?.example;
  if (bodyExample?.body_text?.[0]) bodyExample.body_text[0].forEach((v, i) => { samples[i + 1] = v; });
  (bodyExample?.body_text_named_params || []).forEach((p) => { samples[p.param_name] = p.example; });
  const headerExample = header?.example;
  if (headerExample?.header_text?.[0]) samples[1] = samples[1] || headerExample.header_text[0];
  (headerExample?.header_text_named_params || []).forEach((p) => { samples[p.param_name] = p.example; });
  const isAuth = String(t.category).toUpperCase() === 'AUTHENTICATION';
  return {
    name: t.name,
    language: t.language,
    category: String(t.category || 'MARKETING').toUpperCase(),
    variable_type: t.parameter_format === 'NAMED' || Object.keys(samples).some((k) => !/^\d+$/.test(k)) ? 'name' : 'number',
    header_format: header ? String(header.format || 'TEXT').toUpperCase() : 'NONE',
    header_text: header?.text || '',
    header_handle: headerExample?.header_handle?.[0] || '',
    body: isAuth ? `*{{1}}* is your verification code.${body?.add_security_recommendation ? ' For your security, do not share this code.' : ''}` : body?.text || '',
    footer: isAuth ? (footer?.code_expiration_minutes ? `This code expires in ${footer.code_expiration_minutes} minutes.` : '') : footer?.text || '',
    buttons: buttons.map((b) => ({ ...b, type: String(b.type).toUpperCase(), example: Array.isArray(b.example) ? b.example[0] : b.example })),
    samples: isAuth ? { 1: '123456' } : samples,
    add_security_recommendation: Boolean(body?.add_security_recommendation),
    code_expiration_minutes: footer?.code_expiration_minutes || '',
  };
}

export default TemplatePreview;
