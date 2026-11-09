/**
 * Fixed customer-facing sentences of the booking flow, in English and Tamil.
 * The server writes these (not the model) so a customer is only ever told
 * "booked" when a booking really exists. Pure: no database.
 */
const LANGS = ['en', 'ta'];

function formatWhen(date, timeZone, lang = 'en') {
  return new Date(date).toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
}

const TEXT = {
  holding: {
    en: () => 'I will check this with the team and get back to you.',
    ta: () => 'இதை எங்கள் குழுவிடம் கேட்டு உங்களுக்குத் தெரிவிக்கிறேன்.',
  },
  optOut: {
    en: () => 'You will not get further messages from us here.',
    ta: () => 'இனி இங்கே உங்களுக்கு செய்திகள் அனுப்பப்படாது.',
  },
  askName: {
    en: () => 'Happy to help you book. May I have your name?',
    ta: () => 'முன்பதிவு செய்ய உதவுகிறேன். உங்கள் பெயரைச் சொல்ல முடியுமா?',
  },
  askService: {
    en: ({ services }) => `Which service would you like to book? We offer: ${services.join(', ')}.`,
    ta: ({ services }) => `எந்த சேவையை முன்பதிவு செய்ய விரும்புகிறீர்கள்? எங்களிடம் உள்ளவை: ${services.join(', ')}.`,
  },
  askTime: {
    en: ({ hours }) => `What date and time suit you? Bookings are open ${hours}.`,
    ta: ({ hours }) => `எந்த தேதி மற்றும் நேரம் உங்களுக்கு வசதியாக இருக்கும்? முன்பதிவு நேரம்: ${hours}.`,
  },
  pastTime: {
    en: () => 'Please share a date and time in the future.',
    ta: () => 'எதிர்காலத்தில் ஒரு தேதி மற்றும் நேரத்தைச் சொல்லுங்கள்.',
  },
  outsideHours: {
    en: ({ hours }) => `We take bookings ${hours}. Please pick a time within these hours.`,
    ta: ({ hours }) => `முன்பதிவு நேரம்: ${hours}. இந்த நேரத்திற்குள் ஒரு நேரத்தைத் தேர்ந்தெடுங்கள்.`,
  },
  unavailable: {
    en: ({ slots }) => `Sorry, that time is not available. Free times: ${slots.join('; ')}. Which one would you like?`,
    ta: ({ slots }) => `மன்னிக்கவும், அந்த நேரம் கிடைக்கவில்லை. கிடைக்கும் நேரங்கள்: ${slots.join('; ')}. எது வேண்டும்?`,
  },
  noSlots: {
    en: () => 'Sorry, that time is not available and I could not find a free time soon. Our team will contact you.',
    ta: () => 'மன்னிக்கவும், அந்த நேரம் கிடைக்கவில்லை, விரைவில் காலியான நேரமும் இல்லை. எங்கள் குழு உங்களைத் தொடர்புகொள்ளும்.',
  },
  confirmAsk: {
    en: ({ name, service, when }) => `Please confirm: ${service} for ${name} on ${when}. Reply YES to book, or send another time.`,
    ta: ({ name, service, when }) => `உறுதிப்படுத்துங்கள்: ${name} — ${service} — ${when}. முன்பதிவு செய்ய "ஆம்" என்று பதிலளியுங்கள், அல்லது வேறு நேரத்தைச் சொல்லுங்கள்.`,
  },
  booked: {
    en: ({ service, when }) => `Your ${service} appointment is confirmed for ${when}. We will send you a reminder before it.`,
    ta: ({ service, when }) => `உங்கள் ${service} சந்திப்பு ${when} அன்று உறுதி செய்யப்பட்டது. அதற்கு முன் நினைவூட்டல் அனுப்புவோம்.`,
  },
  alreadyBooked: {
    en: ({ service, when }) => `You already have a ${service} appointment on ${when}.`,
    ta: ({ service, when }) => `உங்களுக்கு ஏற்கனவே ${when} அன்று ${service} சந்திப்பு உள்ளது.`,
  },
  cancelled: {
    en: ({ when }) => `Your appointment on ${when} has been cancelled.`,
    ta: ({ when }) => `${when} அன்றைய உங்கள் சந்திப்பு ரத்து செய்யப்பட்டது.`,
  },
  nothingToCancel: {
    en: () => 'I could not find an upcoming appointment for you to cancel.',
    ta: () => 'ரத்து செய்ய உங்களுக்கு வரவிருக்கும் சந்திப்பு எதுவும் இல்லை.',
  },
  bookingError: {
    en: () => 'I could not complete the booking right now. Our team will confirm it with you shortly.',
    ta: () => 'இப்போது முன்பதிவை முடிக்க முடியவில்லை. எங்கள் குழு விரைவில் உங்களுக்கு உறுதிப்படுத்தும்.',
  },
};

/** The sentence `key` in `lang` (falls back to English). */
function say(key, lang, vars = {}) {
  const entry = TEXT[key];
  if (!entry) throw new Error(`Unknown booking text: ${key}`);
  return (entry[LANGS.includes(lang) ? lang : 'en'])(vars);
}

module.exports = { LANGS, TEXT, say, formatWhen };
