const db = require('../db/connection');

const LEADOS_BRAND_NAME = 'ABM Groups';
let cachedBrand = null;

async function getLeadOSBrand(queryable = db) {
  if (cachedBrand) return cachedBrand;
  const { rows } = await queryable.query(
    `SELECT id, name FROM clients
     WHERE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = 'abmgroups'
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id LIMIT 1`
  );
  if (!rows[0]) throw new Error(`Required LeadOS brand "${LEADOS_BRAND_NAME}" is not configured`);
  cachedBrand = rows[0];
  return cachedBrand;
}

module.exports = { LEADOS_BRAND_NAME, getLeadOSBrand };
