const { defineModel } = require('../db/mongo');
const { encryptToken, decryptToken } = require('../services/clientSecrets');

const READ_OPS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'];
const UPDATE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany'];

// A query that selects wa_access_token also needs the ciphertext to decrypt it.
function includeCiphertext() {
  const projection = this.projection();
  if (projection && projection.wa_access_token === 1) this.projection({ ...projection, wa_access_token_enc: 1 });
}

// Decrypts the token into memory for server code; the ciphertext never leaves the model.
function decryptResults(result) {
  for (const doc of Array.isArray(result) ? result : [result]) {
    if (!doc || typeof doc !== 'object') continue;
    const target = doc._doc || doc;
    if (target.wa_access_token_enc) target.wa_access_token = decryptToken(target.wa_access_token_enc);
    delete target.wa_access_token_enc;
  }
}

// Writes go to the encrypted column; the plain-text column is cleared.
function encryptUpdate() {
  const update = this.getUpdate();
  if (!update || Array.isArray(update)) return;
  const has = (obj) => Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, 'wa_access_token');
  const set = update.$set || {};
  if (!has(set) && !has(update)) return;
  const token = has(set) ? set.wa_access_token : update.wa_access_token;
  delete set.wa_access_token;
  delete update.wa_access_token;
  const encrypted = encryptToken(token);
  update.$unset = { ...(update.$unset || {}), wa_access_token: '' };
  if (encrypted) {
    update.$set = { ...set, ...encrypted };
  } else {
    update.$set = set;
    Object.assign(update.$unset, { wa_access_token_enc: '', wa_token_last4: '' });
  }
}

function encryptOnSave() {
  if (this.wa_access_token && (this.isNew || this.isModified('wa_access_token'))) {
    Object.assign(this, encryptToken(this.wa_access_token));
    this.wa_access_token = undefined;
  }
}

// A customer's brand profile and WhatsApp connection. Exactly one per tenant.
module.exports = defineModel('clients', {
  id: { type: Number },
  name: { type: String },
  type: { type: String },
  plan: { type: String, default: "Starter" },
  status: { type: String, default: "active" },
  phone_number_id: { type: String },
  // Plain-text column kept for legacy rows only: Nera writes the token to
  // wa_access_token_enc and never returns either column (plan S8).
  wa_access_token: { type: String },
  wa_access_token_enc: { type: String },
  wa_token_last4: { type: String },
  wa_business_id: { type: String },
  whatsapp_number: { type: String },
  monthly_revenue: { type: Number, default: 0 },
  joined_at: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  city: { type: String },
  phone: { type: String },
  contact_person: { type: String },
  agreed_price: { type: Number, default: 0 },
  start_date: { type: Date },
  gmb_url: { type: String },
  google_email: { type: String },
  oauth_status: { type: String, default: "Not Connected" },
  oauth_connected_at: { type: Date },
  access_token: { type: String },
  refresh_token: { type: String },
  wa_category: { type: String, default: "OTHER" },
  wa_description: { type: String },
  wa_address: { type: String },
  wa_email: { type: String },
  wa_website: { type: String },
  place_id: { type: String },
  whatsapp_status: { type: String, default: "not_configured" },
  whatsapp_verified_at: { type: Date },
  whatsapp_verification_error: { type: String },
  brand_tag: { type: String },
  brand_voice: { type: String },
  industry: { type: String },
  target_audience: { type: String },
}, {
  autoId: true,
  unique: [['tenant_id']], // one brand per tenant (Full Scope decision 2)
  configure(schema) {
    schema.pre(READ_OPS, includeCiphertext);
    schema.post(READ_OPS, decryptResults);
    schema.pre(UPDATE_OPS, encryptUpdate);
    schema.pre('save', encryptOnSave);
  },
});
