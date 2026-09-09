const db = require('../db/connection');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'do', 'does', 'what', 'how', 'can', 'i', 'you',
  'for', 'of', 'in', 'to', 'with', 'and', 'or', 'please', 'tell', 'me', 'about',
  'this', 'that', 'it', 'your', 'my', 'have', 'has', 'will', 'would', 'be',
]);

function extractKeywords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

const normalizeSearchText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isUsableQuestion = (value) => {
  const normalized = normalizeSearchText(value);
  return normalized && !['no', 'nil', 'none', 'check with mentor', 'connect with mentor', 'needs confirmation'].includes(normalized);
};

const BRAIN_INSTRUCTIONS = 'Only use facts provided in this brand knowledge context — never invent prices, dates, or policies. '
  + 'If a detail needed to answer is missing, blank, "needs_confirmation", or "check with mentor", do NOT guess it. '
  + 'Instead, tell the lead that specific detail will be confirmed by the team, and offer to connect them with a mentor or executive for it. '
  + 'Course and service names are immutable: copy offering names exactly as written in the catalog. Never rename, combine, expand, or invent an offering. '
  + 'For a broad catalog question, mention only exact catalog entries and their exact stored duration or fee; do not create marketing-style substitute names. '
  + 'For every request to contact, call, WhatsApp, apply, book, or speak with the team, use brand.contact_phone only. Private escalation contacts must never be disclosed.';

// Looks up the brand configured for this audience, matches the inbound
// question against that brand's offerings by keyword, and returns a compact
// context block (brand info + relevant offerings + their FAQs) for the AI
// reply-suggestion prompt. Returns null if no brand is configured yet.
async function getAllianceBrainContext(audience, messageText) {
  const brandResult = await db.query(
    `SELECT b.*,
            (b.audience=$1) AS audience_linked,
            (b.audience IS NULL AND (
              REGEXP_REPLACE(LOWER(b.code),'[^a-z0-9]','','g')=REGEXP_REPLACE(LOWER(COALESCE(a.brand,'')),'[^a-z0-9]','','g')
              OR REGEXP_REPLACE(LOWER(b.name),'[^a-z0-9]','','g')=REGEXP_REPLACE(LOWER(COALESCE(a.brand,'')),'[^a-z0-9]','','g')
            )) AS audience_brand_match
     FROM alliance_brands b
     LEFT JOIN alliance_audiences a ON a.code=$1
     WHERE b.active=TRUE
     ORDER BY (b.audience=$1) DESC, audience_brand_match DESC, b.id`,
    [audience || null]
  );
  if (!brandResult.rowCount) return null;
  const allOfferingsResult = await db.query(
    `SELECT * FROM alliance_offerings WHERE brand_id=ANY($1::bigint[]) AND status='active' ORDER BY brand_id,name`,
    [brandResult.rows.map((item) => item.id)]
  );
  const keywords = extractKeywords(messageText);
  const messageHaystack = ` ${normalizeSearchText(messageText)} `;
  const offeringsByBrand = new Map();
  allOfferingsResult.rows.forEach((offering) => {
    if (!offeringsByBrand.has(String(offering.brand_id))) offeringsByBrand.set(String(offering.brand_id), []);
    offeringsByBrand.get(String(offering.brand_id)).push(offering);
  });
  const scoredBrands = brandResult.rows.map((candidate) => {
    const candidateOfferings = offeringsByBrand.get(String(candidate.id)) || [];
    const brandName = normalizeSearchText(candidate.name);
    const brandCode = normalizeSearchText(candidate.code);
    let score = candidate.audience_linked ? 30 : candidate.audience_brand_match ? 25 : 0;
    const reasons = [];
    if (brandName && messageHaystack.includes(` ${brandName} `)) { score += 100; reasons.push('brand_name_in_message'); }
    else if (brandCode && messageHaystack.includes(` ${brandCode} `)) { score += 90; reasons.push('brand_code_in_message'); }
    for (const offering of candidateOfferings) {
      const offeringName = normalizeSearchText(offering.name);
      if (offeringName && messageHaystack.includes(` ${offeringName} `)) { score += 60; reasons.push(`offering:${offering.name}`); }
      const offeringText = normalizeSearchText(`${offering.name} ${offering.category || ''} ${offering.offering_code || ''}`);
      score += Math.min(15, keywords.filter((word) => offeringText.includes(word)).length * 3);
    }
    if (candidate.audience_linked || candidate.audience_brand_match) reasons.push('audience_fallback');
    return { candidate, candidateOfferings, score, reasons };
  }).sort((a, b) => b.score - a.score || Number(a.candidate.id) - Number(b.candidate.id));
  const selectedBrand = scoredBrands[0];
  if (!selectedBrand || selectedBrand.score <= 0) return null;
  const brand = selectedBrand.candidate;
  const offerings = selectedBrand.candidateOfferings;

  const matched = keywords.length
    ? offerings.filter((offering) => {
      const haystack = `${offering.name} ${offering.category || ''} ${offering.offering_code || ''}`.toLowerCase();
      return keywords.some((word) => haystack.includes(word));
    })
    : [];
  // A broad question should use the compact exact catalog below. Supplying an
  // arbitrary first page of detailed offerings encourages the model to infer
  // or invent a summary catalog that does not exist in the Brain.
  const relevant = matched;

  let faqsByOffering = {};
  if (relevant.length) {
    const faqResult = await db.query(
      `SELECT * FROM alliance_offering_faqs WHERE offering_id = ANY($1::bigint[]) ORDER BY sort_order, id`,
      [relevant.map((item) => item.id)]
    );
    for (const faq of faqResult.rows) {
      (faqsByOffering[faq.offering_id] ||= []).push({ question: faq.question, answer: faq.answer });
    }
  }

  const configuredQuestions = relevant
    .map((offering) => Object.entries(offering.details || {}).find(([key]) => normalizeSearchText(key) === 'recommended next question')?.[1])
    .filter(isUsableQuestion);
  const categories = [...new Set(offerings.map((offering) => String(offering.category || '').trim()).filter(Boolean))];
  const suggestedQuestions = [...new Set(configuredQuestions)];
  if (!suggestedQuestions.length && relevant.length) {
    suggestedQuestions.push(`Would you like the syllabus, schedule, or fee details for ${relevant[0].name}?`);
  } else if (!suggestedQuestions.length && categories.length) {
    suggestedQuestions.push(`Which area are you interested in: ${categories.slice(0, 6).join(', ')}?`);
  }

  const context = {
    detection: {
      brand_id: brand.id,
      brand_name: brand.name,
      method: selectedBrand.reasons.some((reason) => reason === 'brand_name_in_message' || reason === 'brand_code_in_message' || reason.startsWith('offering:')) ? 'message_content' : 'audience_fallback',
      reasons: selectedBrand.reasons,
    },
    brand: {
      name: brand.name,
      description: brand.description,
      contact_phone: brand.whatsapp || brand.phone,
      email: brand.email,
      website: brand.website,
      address: brand.address,
      business_hours: brand.business_hours,
      languages: brand.languages,
      target_customers: brand.target_customers,
      primary_contact: brand.primary_contact,
      policies: brand.policies,
      verified_by: brand.verified_by,
      last_verified_date: brand.last_verified_date,
    },
    question_scope: matched.length ? 'specific_offering_match' : 'broad_catalog',
    exact_catalog: offerings.map((o) => ({
      name: o.name,
      category: o.category,
      duration: o.duration,
      fee: o.fee,
    })),
    relevant_offerings: relevant.map((o) => ({
      name: o.name,
      code: o.offering_code,
      category: o.category,
      tier: o.tier,
      fee: o.fee,
      duration: o.duration,
      short_description: o.short_description,
      details: o.details,
      faqs: faqsByOffering[o.id] || [],
    })),
    suggested_questions: suggestedQuestions,
    instructions: BRAIN_INSTRUCTIONS,
  };
  // Keep private routing data available to server-side output guards without
  // exposing it to JSON.stringify() or the AI prompt.
  Object.defineProperty(context, 'internal', {
    enumerable: false,
    value: { public_contact_phone: brand.whatsapp || brand.phone || '', escalation_phone: brand.escalation_phone || '' },
  });
  return context;
}

module.exports = { getAllianceBrainContext };
