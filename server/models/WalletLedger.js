const { defineModel, Mixed } = require('../db/mongo');
const { TenantContextError } = require('../services/tenantContext');

class LedgerImmutableError extends Error {
  constructor(op) {
    super(`wallet_ledger is append-only: ${op} is not allowed`);
    this.name = 'LedgerImmutableError';
    this.status = 500;
  }
}

const FORBIDDEN_QUERY_OPS = [
  'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];

// Nothing in the application may update or delete a ledger row: the balance
// is the sum of the rows, and a correction is a new row (reason 'adjustment').
function appendOnly(schema) {
  for (const op of FORBIDDEN_QUERY_OPS) {
    schema.pre(op, function forbid() { throw new LedgerImmutableError(op); });
  }
  schema.pre('save', function forbidResave() {
    if (!this.isNew) throw new LedgerImmutableError('save of an existing row');
  });
  schema.pre('deleteOne', { document: true, query: false }, function forbidDocDelete() {
    throw new LedgerImmutableError('deleteOne');
  });
  schema.pre('bulkWrite', function forbidBulk() { throw new LedgerImmutableError('bulkWrite'); });
}

// Wallet money movements, in paise. signed_paise is +amount for a credit and
// -amount for a debit, so the balance is a plain sum. The unique key makes a
// movement for one reference (a Razorpay payment id, an AI reply) happen once.
const WalletLedger = defineModel('wallet_ledger', {
  id: { type: Number },
  direction: { type: String }, // credit | debit
  amount_paise: { type: Number },
  signed_paise: { type: Number },
  currency: { type: String, default: 'INR' },
  // topup | ai_overage | extra_seat | extra_number | adjustment | refund
  reason: { type: String },
  reference_type: { type: String, default: null },
  reference_id: { type: String, default: null },
  description: { type: String, default: '' },
  created_by: { type: Number, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, {
  autoId: true,
  unique: [['tenant_id', 'reference_type', 'reference_id']],
  indexes: [['tenant_id', 'created_at']],
  configure: appendOnly,
});

WalletLedger.LedgerImmutableError = LedgerImmutableError;
module.exports = WalletLedger;
