/**
 * Campaign template helpers: variable numbering, parameter mappings and how a
 * queued campaign row becomes a Graph API template payload. Shared by the
 * campaign routes (validation) and the send queue (sending).
 */

function getTemplateVariableNumbers(value) {
  const numbers = [...String(value || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function validateCampaignTemplate(template) {
  const bodyVariables = getTemplateVariableNumbers(template.body);
  const headerVariables = getTemplateVariableNumbers(template.header);
  const expectedBodyVariables = bodyVariables.length
    ? Array.from({ length: bodyVariables.at(-1) }, (_, index) => index + 1)
    : [];

  if (bodyVariables.some((value, index) => value !== expectedBodyVariables[index])) {
    return 'Template body variables must be consecutive and start at {{1}}.';
  }
  if (headerVariables.some((value, index) => value !== index + 1)) {
    return 'Template header variables must be consecutive and start at {{1}}.';
  }
  return null;
}

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : (value || {}));

function resolveCampaignParameter(mapping, msg) {
  const source = mapping?.source;
  if (source === 'recipient_name') return String(msg.name || 'Friend');
  if (source === 'recipient_phone') return String(msg.phone || '');
  if (source === 'campaign_name') return String(msg.campaign_name || '');
  if (source === 'brand_name') return String(msg.brand_name || '');
  if (source === 'custom') return String(mapping?.value || '');
  if (['recipient_email', 'lead_status', 'lead_source', 'lead_interest', 'lead_score'].includes(source)) {
    const data = parseJson(msg.recipient_data);
    return String(data[source] ?? '');
  }
  if (source === 'excel_parameter') {
    const values = parseJson(msg.recipient_parameters);
    return String(values?.[mapping.section || 'body']?.[String(mapping.number)] || '');
  }
  return '';
}

const MAPPING_SOURCES = ['recipient_name', 'recipient_phone', 'recipient_email', 'lead_status', 'lead_source', 'lead_interest', 'lead_score', 'campaign_name', 'brand_name', 'custom', 'excel_parameter'];

function validateCampaignParameterMappings(template, mappings) {
  for (const [section, content] of [['body', template.body], ['header', template.header]]) {
    for (const number of getTemplateVariableNumbers(content)) {
      const mapping = mappings?.[section]?.[String(number)];
      if (!mapping || !MAPPING_SOURCES.includes(mapping.source)) {
        return `Choose a value for ${section} parameter {{${number}}}.`;
      }
      if (mapping.source === 'custom' && !String(mapping.value || '').trim()) {
        return `Enter a custom value for ${section} parameter {{${number}}}.`;
      }
    }
  }
  return null;
}

/** The Graph API `template` object for a queued campaign row. */
function campaignTemplatePayload(msg) {
  const templatePayload = { name: msg.template_name, language: { code: msg.template_language || 'en' } };
  const bodyVariables = getTemplateVariableNumbers(msg.template_body);
  const headerVariables = getTemplateVariableNumbers(msg.template_header);
  const mappings = parseJson(msg.template_parameters);
  const components = [];
  if (headerVariables.length) {
    components.push({ type: 'header', parameters: headerVariables.map((number) => ({ type: 'text', text: resolveCampaignParameter(mappings.header?.[String(number)], msg) })) });
  }
  if (bodyVariables.length) {
    components.push({ type: 'body', parameters: bodyVariables.map((number) => ({ type: 'text', text: resolveCampaignParameter(mappings.body?.[String(number)], msg) })) });
  }
  if (components.length) templatePayload.components = components;
  return templatePayload;
}

/** The template body with every {{n}} filled in, for the inbox mirror. */
function renderCampaignBody(msg) {
  const mappings = parseJson(msg.template_parameters);
  return getTemplateVariableNumbers(msg.template_body).reduce(
    (body, number) => body.replace(new RegExp(`\\{\\{\\s*${number}\\s*\\}\\}`, 'g'), resolveCampaignParameter(mappings.body?.[String(number)], msg)),
    String(msg.template_body || ''),
  );
}

module.exports = {
  getTemplateVariableNumbers,
  validateCampaignTemplate,
  resolveCampaignParameter,
  validateCampaignParameterMappings,
  campaignTemplatePayload,
  renderCampaignBody,
};
