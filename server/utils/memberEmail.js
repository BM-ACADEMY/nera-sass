/**
 * The emails a person gets when they are added to a customer workspace
 * (services/notify.js sends them):
 *   method 'password'  the login exists with a temporary password. The password
 *                      is never in the email; whoever added them shares it.
 *   method 'invite'    a one-time link to choose their own password.
 * Every value that a user typed (names, workspace, email) is flattened to one
 * line and HTML-escaped; the subject carries no control characters.
 */
const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent' };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One line of plain text: no line breaks (header or body injection), no
// invisible direction overrides, and not longer than `max`.
function oneLine(value, max = 80) {
  const text = String(value ?? '')
    .replace(/(?:[^\P{Cf}\p{Join_Control}]|[\p{Cc}\p{Zl}\p{Zp}])+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Table layout with inline styles, so it holds up in Gmail, Outlook and phones.
// Takes plain text everywhere and escapes it here.
function render({ product, preheader, heading, greeting, intro, details, stepsTitle, steps, note, button, footer }) {
  const rows = details.map(([label, value], i) => `<tr>
<td style="padding:9px 16px;${i ? 'border-top:1px solid #e2e8f0;' : ''}word-break:break-word">
<div style="font-size:12px;line-height:17px;color:#64748b">${escapeHtml(label)}</div>
<div style="font-size:14px;line-height:21px;color:#0f172a;font-weight:600">${escapeHtml(value)}</div>
</td>
</tr>`).join('');
  const list = steps.map((step, i) => `<tr>
<td width="34" style="padding:0 0 12px;vertical-align:top"><div style="width:24px;height:24px;line-height:24px;border-radius:12px;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:700;text-align:center">${i + 1}</div></td>
<td style="padding:2px 0 12px;font-size:14px;line-height:20px;color:#334155;word-break:break-word">${escapeHtml(step)}</td>
</tr>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;${FONT}">
<tr><td style="background:#2563eb;background-image:linear-gradient(90deg,#2563eb,#4f46e5);padding:24px 28px">
<div style="font-size:15px;font-weight:800;color:#ffffff;margin-bottom:14px">${escapeHtml(product)}</div>
<h1 style="margin:0;font-size:22px;line-height:29px;color:#ffffff;word-break:break-word">${escapeHtml(heading)}</h1>
</td></tr>
<tr><td style="padding:26px 28px 8px">
<p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#1e293b;word-break:break-word">${escapeHtml(greeting)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:#1e293b;word-break:break-word">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;margin:0 0 24px">${rows}</table>
<div style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 14px">${escapeHtml(stepsTitle)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list}</table>
${note ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin:4px 0 20px;font-size:13px;line-height:20px;color:#92400e;word-break:break-word">${escapeHtml(note)}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:#2563eb">
<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>
</td></tr></table>
<p style="margin:0 0 18px;font-size:12px;line-height:18px;color:#64748b">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(button.url)}" style="color:#2563eb;word-break:break-all">${escapeHtml(button.url)}</a></p>
</td></tr>
<tr><td style="border-top:1px solid #e2e8f0;padding:16px 28px 22px;font-size:12px;line-height:18px;color:#94a3b8;word-break:break-word">${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    greeting,
    intro,
    details.map(([label, value]) => `${label}: ${value}`).join('\n'),
    `${stepsTitle}\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    note,
    `${button.label}:\n${button.url}`,
    footer,
  ].filter(Boolean).join('\n\n');
  return { html, text: `${text}\n` };
}

/**
 * { method: 'password' | 'invite', product, to, name, workspaceName,
 *   inviterName, role, url, expiresAt? } -> { subject, text, html }
 * `url` is the sign-in page ('password') or the one-time invitation link.
 */
function memberEmail({ method, product, to, name, workspaceName, inviterName, role, url, expiresAt }) {
  const invite = method === 'invite';
  const person = oneLine(name) || 'there';
  const workspace = oneLine(workspaceName) || 'your team';
  const inviter = oneLine(inviterName) || 'An administrator';
  const sharer = oneLine(inviterName) || 'your administrator';
  const roleName = ROLE_NAMES[role] || oneLine(role, 30);
  const email = oneLine(to, 254);
  const heading = invite ? `You're invited to ${workspace}` : `You've been added to ${workspace}`;
  const subject = `${invite ? `You're invited to ${oneLine(workspace, 60)}` : `You've been added to ${oneLine(workspace, 60)}`} on ${product}`;
  const { html, text } = render({
    product,
    preheader: `${inviter} ${invite ? 'invited you to join' : 'added you to'} ${workspace} on ${product}.`,
    heading,
    greeting: `Hi ${person},`,
    intro: invite
      ? `${inviter} invited you to join the ${workspace} workspace on ${product}.`
      : `${inviter} added you to the ${workspace} workspace on ${product}. Your login is ready.`,
    details: [
      ['Workspace', workspace],
      [invite ? 'Invited by' : 'Added by', inviter],
      ['Your role', roleName],
      ['Sign-in email', email],
    ],
    stepsTitle: 'How to sign in',
    steps: invite
      ? [
        'Open your invitation with the button below.',
        'Choose your own password.',
        `Sign in to ${product} with ${email} and that password.`,
      ]
      : [
        'Open the sign-in page with the button below.',
        `Enter ${email} and the temporary password that ${sharer} will share with you.`,
        'Choose your own password. You must change the temporary one at your first sign-in before you can use the workspace.',
      ],
    note: invite
      ? `The link works once and expires on ${new Date(expiresAt).toUTCString()}.`
      : `For your safety the password is not in this email. Ask ${sharer} for it.`,
    button: { url, label: invite ? 'Accept invitation' : `Sign in to ${product}` },
    footer: `You received this email because ${inviter} ${invite ? 'invited this address to' : 'created a login for this address in'} the ${workspace} workspace. If you did not expect it, ${invite ? 'you can ignore this email' : 'contact them before signing in'}.`,
  });
  return { subject, text, html };
}

module.exports = { memberEmail, oneLine };
