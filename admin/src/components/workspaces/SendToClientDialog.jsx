import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiAlertTriangle, FiCheckCircle, FiLock, FiPhone } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import axiosClient from '../../api/axiosClient';
import { FormField, IconInput } from '../FormField';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

// Friendly text for every refusal the server can give.
const ERRORS = {
  RATE_LIMITED: 'The hourly sending limit for this workspace is reached. Wait a while before sending again.',
  SEND_IN_PROGRESS: 'A message to this client is being sent right now. Wait a moment.',
  OPT_IN_REQUIRED: 'Tick the box to confirm the client agreed to get this on WhatsApp.',
  NUMBER_MISMATCH: 'The two numbers do not match. Type the client\'s number again in both boxes.',
};
const errorText = (err, fallback) => {
  if (!err.response) return 'Could not reach the server. Check your connection and try again.';
  if (['OWNER_ALREADY_SIGNED_IN', 'WORKSPACE_HAS_USERS'].includes(err.response.data?.code)) return err.response.data.error;
  if (err.response.status === 403) return 'You do not have permission to send sign-in details. Ask the founder or an ops admin.';
  const data = err.response.data || {};
  return ERRORS[data.code] || data.error || fallback;
};

// Same checks as the server (services/workspaceWelcome.js normalizeNumber).
const numberProblem = (value) => {
  let v = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!v) return 'Enter the client\'s WhatsApp number';
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  const digits = v.replace(/^\+/, '');
  if (!/^\d+$/.test(digits)) return 'Use digits only, for example +91 98765 43210';
  if (!v.startsWith('+') && digits.length === 10) return 'Add the country code, for example +91 98765 43210';
  if (digits.startsWith('0') || digits.length < 11 || digits.length > 15) return 'Use the full number with country code, for example +91 98765 43210';
  return null;
};
// The same number however it is written ("+91 98765 43210" = "0091-98765-43210").
const numberDigits = (value) => String(value || '').trim().replace(/^00/, '').replace(/\D/g, '');
const linkLife = (minutes) => (minutes % 60 === 0 && minutes >= 120 ? `${minutes / 60} hours` : `${minutes} minutes`);

/**
 * "Send to client": sends the workspace owner a WhatsApp message from the
 * platform number with a one-time set-password link and how to sign in.
 * Staff confirm the number and see the message first; nothing is sent until
 * they click Send. The password is never part of the message.
 */
const SendToClientDialog = ({ open, onOpenChange, tenantId, onSent }) => {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneConfirm, setPhoneConfirm] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);

  const load = async () => {
    setInfo(null);
    setLoadError('');
    try {
      const { data } = await axiosClient.get(`/admin/tenants/${tenantId}/welcome-message`);
      setInfo(data);
      setPhone((p) => p || data.suggested_number || '');
    } catch (err) {
      setLoadError(errorText(err, 'Could not load the message preview.'));
    }
  };

  useEffect(() => {
    if (!open || !tenantId) return;
    setPhone('');
    setPhoneConfirm('');
    setConfirmError('');
    setOptIn(false);
    setPhoneError('');
    setSendError('');
    setSent(null);
    load();
  }, [open, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    const problem = numberProblem(phone);
    setPhoneError(problem || '');
    if (problem) return;
    const mismatch = numberDigits(phone) !== numberDigits(phoneConfirm);
    setConfirmError(mismatch ? ERRORS.NUMBER_MISMATCH : '');
    if (mismatch) return;
    if (!optIn) return setSendError(ERRORS.OPT_IN_REQUIRED);
    setSending(true);
    setSendError('');
    try {
      const { data } = await axiosClient.post(`/admin/tenants/${tenantId}/welcome-message`, { phone: phone.trim(), phone_confirm: phoneConfirm.trim(), confirm_opt_in: true });
      setSent(data);
      toast.success(`Sign-in details sent to ${data.to}`);
      onSent?.(data);
    } catch (err) {
      const text = errorText(err, 'The message could not be sent. Try again.');
      if (err.response?.data?.code === 'BAD_NUMBER') setPhoneError(text);
      else if (err.response?.data?.code === 'NUMBER_MISMATCH') setConfirmError(text);
      else setSendError(text);
      if (err.response?.status === 403 && err.response.data?.code) load();
      if (err.response?.status === 429 || err.response?.status === 502) load();
    } finally {
      setSending(false);
    }
  };

  const blocked = info && (!info.template.ok || !info.owner || !info.owner.active || info.workspace.status === 'suspended' || info.rate.remaining === 0 || !info.can_send);
  const blockReason = info && (
    !info.owner ? 'This workspace has no owner login yet.'
      : !info.owner.active ? 'The owner login is deactivated. Reactivate it first.'
        : info.workspace.status === 'suspended' ? 'This workspace is suspended. Reinstate it before sending sign-in details.'
          : !info.can_send ? info.blocked_message
          : !info.template.ok ? info.template.message
            : info.rate.remaining === 0 ? ERRORS.RATE_LIMITED : null);

  let body;
  if (loadError) {
    body = (
      <Alert variant="destructive"><FiAlertTriangle /><div><AlertDescription>{loadError}</AlertDescription>
        <Button size="sm" variant="outline" className="mt-2" onClick={load}>Try again</Button></div></Alert>
    );
  } else if (!info) {
    body = <div className="flex flex-col gap-3"><Skeleton className="h-10" /><Skeleton className="h-32" /></div>;
  } else if (sent) {
    body = (
      <div className="py-2 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-green-50 text-green-600"><FiCheckCircle size={26} /></div>
        <div className="font-bold">Sent to {sent.to}</div>
        <div className="mt-1 text-[13px] text-muted-foreground">
          The link works once and expires {new Date(sent.expires_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
          The reply, if any, shows in WhatsApp Chat.
        </div>
      </div>
    );
  } else {
    body = (
      <form id="send-to-client" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {blockReason && (
          <Alert variant="destructive"><FiAlertTriangle /><div>
            <AlertTitle>Cannot send yet</AlertTitle><AlertDescription>{blockReason}</AlertDescription>
          </div></Alert>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-[13px] sm:grid-cols-2">
          <div className="min-w-0"><div className="text-[11px] font-semibold text-muted-foreground uppercase">Owner</div><div className="truncate font-medium">{info.owner?.name || '—'}</div></div>
          <div className="min-w-0"><div className="text-[11px] font-semibold text-muted-foreground uppercase">Login email</div><div className="truncate font-medium">{info.owner?.email || '—'}</div></div>
        </div>
        {info.owner?.signed_in && info.can_send && (
          <p className="text-xs text-amber-700">
            This owner already signs in. Send this only if they asked for it: the link replaces their current password and signs them out everywhere.
            It works for {linkLife(info.link_valid_minutes)} only (the message text says 72 hours, so tell the client), and the owner gets an email that a link was sent.
          </p>
        )}

        <FormField label="Client's WhatsApp number" htmlFor="client_wa" error={phoneError}
          hint={info.suggested_number ? 'Prefilled from the workspace. Check it with the client.' : 'With country code, for example +91 98765 43210.'}>
          <IconInput id="client_wa" icon={FiPhone} inputMode="tel" placeholder="+91 98765 43210" value={phone}
            onChange={(e) => { setPhone(e.target.value); setPhoneError(''); setConfirmError(''); }} disabled={sending || blocked} />
        </FormField>
        <FormField label="Type the number again" htmlFor="client_wa_confirm" error={confirmError}
          hint="The link goes to this number, so check every digit.">
          <IconInput id="client_wa_confirm" icon={FiPhone} inputMode="tel" placeholder="+91 98765 43210" value={phoneConfirm} autoComplete="off"
            onChange={(e) => { setPhoneConfirm(e.target.value); setConfirmError(''); }} onPaste={(e) => e.preventDefault()} disabled={sending || blocked} />
        </FormField>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12.5px] font-semibold">
            <span>Message preview</span>
            <span className="font-normal text-muted-foreground">Template {info.template.name} ({info.template.language})</span>
          </div>
          {info.preview_text ? (
            <div className="rounded-lg border border-[#d9fdd3] bg-[#f0fdf4] p-3 text-[13px] whitespace-pre-wrap">{info.preview_text}</div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">The preview shows once the template is approved.</div>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <FiLock className="shrink-0" /> The password is never sent. A new one-time link, valid {linkLife(info.link_valid_minutes)}, is created when you click Send; any older link stops working.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={optIn} onChange={(e) => { setOptIn(e.target.checked); setSendError(''); }} disabled={sending} />
          <span>The client agreed to get their sign-in details from Getnera on this WhatsApp number.</span>
        </label>

        {sendError && <p className="text-sm text-destructive" role="alert">{sendError}</p>}
        <p className="text-xs text-muted-foreground">{info.rate.remaining} of {info.rate.limit} sends left this hour for this workspace.</p>
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !sending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FaWhatsapp className="text-[#25D366]" /> Send to client</DialogTitle>
          <DialogDescription>
            {info ? `Send ${info.workspace.name}'s owner what they need to start: a set-password link and where to sign in.` : 'Send the owner what they need to start on WhatsApp.'}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          {sent ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
              <Button type="submit" form="send-to-client" disabled={!info || blocked || sending}>
                {sending ? <Spinner /> : <FaWhatsapp />} Send on WhatsApp
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendToClientDialog;
