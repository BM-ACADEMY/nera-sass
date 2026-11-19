/**
 * Fixed customer-facing sentences of the order flow, in English and Tamil.
 * The server writes these (not the model) so a customer is only ever told
 * "order placed" when an order row exists, and every amount shown is the
 * server's own total from the saved price list. Pure: no database.
 */
const LANGS = ['en', 'ta'];

const rupees = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number(paise) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const lines = (items) => items.map((i) => `${i.quantity} x ${i.name} = ${rupees(i.unit_paise * i.quantity)}`).join('\n');
const menu = (products) => products.slice(0, 15).map((p) => `${p.name}: ${rupees(p.price_paise)}`).join('\n');

const TEXT = {
  askItems: {
    en: ({ products }) => `Happy to help you order. What would you like?\n${menu(products)}`,
    ta: ({ products }) => `ஆர்டர் செய்ய உதவுகிறேன். என்ன வேண்டும்?\n${menu(products)}`,
  },
  unknownItem: {
    en: ({ said, products }) => `Sorry, I could not find "${said}". We have:\n${menu(products)}`,
    ta: ({ said, products }) => `மன்னிக்கவும், "${said}" கிடைக்கவில்லை. எங்களிடம் உள்ளவை:\n${menu(products)}`,
  },
  askName: {
    en: () => 'May I have your name for the order?',
    ta: () => 'ஆர்டருக்கு உங்கள் பெயரைச் சொல்ல முடியுமா?',
  },
  confirmAsk: {
    en: ({ name, items, total }) => `Please confirm your order, ${name}:\n${lines(items)}\nTotal: ${rupees(total)}\nReply yes to place it.`,
    ta: ({ name, items, total }) => `${name}, உங்கள் ஆர்டரை உறுதிப்படுத்தவும்:\n${lines(items)}\nமொத்தம்: ${rupees(total)}\nஆர்டர் செய்ய "ஆம்" என்று பதிலளிக்கவும்.`,
  },
  placedWithPayment: {
    en: ({ orderNo, total, payment }) => `Your order #${orderNo} is placed. Total: ${rupees(total)}.\nTo pay: ${payment}\nWe will confirm once the payment is received.`,
    ta: ({ orderNo, total, payment }) => `உங்கள் ஆர்டர் #${orderNo} பதிவு செய்யப்பட்டது. மொத்தம்: ${rupees(total)}.\nபணம் செலுத்த: ${payment}\nபணம் கிடைத்ததும் உறுதிப்படுத்துவோம்.`,
  },
  placedNoPayment: {
    en: ({ orderNo, total }) => `Your order #${orderNo} is placed. Total: ${rupees(total)}. Our team will share the payment details with you shortly.`,
    ta: ({ orderNo, total }) => `உங்கள் ஆர்டர் #${orderNo} பதிவு செய்யப்பட்டது. மொத்தம்: ${rupees(total)}. பணம் செலுத்தும் விவரங்களை எங்கள் குழு விரைவில் பகிரும்.`,
  },
  cancelled: {
    en: ({ orderNo }) => `Your order #${orderNo} has been cancelled.`,
    ta: ({ orderNo }) => `உங்கள் ஆர்டர் #${orderNo} ரத்து செய்யப்பட்டது.`,
  },
  nothingToCancel: {
    en: () => 'You have no open order to cancel.',
    ta: () => 'ரத்து செய்ய திறந்த ஆர்டர் எதுவும் இல்லை.',
  },
  tooLarge: {
    en: () => 'That order is too large for me to take here. Our team will help you directly.',
    ta: () => 'இந்த ஆர்டர் மிகப் பெரியது. எங்கள் குழு உங்களுக்கு நேரடியாக உதவும்.',
  },
  orderError: {
    en: () => 'Sorry, I could not place the order just now. Our team will contact you.',
    ta: () => 'மன்னிக்கவும், இப்போது ஆர்டரைப் பதிவு செய்ய முடியவில்லை. எங்கள் குழு உங்களைத் தொடர்பு கொள்ளும்.',
  },
};

function say(key, lang, vars = {}) {
  const entry = TEXT[key];
  if (!entry) throw new Error(`Unknown order text: ${key}`);
  return entry[LANGS.includes(lang) ? lang : 'en'](vars);
}

module.exports = { LANGS, TEXT, say, rupees };
