// Prepares the Alliance collections in MongoDB: connects, builds indexes and
// seeds the default rows that the former SQL migrations used to insert.
// Safe to call repeatedly — it only inserts rows that do not exist yet.
const { connectMongo } = require('./mongo');
const models = require('../models');

const {
  AllianceSequences,
  AllianceAudiences,
  AllianceTemplates,
  AllianceBulkSendLimits,
} = models;

let schemaPromise;

const AUDIENCES = [
  { code: 'college', label: 'College principals / TPOs', brand: 'BM Academy',
    sample: { name: 'The Principal', business_name: 'Example Engineering College', email: 'principal@example.edu', phone: '919876543210', industry: 'Education', location: 'Chennai', source: 'manual_research' } },
  { code: 'hr', label: 'Company HR / corporates', brand: 'CoreTalents',
    sample: { name: 'HR Manager', business_name: 'Example Software Company', email: 'hr@example.com', phone: '919876543211', industry: 'IT Services', location: 'Chennai', source: 'company_directory' } },
  { code: 'smb', label: 'Local clinics / shops / SMBs', brand: 'BM TechX',
    sample: { name: 'Dr. Meena', business_name: 'Example Dental Clinic', email: 'meena@example.com', phone: '919876543212', industry: 'Healthcare', location: 'Pondicherry', source: 'manual_research' } },
  { code: 'iv', label: 'IV trip coordinators', brand: 'TravellersNeed',
    sample: { name: 'IV Coordinator', business_name: 'Example Arts and Science College', email: 'iv@example.edu', phone: '919876543213', industry: 'Education', location: 'Tiruvannamalai', source: 'college_directory' } },
];

const EMAIL_TOUCHES = [
  [1, 0, 'Introduction and one clear ask'],
  [2, 2, 'Short friendly reminder'],
  [3, 5, 'New angle and proof'],
  [4, 9, 'Polite break-up message'],
];
const WHATSAPP_TOUCHES = [
  [1, 0, 'Approved introduction template'],
  [2, 4, 'One gentle follow-up'],
];

const SIGN_OFF = '\n\n— Kamar, ABM Groups, Pondicherry\nTo stop receiving these, reply "unsubscribe".';
const EMAIL_TEMPLATES = {
  college: [
    ['Placement-focused digital skills for {{org}} students', 'Dear {{name}},\n\nI am Kamar from BM Academy, Pondicherry. We run job-focused digital skills programs with real placement support — 1400+ students trained, 150+ placed, and a 4.8 star rating.\n\nCould we explore a training and placement partnership with {{org}}?'],
    ['Re: Placement partnership for {{org}}', 'Hi {{name}},\n\nJust following up about a placement-focused skills partnership for {{org}}. Shall I send the one-page overview?'],
    ['How other TN colleges use this', 'Hi {{name}},\n\nWe run training on campus, provide genuine placement support, and help colleges achieve measurable placement outcomes. Would a 15-minute discussion be useful for {{org}}?'],
    ['Should I close this for now?', 'Hi {{name}},\n\nIf a student placement partnership is not a priority this term, I will leave it here. If it is, reply and I will send the MoU overview.'],
  ],
  hr: [
    ['Trained candidates for {{org}} hiring', 'Dear {{name}},\n\nI am Kamar from CoreTalents. We place trained, screened digital and tech candidates on a pay-on-join basis. If {{org}} is hiring, may I share a few matching profiles?'],
    ['Re: Candidates for {{org}}', 'Hi {{name}},\n\nHappy to share two or three relevant profiles with no obligation. Which roles is {{org}} currently hiring for?'],
    ['Pay only when they join', 'Hi {{name}},\n\nWe source and screen, you interview, and you pay only after a successful join. Would you like matching profiles for {{org}}?'],
    ['Closing the loop', 'Hi {{name}},\n\nIf hiring is not active now, I will stop here. Reply "later" for a future check-in, or reply now if you would like candidate profiles.'],
  ],
  smb: [
    ['More local customers for {{org}}?', 'Hi {{name}},\n\nI am Kamar from BM TechX. We help local businesses get more customers through reels and local ads, starting at ₹8,999/month. Can I send two sample reels for {{org}}?'],
    ['Re: reels for {{org}}', 'Hi {{name}},\n\nFollowing up — would you like two sample reels created for businesses like {{org}}?'],
    ['What ₹8,999 gets you', 'Hi {{name}},\n\nThe package includes monthly reels, a local advertising campaign, and a simple lead system. Is it worth a quick look for {{org}}?'],
    ['Last note', 'Hi {{name}},\n\nI will leave it here for now. If getting more local customers is a priority for {{org}}, reply and I will share the samples.'],
  ],
  iv: [
    ['Industrial visit trips for {{org}} students', 'Dear {{name}},\n\nI am Kamar from TravellersNeed. We organise safe, end-to-end industrial visits for colleges. If {{org}} is planning an IV, may I share a custom plan?'],
    ['Re: IV trip for {{org}}', 'Hi {{name}},\n\nI can send a sample itinerary and budget for your batch size. Approximately how many students are travelling from {{org}}?'],
    ['Everything handled, one point of contact', 'Hi {{name}},\n\nWe provide one coordinator, safe transport, vetted stays, and a plan built around your dates and budget. Would you like a quote for {{org}}?'],
    ['Shall I close this?', 'Hi {{name}},\n\nIf there is no IV planned now, I will step back. Reply "later" for a future check-in, or send the batch size if you would like a plan.'],
  ],
};

// Inserts `doc` only when no document matches `filter` (ON CONFLICT DO NOTHING).
async function insertIfMissing(model, filter, doc) {
  if (await model.exists(filter)) return;
  try {
    await model.create({ ...filter, ...doc });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function seedDefaults() {
  for (const audience of AUDIENCES) {
    await insertIfMissing(AllianceAudiences, { code: audience.code }, {
      label: audience.label,
      brand: audience.brand,
      default_channel: 'email',
      template_samples: [{
        ...audience.sample,
        audience: audience.code,
        channel_pref: 'email',
        consent: 'false',
        consent_source: '',
      }],
    });

    for (const [touch_no, delay_days, purpose] of EMAIL_TOUCHES) {
      await insertIfMissing(AllianceSequences, { audience: audience.code, channel: 'email', touch_no }, { delay_days, purpose });
    }
    for (const [touch_no, delay_days, purpose] of WHATSAPP_TOUCHES) {
      await insertIfMissing(AllianceSequences, { audience: audience.code, channel: 'whatsapp', touch_no }, { delay_days, purpose });
    }

    const templates = EMAIL_TEMPLATES[audience.code] || [];
    for (let index = 0; index < templates.length; index += 1) {
      const [subject, body] = templates[index];
      await insertIfMissing(AllianceTemplates, { audience: audience.code, channel: 'email', touch_no: index + 1 }, {
        subject,
        body: body + SIGN_OFF,
        provider_status: 'approved',
        active: true,
      });
    }
  }

  for (const channel of ['email', 'whatsapp']) {
    await insertIfMissing(AllianceBulkSendLimits, { channel }, { limit_mode: 'unlimited', custom_limit: null });
  }
}

function ensureAllianceSchema() {
  if (!schemaPromise) {
    schemaPromise = connectMongo()
      .then(() => Promise.all(Object.values(models).map((model) => model.createIndexes())))
      .then(seedDefaults)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }
  return schemaPromise;
}

module.exports = ensureAllianceSchema;
