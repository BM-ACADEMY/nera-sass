const { Clients } = require('../models');

const LEADOS_BRAND_NAME = 'ABM Groups';
let cachedBrand = null;

async function getLeadOSBrand() {
  if (cachedBrand) return cachedBrand;
  // Matches "ABM Groups" ignoring case, spaces and punctuation.
  const candidates = await Clients.find({ name: /a\W*b\W*m\W*g\W*r\W*o\W*u\W*p\W*s/i }, { _id: 0, id: 1, name: 1, status: 1 }).lean();
  const [brand] = candidates
    .filter((client) => String(client.name || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === 'abmgroups')
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.id - b.id);
  if (!brand) throw new Error(`Required LeadOS brand "${LEADOS_BRAND_NAME}" is not configured`);
  cachedBrand = { id: brand.id, name: brand.name };
  return cachedBrand;
}

module.exports = { LEADOS_BRAND_NAME, getLeadOSBrand };
