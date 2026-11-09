/**
 * Step 3: the services a business sells, with prices, timings and the answers
 * the AI may use. A service is an AI Brain knowledge document of kind
 * "product" (models/BrainDocs.js), so the AI Brain reads it with no extra
 * wiring; the structured values live next to the text so the checklist can
 * tell a complete service from a half-typed one.
 *
 * Runs in the caller's tenant context: BrainDocs is tenant-scoped.
 */
const crypto = require('crypto');
const { BrainDocs, Clients } = require('../../models');

const NO_ID = { _id: 0 };
const MAX_SERVICES = 100;
const MAX_ANSWERS = 10;

class CatalogError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Cleans and checks one service. Throws CatalogError(400) with a plain message. */
function cleanService(input = {}) {
  const name = text(input.name, 120);
  if (name.length < 2) throw new CatalogError(400, 'Give the service a name', 'SERVICE_NAME_REQUIRED');
  const price = Number(input.price_inr);
  if (input.price_inr === '' || input.price_inr == null || !Number.isFinite(price) || price < 0 || price > 10000000) {
    throw new CatalogError(400, 'Enter the price in rupees, for example 500', 'SERVICE_PRICE_INVALID');
  }
  const duration = Number(input.duration_minutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
    throw new CatalogError(400, 'Enter how long the service takes in minutes, between 5 and 1440', 'SERVICE_DURATION_INVALID');
  }
  const answers = (Array.isArray(input.answers) ? input.answers : [])
    .map((item) => ({ question: text(item?.question, 200), answer: text(item?.answer, 600) }))
    .filter((item) => item.question || item.answer);
  if (answers.length > MAX_ANSWERS) throw new CatalogError(400, `Add at most ${MAX_ANSWERS} questions per service`, 'SERVICE_ANSWERS_TOO_MANY');
  if (answers.some((item) => !item.question || !item.answer)) {
    throw new CatalogError(400, 'Each question needs an answer, and each answer needs a question', 'SERVICE_ANSWER_INCOMPLETE');
  }
  return {
    name,
    price_inr: Math.round(price * 100) / 100,
    duration_minutes: duration,
    availability: text(input.availability, 200),
    notes: text(input.notes, 500),
    answers,
  };
}

/** The plain text the AI Brain reads. Prices are written with the rupee sign so its price check can match them. */
function renderContent(service) {
  const lines = [
    `Service: ${service.name}`,
    `Price: ₹${service.price_inr}`,
    `Duration: ${service.duration_minutes} minutes`,
  ];
  if (service.availability) lines.push(`Availability: ${service.availability}`);
  if (service.notes) lines.push(`Notes: ${service.notes}`);
  if (service.answers.length) {
    lines.push('Questions and answers the assistant may use:');
    for (const item of service.answers) lines.push(`Q: ${item.question}`, `A: ${item.answer}`);
  }
  return lines.join('\n');
}

const present = (doc) => ({
  id: doc.id,
  ...doc.service,
  is_active: doc.is_active !== false,
  updated_at: doc.updated_at || null,
});

const onboardingFilter = { doc_type: /^product:/, 'service.price_inr': { $exists: true } };

async function list() {
  const docs = await BrainDocs.find(onboardingFilter, NO_ID).sort({ id: 1 }).lean();
  return docs.map(present);
}

/** True for a service the checklist counts: active, with a price and a duration. */
const isComplete = (service) => Boolean(service && service.is_active !== false
  && Number.isFinite(Number(service.price_inr)) && Number(service.duration_minutes) >= 5);

async function create(input) {
  const service = cleanService(input);
  const client = await Clients.findOne({}, { _id: 0, id: 1 }).sort({ id: 1 }).lean();
  if (!client) throw new CatalogError(409, 'This workspace has no brand profile yet', 'NO_BRAND');
  if (await BrainDocs.countDocuments(onboardingFilter) >= MAX_SERVICES) {
    throw new CatalogError(409, `A workspace can list up to ${MAX_SERVICES} services`, 'SERVICE_LIMIT');
  }
  const doc = await BrainDocs.create({
    client_id: client.id,
    doc_type: `product:${crypto.randomUUID()}`,
    title: service.name,
    content: renderContent(service),
    service,
    source: 'onboarding',
    is_active: true,
    updated_at: new Date(),
  });
  return present(doc.toObject());
}

async function update(id, input) {
  const service = cleanService(input);
  const doc = await BrainDocs.findOneAndUpdate(
    { ...onboardingFilter, id: Number(id) },
    { $set: { title: service.name, content: renderContent(service), service, updated_at: new Date() } },
    { new: true, projection: NO_ID },
  ).lean();
  if (!doc) throw new CatalogError(404, 'Service not found', 'SERVICE_NOT_FOUND');
  return present(doc);
}

async function setActive(id, active) {
  const doc = await BrainDocs.findOneAndUpdate(
    { ...onboardingFilter, id: Number(id) },
    { $set: { is_active: Boolean(active), updated_at: new Date() } },
    { new: true, projection: NO_ID },
  ).lean();
  if (!doc) throw new CatalogError(404, 'Service not found', 'SERVICE_NOT_FOUND');
  return present(doc);
}

async function remove(id) {
  const result = await BrainDocs.deleteOne({ ...onboardingFilter, id: Number(id) });
  if (!result.deletedCount) throw new CatalogError(404, 'Service not found', 'SERVICE_NOT_FOUND');
}

module.exports = { CatalogError, cleanService, renderContent, isComplete, list, create, update, setActive, remove };
