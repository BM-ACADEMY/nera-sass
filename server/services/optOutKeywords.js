/**
 * STOP / unsubscribe detection for inbound WhatsApp messages, in English and
 * Tamil (script and common Latin transliterations).
 *
 * A message opts the contact out when, after normalising case, punctuation
 * and emoji, it either
 *   - equals one of the exact keywords (STOP, UNSUBSCRIBE, நிறுத்து, ...), or
 *   - is short (a few words) and contains one of the phrases ("stop sending
 *     me messages", "மெசேஜ் அனுப்ப வேண்டாம்", "message vendam").
 * Long messages are never treated as opt-outs: "please don't stop the class"
 * is a question for a person, not an unsubscribe.
 *
 * Opt back in only on an exact keyword (START, UNSTOP, தொடங்கு, ...).
 */

const SHORT_MESSAGE_WORDS = 8;

// Whole-message matches (after normalisation).
const EXACT_OPT_OUT = {
  en: [
    'stop', 'stopall', 'stop all', 'unsubscribe', 'unsub', 'cancel', 'end', 'quit',
    'opt out', 'optout', 'remove', 'remove me', 'no more messages', 'stop messages',
    'stop messaging', 'stop texting', 'dont message me', 'do not message me',
    'dont message', 'do not message', 'leave me alone', 'not interested stop',
  ],
  ta: [
    // நிறுத்து = stop (imperative, polite forms, colloquial spellings)
    'நிறுத்து', 'நிறுத்துங்க', 'நிறுத்துங்கள்', 'நிறுத்தவும்', 'நிறுத்திடுங்க', 'நிறுத்திடுங்கள்',
    'நிறுத்திவிடுங்கள்', 'நிறுத்திவிடு', 'நிறுத்திடு',
    // வேண்டாம் = don't want / no more
    'வேண்டாம்', 'வேணாம்', 'வேண்டவே வேண்டாம்',
    // ரத்து = cancel; விலகு = leave / unsubscribe
    'ரத்து', 'ரத்து செய்', 'விலகு', 'விலக',
    // Latin transliterations
    'niruthu', 'nirutthu', 'niruthunga', 'nirutunga', 'niruthungal', 'nirutthungal', 'niruthuga',
    'niruthidunga', 'niruthividunga', 'vendam', 'vendaam', 'venam', 'venda', 'vendaam', 'veandam',
    'rathu', 'rathu sei', 'vilagu',
  ],
};

// Phrases that opt out when they appear anywhere in a short message.
const PHRASE_OPT_OUT = {
  en: [
    'unsubscribe', 'stop sending', 'stop messaging', 'stop texting', 'stop all messages',
    'stop these messages', 'stop this message', 'dont send me', 'do not send me', 'dont message me',
    'do not message me', 'remove me from', 'remove my number', 'delete my number', 'opt out', 'opt me out',
    'no more messages', 'stop whatsapp', 'stop msg', 'stop msgs',
  ],
  ta: [
    // "don't send (messages)"
    'அனுப்ப வேண்டாம்', 'அனுப்பாதீங்க', 'அனுப்பாதீர்கள்', 'அனுப்பாதே', 'அனுப்பாதிங்க',
    'மெசேஜ் வேண்டாம்', 'மெசேஜ வேண்டாம்', 'செய்தி வேண்டாம்', 'செய்திகள் வேண்டாம்', 'மெசேஜ் அனுப்பாதீங்க',
    'தகவல் வேண்டாம்', 'தொந்தரவு செய்யாதீங்க', 'தொந்தரவு செய்யாதீர்கள்',
    // "stop (the messages)"
    'நிறுத்துங்க', 'நிறுத்துங்கள்', 'நிறுத்தவும்', 'நிறுத்திடுங்க', 'நிறுத்திவிடுங்கள்',
    // transliterations
    'anuppa vendam', 'anupa vendam', 'anuppa venam', 'anupa venam', 'anuppathinga', 'anupathinga',
    'message vendam', 'msg vendam', 'message venam', 'msg venam', 'messages vendam',
    'niruthunga', 'nirutunga', 'niruthungal', 'niruthidunga', 'thonthatavu seiyathinga',
  ],
};

const EXACT_OPT_IN = {
  en: ['start', 'unstop', 'subscribe', 'resubscribe', 'join', 'opt in', 'optin', 'yes start', 'start again', 'resume'],
  ta: ['தொடங்கு', 'தொடங்குங்கள்', 'ஆரம்பி', 'ஆரம்பிக்கவும்', 'தொடரவும்', 'தொடருங்கள்', 'அனுப்புங்கள்', 'அனுப்பு',
    'thodangu', 'thodangunga', 'arambi', 'aarambi', 'thodaravum', 'anuppunga', 'anupunga'],
};

const TAMIL_LETTERS = /[஀-௿]/;

/** Lower-cased words only: punctuation, emoji and symbols become spaces. */
function normalise(text) {
  return String(text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9஀-௿\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordCount = (normalised) => (normalised ? normalised.split(' ').length : 0);

const languageOf = (keyword) => (TAMIL_LETTERS.test(keyword) ? 'ta' : null);

function matchExact(normalised, table) {
  for (const [lang, words] of Object.entries(table)) {
    for (const word of words) {
      if (normalise(word) === normalised) return { keyword: word, language: lang };
    }
  }
  return null;
}

function matchPhrase(normalised, table) {
  const padded = ` ${normalised} `;
  for (const [lang, phrases] of Object.entries(table)) {
    for (const phrase of phrases) {
      if (padded.includes(` ${normalise(phrase)} `)) return { keyword: phrase, language: lang };
    }
  }
  return null;
}

/**
 * { matched, keyword, language } — language is 'en' or 'ta' (the list the
 * keyword came from; transliterated Tamil counts as 'ta').
 */
function detectOptOut(text) {
  const normalised = normalise(text);
  if (!normalised) return { matched: false };
  const exact = matchExact(normalised, EXACT_OPT_OUT);
  if (exact) return { matched: true, ...exact };
  if (wordCount(normalised) <= SHORT_MESSAGE_WORDS) {
    const phrase = matchPhrase(normalised, PHRASE_OPT_OUT);
    if (phrase) return { matched: true, ...phrase };
  }
  return { matched: false };
}

function detectOptIn(text) {
  const normalised = normalise(text);
  if (!normalised) return { matched: false };
  const exact = matchExact(normalised, EXACT_OPT_IN);
  return exact ? { matched: true, ...exact } : { matched: false };
}

/** What we reply (inside the open 24-hour window) when a contact opts out or back in. */
function confirmationText(kind, language) {
  const tamil = language === 'ta';
  if (kind === 'opt_out') {
    return tamil
      ? 'சரி. இனி உங்களுக்கு விளம்பர செய்திகள் அனுப்பப்படாது. மீண்டும் பெற START என்று அனுப்பவும்.'
      : 'You will no longer receive marketing messages from us. Reply START at any time to receive them again.';
  }
  return tamil
    ? 'நன்றி. இனி எங்கள் செய்திகளை மீண்டும் பெறுவீர்கள். நிறுத்த STOP என்று அனுப்பவும்.'
    : 'Thanks. You will receive our messages again. Reply STOP at any time to stop them.';
}

module.exports = {
  SHORT_MESSAGE_WORDS,
  EXACT_OPT_OUT,
  PHRASE_OPT_OUT,
  EXACT_OPT_IN,
  normalise,
  detectOptOut,
  detectOptIn,
  confirmationText,
  languageOf,
};
