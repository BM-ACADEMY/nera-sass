/**
 * Turns the admin template editor's form into a Meta message template
 * (POST /{waba}/message_templates) and checks it against Meta's rules first,
 * so most mistakes are explained here instead of as a Meta error code.
 */
const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const HEADER_FORMATS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];
const BUTTON_LIMITS = { QUICK_REPLY: 10, URL: 2, PHONE_NUMBER: 1, COPY_CODE: 1 };

class TemplateError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.field = field;
  }
}

const fail = (message, field) => { throw new TemplateError(message, field); };
const str = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));

// {{1}} {{2}} … or {{customer_name}}; returns the names in order of first use.
function variablesIn(text) {
  const seen = [];
  for (const match of str(text).matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

function checkVariables(text, format, field) {
  const vars = variablesIn(text);
  if (/\{\{(?!\s*[a-z0-9_]+\s*\}\})/i.test(str(text))) fail('A variable is not closed. Use {{1}} or {{name}}.', field);
  if (format === 'NAMED') {
    if (vars.some((v) => !/^[a-z][a-z0-9_]*$/.test(v))) fail('Named variables use lowercase letters, numbers and _ and start with a letter, for example {{customer_name}}.', field);
  } else {
    if (vars.some((v) => !/^\d+$/.test(v))) fail('Number variables look like {{1}}, {{2}}. Switch "Type of variable" to Name to use words.', field);
    const nums = vars.map(Number);
    if (nums.some((n, i) => n !== i + 1)) fail('Number variables must start at {{1}} and go up in order without gaps.', field);
  }
  const trimmed = str(text).trim();
  if (vars.length && (/^\{\{[^}]+\}\}/.test(trimmed) || /\{\{[^}]+\}\}$/.test(trimmed))) {
    fail('Meta does not allow a variable at the very start or end of the text.', field);
  }
  return vars;
}

function examplesFor(vars, samples, field) {
  return vars.map((name) => {
    const value = str(samples?.[name]).trim();
    if (!value) fail(`Add a sample value for {{${name}}} so Meta can review the template.`, field);
    return value;
  });
}

function buildButtons(buttons) {
  const list = Array.isArray(buttons) ? buttons : [];
  const counts = {};
  const out = list.map((button, index) => {
    const type = str(button.type).toUpperCase();
    if (!BUTTON_LIMITS[type]) fail(`Button ${index + 1} has an unknown type.`, 'buttons');
    counts[type] = (counts[type] || 0) + 1;
    if (counts[type] > BUTTON_LIMITS[type]) fail(`At most ${BUTTON_LIMITS[type]} "${type.replace('_', ' ').toLowerCase()}" button${BUTTON_LIMITS[type] > 1 ? 's' : ''}.`, 'buttons');
    if (type === 'COPY_CODE') {
      const code = str(button.example).trim();
      if (!code || code.length > 15) fail('The offer code must be 1 to 15 characters.', 'buttons');
      return { type, example: code };
    }
    const text = str(button.text).trim();
    if (!text || text.length > 25) fail(`Button ${index + 1}: the text must be 1 to 25 characters.`, 'buttons');
    if (type === 'QUICK_REPLY') return { type, text };
    if (type === 'PHONE_NUMBER') {
      const phone = str(button.phone_number).replace(/[\s-]/g, '');
      if (!/^\+?[1-9]\d{7,14}$/.test(phone)) fail('Enter the phone number with its country code, for example +919876543210.', 'buttons');
      return { type, text, phone_number: phone.startsWith('+') ? phone : `+${phone}` };
    }
    const url = str(button.url).trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000) fail('Website buttons need a full https:// link.', 'buttons');
    const dynamic = /\{\{1\}\}$/.test(url);
    if (/\{\{/.test(url.replace(/\{\{1\}\}$/, ''))) fail('A website link may only end with {{1}}.', 'buttons');
    const result = { type, text, url };
    if (dynamic) {
      const example = str(button.example).trim();
      if (!/^https:\/\//i.test(example)) fail('Add a full sample link for the {{1}} in the website button.', 'buttons');
      result.example = [example];
    }
    return result;
  });
  if (out.length > 10) fail('At most 10 buttons.', 'buttons');
  // Meta requires quick replies to sit together.
  return [...out.filter((b) => b.type === 'QUICK_REPLY'), ...out.filter((b) => b.type !== 'QUICK_REPLY')];
}

/** Validates the editor form and returns the Meta create-template payload. */
function buildTemplate(input = {}) {
  const name = str(input.name).trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) fail('Template name: use lowercase letters, numbers and _ only (no spaces).', 'name');
  const language = str(input.language || 'en').trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) fail('Choose a language.', 'language');
  const category = str(input.category).toUpperCase();
  if (!CATEGORIES.includes(category)) fail('Choose Marketing, Utility or Authentication.', 'category');

  if (category === 'AUTHENTICATION') {
    const body = { type: 'BODY', add_security_recommendation: Boolean(input.add_security_recommendation) };
    const components = [body];
    const minutes = input.code_expiration_minutes;
    if (minutes !== undefined && minutes !== null && minutes !== '') {
      const n = Number(minutes);
      if (!Number.isInteger(n) || n < 1 || n > 90) fail('Code expiry must be 1 to 90 minutes.', 'code_expiration_minutes');
      components.push({ type: 'FOOTER', code_expiration_minutes: n });
    }
    const copyText = str(input.copy_code_text || 'Copy code').trim().slice(0, 25);
    components.push({ type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: copyText }] });
    return { name, language, category, components };
  }

  const parameterFormat = str(input.variable_type).toLowerCase() === 'name' ? 'NAMED' : 'POSITIONAL';
  const samples = input.samples || {};
  const components = [];

  const headerFormat = str(input.header_format || 'NONE').toUpperCase();
  if (!HEADER_FORMATS.includes(headerFormat)) fail('Unknown header type.', 'header');
  if (headerFormat === 'TEXT') {
    const text = str(input.header_text).trim();
    if (!text || text.length > 60) fail('Header text must be 1 to 60 characters.', 'header');
    const vars = checkVariables(text, parameterFormat, 'header');
    if (vars.length > 1) fail('The header can have only one variable.', 'header');
    const header = { type: 'HEADER', format: 'TEXT', text };
    if (vars.length) {
      const [value] = examplesFor(vars, samples, 'header');
      header.example = parameterFormat === 'NAMED'
        ? { header_text_named_params: [{ param_name: vars[0], example: value }] }
        : { header_text: [value] };
    }
    components.push(header);
  } else if (headerFormat !== 'NONE') {
    const handle = str(input.header_handle).trim();
    if (!handle) fail(`Upload a sample ${headerFormat.toLowerCase()} for the header.`, 'header');
    components.push({ type: 'HEADER', format: headerFormat, example: { header_handle: [handle] } });
  }

  const bodyText = str(input.body);
  if (!bodyText.trim()) fail('The body is required.', 'body');
  if (bodyText.length > 1024) fail('The body can be at most 1024 characters.', 'body');
  const bodyVars = checkVariables(bodyText, parameterFormat, 'body');
  const body = { type: 'BODY', text: bodyText };
  if (bodyVars.length) {
    const values = examplesFor(bodyVars, samples, 'body');
    body.example = parameterFormat === 'NAMED'
      ? { body_text_named_params: bodyVars.map((param_name, i) => ({ param_name, example: values[i] })) }
      : { body_text: [values] };
  }
  components.push(body);

  const footer = str(input.footer).trim();
  if (footer) {
    if (footer.length > 60) fail('The footer can be at most 60 characters.', 'footer');
    if (variablesIn(footer).length) fail('The footer cannot have variables.', 'footer');
    components.push({ type: 'FOOTER', text: footer });
  }

  const buttons = buildButtons(input.buttons);
  if (buttons.length) components.push({ type: 'BUTTONS', buttons });

  const payload = { name, language, category, components };
  if (parameterFormat === 'NAMED') payload.parameter_format = 'NAMED';
  return payload;
}

module.exports = { buildTemplate, variablesIn, TemplateError, CATEGORIES };
