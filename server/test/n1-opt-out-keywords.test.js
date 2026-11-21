/**
 * N1: STOP / unsubscribe detection in English and Tamil. Pure functions, no DB.
 */
const test = require('node:test');
const assert = require('node:assert');
const { detectOptOut, detectOptIn, consentKeywordChange, confirmationText, normalise } = require('../services/optOutKeywords');

test('Opt-out keyword detection', async (t) => {
  await t.test('K1. English STOP words match whatever the case or punctuation', () => {
    for (const text of ['STOP', 'stop', ' Stop. ', 'STOP!', 'Unsubscribe', 'unsub', 'CANCEL', 'End', 'quit', 'opt out', 'Opt-Out', 'Remove me', 'No more messages', '🛑 STOP 🛑']) {
      const result = detectOptOut(text);
      assert.strictEqual(result.matched, true, `"${text}" should opt out`);
      assert.strictEqual(result.language, 'en', `"${text}" is English`);
    }
  });

  await t.test('K2. Short English sentences with an unsubscribe phrase match', () => {
    for (const text of ['Please stop sending me messages', 'stop messaging me please', "Don't send me these", 'Remove my number from your list', 'please unsubscribe me']) {
      assert.strictEqual(detectOptOut(text).matched, true, `"${text}" should opt out`);
    }
  });

  await t.test('K3. Tamil STOP words match in Tamil script and in Latin letters', () => {
    for (const text of ['நிறுத்து', 'நிறுத்துங்கள்', 'நிறுத்துங்க', 'வேண்டாம்', 'வேணாம்', 'ரத்து', 'niruthu', 'Niruthunga', 'vendam', 'VENAM']) {
      const result = detectOptOut(text);
      assert.strictEqual(result.matched, true, `"${text}" should opt out`);
      assert.strictEqual(result.language, 'ta', `"${text}" is Tamil`);
    }
    for (const text of ['இனி மெசேஜ் அனுப்ப வேண்டாம்', 'தயவு செய்து மெசேஜ் அனுப்பாதீங்க', 'enaku message vendam', 'inime anuppa vendam please', 'ipdi message anupathinga']) {
      const result = detectOptOut(text);
      assert.strictEqual(result.matched, true, `"${text}" should opt out`);
      assert.strictEqual(result.language, 'ta');
    }
  });

  await t.test('K4. Ordinary messages are not opt-outs', () => {
    for (const text of [
      'Hi, I want to know the fees', 'Can you stop by the office tomorrow?', 'Please do not stop the class, we love it and want more sessions next month',
      'When does the next batch end?', 'I will cancel my other appointment and come', 'Is the bus stop near the centre?', 'bus stop', 'dont stop', 'வணக்கம், கட்டணம் எவ்வளவு?',
      'நாளை வர முடியுமா?', '', '   ', 'ok', 'yes',
    ]) {
      assert.strictEqual(detectOptOut(text).matched, false, `"${text}" must not opt out`);
    }
  });

  await t.test('K5. Opt-in keywords only on an exact message', () => {
    assert.strictEqual(detectOptIn('START').matched, true);
    assert.strictEqual(detectOptIn('unstop').matched, true);
    assert.strictEqual(detectOptIn('தொடங்கு').matched, true);
    assert.strictEqual(detectOptIn('தொடங்கு').language, 'ta');
    assert.strictEqual(detectOptIn('start the class tomorrow').matched, false);
    assert.strictEqual(detectOptIn('stop').matched, false);
  });

  await t.test('K5b. Everyday "send" words are not opt-in keywords', () => {
    for (const text of ['அனுப்பு', 'அனுப்புங்கள்', 'anuppunga', 'anupunga', 'send', 'send details']) {
      assert.strictEqual(detectOptIn(text).matched, false, `"${text}" must not count as opt-in`);
    }
  });

  await t.test('K7. A very short message with "stop" opts out', () => {
    for (const text of ['please stop', 'Stop pls', 'stop it', 'stop calling me', 'STOP NOW', 'pls stop!!', 'stop sms']) {
      const result = detectOptOut(text);
      assert.strictEqual(result.matched, true, `"${text}" should opt out`);
      assert.strictEqual(result.language, 'en');
    }
  });

  await t.test('K8. Negated or unrelated short "stop" messages do not opt out', () => {
    for (const text of ['dont stop', "Don't stop", 'do not stop', 'never stop', 'bus stop', 'stop by', 'stop here', 'stop at the gate', 'cant stop smiling']) {
      assert.strictEqual(detectOptOut(text).matched, false, `"${text}" must not opt out`);
    }
    // Five words or more is a sentence for a person, not an unsubscribe.
    assert.strictEqual(detectOptOut('can you stop the class early today').matched, false);
  });

  await t.test('K9. consentKeywordChange: STOP always, START only to re-subscribe an opted-out contact', () => {
    assert.strictEqual(consentKeywordChange('STOP', { optedOut: false }).kind, 'opt_out');
    assert.strictEqual(consentKeywordChange('please stop', { optedOut: true }).kind, 'opt_out');
    const resubscribe = consentKeywordChange('START', { optedOut: true });
    assert.strictEqual(resubscribe.kind, 'opt_in');
    assert.strictEqual(resubscribe.language, 'en');
    const tamil = consentKeywordChange('தொடங்கு', { optedOut: true });
    assert.strictEqual(tamil.kind, 'opt_in');
    assert.strictEqual(tamil.language, 'ta');
    const first = consentKeywordChange('START', { optedOut: false });
    assert.strictEqual(first.kind, null, 'a keyword never creates first-time consent');
    assert.strictEqual(first.ignoredOptIn, true);
    assert.strictEqual(consentKeywordChange('hello', { optedOut: true }).kind, null);
    assert.strictEqual(consentKeywordChange('anuppunga', { optedOut: true }).kind, null);
  });

  await t.test('K6. Confirmations follow the language of the keyword', () => {
    assert.match(confirmationText('opt_out', 'en'), /no longer receive marketing/);
    assert.match(confirmationText('opt_out', 'en'), /START/);
    assert.match(confirmationText('opt_out', 'ta'), /START/);
    assert.match(confirmationText('opt_out', 'ta'), /[஀-௿]/);
    assert.match(confirmationText('opt_in', 'en'), /STOP/);
    assert.match(confirmationText('opt_in', 'ta'), /STOP/);
    assert.strictEqual(normalise("  Don't   STOP!! "), 'dont stop');
  });
});
