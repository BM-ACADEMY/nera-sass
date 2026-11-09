/**
 * Which language a customer wrote in (plan N2: English or Tamil).
 *
 *   ta   Tamil script, or Tamil typed in English letters ("Tanglish")
 *   en   everything else
 *
 * `script` tells the two Tamil cases apart so a reply can match what the
 * customer typed. Pure: no database, no network.
 */
const TANGLISH_WORDS = new Set([
  'aama', 'ama', 'enna', 'ennanga', 'enaku', 'enakku', 'enga', 'engaluku', 'eppo', 'epdi', 'eppadi', 'evlo', 'evvalavu',
  'illa', 'illai', 'iruka', 'irukka', 'irukku', 'irukkaa', 'kanum', 'konjam', 'kudunga', 'naan', 'neenga', 'pathi',
  'pannanum', 'pannunga', 'pannuvinga', 'sollunga', 'seri', 'unga', 'ungal', 'ungaluku', 'venam', 'venum', 'vanakkam', 'yen',
]);

const TAMIL_SCRIPT = /\p{Script=Tamil}/u;

/** { code: 'ta' | 'en', script: 'tamil' | 'latin', tanglish: boolean } */
function detectLanguage(message) {
  const value = String(message || '');
  if (TAMIL_SCRIPT.test(value)) return { code: 'ta', script: 'tamil', tanglish: false };
  const words = value.toLowerCase().match(/[a-z]+/g) || [];
  if (words.some((word) => TANGLISH_WORDS.has(word))) return { code: 'ta', script: 'latin', tanglish: true };
  return { code: 'en', script: 'latin', tanglish: false };
}

/**
 * The language a fixed system message (a booking question, a holding reply)
 * is written in. Tanglish customers get Tamil script only when they also
 * wrote some; otherwise English, which they can read.
 */
const systemLanguage = (message) => (detectLanguage(message).script === 'tamil' ? 'ta' : 'en');

module.exports = { TANGLISH_WORDS, detectLanguage, systemLanguage };
