const normalize = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\+/g, ' plus ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenize = (value) => normalize(value).split(' ').filter(Boolean);

const field = (record, label) => {
  const match = String(record || '').match(new RegExp(`^${label}\\s*:\\s*([^\\r\\n]*)`, 'im'));
  return match ? match[1].trim() : '';
};

// Words a lead naturally wraps a request in ("I want...", "can you share...")
// that carry no course-identifying signal. This list only needs to cover
// conversational filler, not course vocabulary, so it stays short and safe.
const GENERIC_WORDS = new Set([
  'a', 'about', 'also', 'and', 'any', 'both', 'can', 'could', 'course', 'courses',
  'curriculum', 'details', 'detail', 'each', 'every', 'for', 'get', 'give', 'gives',
  'give', 'got', 'have', 'how', 'i', 'in', 'info', 'information', 'is', 'it', 'kindly',
  'know', 'me', 'more', 'my', 'need', 'of', 'please', 'pls', 'program', 'programs',
  'provide', 'send', 'share', 'shared', 'should', 'syllabi', 'syllabus', 'tell', 'the',
  'this', 'us', 'want', 'wanted', 'wants', 'we', 'what', 'would', 'you', 'your',
]);

const meaningfulTerms = (value) => tokenize(value)
  .filter((term) => term.length > 1 && !GENERIC_WORDS.has(term));

// Two words are treated as the same signal if one is a prefix of the other
// (min length 3), so informal abbreviations ("dev" for "developer") still
// resolve without maintaining a per-course alias list.
const wordsMatch = (a, b) => {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.startsWith(b) || b.startsWith(a);
};

/**
 * Builds the course catalog exclusively from current AI Brain documents.
 * No course name, tier, fee, duration, alias, or URL is maintained in code.
 */
function buildBmAcademyCatalog(documents = []) {
  const records = [];
  const recordPattern = /^(?:\d+\.\s*)?Course ID\s*:\s*([^\r\n]+)([\s\S]*?)(?=^(?:\d+\.\s*)?Course ID\s*:|^\d+\.\s*BM TechX Data Collection Form|^Service\s+\d+\s*:|(?![\s\S]))/gmi;

  for (const document of documents) {
    const source = String(document || '');
    for (const match of source.matchAll(recordPattern)) {
      const raw = `Course ID: ${match[1]}${match[2]}`.trim();
      const id = match[1].trim();
      const name = field(raw, 'Course Name');
      if (!id || !name) continue;
      const status = field(raw, 'Status') || field(raw, 'Active/Inactive');
      if (status && !/^active$/i.test(status)) continue;
      records.push({
        id,
        name,
        tier: field(raw, 'Tier'),
        parent: field(raw, 'Parent Course'),
        category: field(raw, 'Category'),
        syllabusUrl: field(raw, 'Syllabus(?:\\s+URL)?'),
        raw,
      });
    }
  }

  const unique = new Map();
  for (const course of records) unique.set(normalize(course.id), course);
  return [...unique.values()];
}

// Resolves a message to exactly one course only when it's unambiguous: every
// word of the course name has a matching word in the message, AND (when two
// or more catalog entries share that name, differing only by tier) the tier
// is also matched. A name-only match that's shared by multiple tiers is
// deliberately NOT resolved here — the caller falls back to the family/option
// list instead of silently guessing a tier.
function findExactCourse(text, catalog = []) {
  const haystackWords = tokenize(text);
  if (!haystackWords.length) return null;

  const scored = catalog.map((course) => {
    const nameWords = tokenize(course.name);
    const nameHit = nameWords.length > 0 && nameWords.every((w) => haystackWords.some((h) => wordsMatch(h, w)));
    const tierWords = course.tier ? tokenize(`${course.name} ${course.tier}`) : [];
    const tierHit = tierWords.length > nameWords.length
      && tierWords.every((w) => haystackWords.some((h) => wordsMatch(h, w)));
    return { course, nameHit, tierHit };
  });

  const tierMatches = scored.filter((s) => s.tierHit);
  if (tierMatches.length === 1) return tierMatches[0].course;
  if (tierMatches.length > 1) return null;

  const nameMatches = scored.filter((s) => s.nameHit);
  return nameMatches.length === 1 ? nameMatches[0].course : null;
}

function findCourseOptions(text, catalog = []) {
  const terms = meaningfulTerms(text);
  if (!terms.length) return [];
  // Match against the course's own name only. Parent/category are shared
  // across a whole program (e.g. a prerequisite bootcamp's "Parent Course"
  // is the same text as the main program's name), so including them here
  // pulls unrelated prerequisite courses into what should be a same-name
  // tier family (e.g. "Full stack developer Tier 1/2").
  return catalog.filter((course) => {
    const searchable = normalize(course.name);
    return terms.every((term) => searchable.includes(term));
  });
}

function numberedCourseSelection(value, history, catalog, beforeIndex = history.length) {
  const match = normalize(value).match(/^(?:option )?(\d{1,2})$/);
  if (!match) return null;
  const selectedIndex = Number(match[1]) - 1;
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const item = history[index];
    const role = item?.role || (item?.direction === 'inbound' ? 'user' : 'assistant');
    if (role !== 'assistant') continue;
    const text = String(item?.text || item?.content || item?.message || '');
    const listed = [...text.matchAll(/^\s*\d+\.\s*(.+)$/gm)]
      .map((line) => findExactCourse(line[1], catalog))
      .filter(Boolean);
    if (listed.length) return listed[selectedIndex] || null;
  }
  return null;
}

function resolveBmAcademyCourseContext(message, chatHistory = [], catalog = []) {
  const current = findExactCourse(message, catalog);
  if (current) return current;
  const history = Array.isArray(chatHistory) ? chatHistory : [];
  const numbered = numberedCourseSelection(message, history, catalog);
  if (numbered) return numbered;

  // Only user messages can select a course. Assistant lists are context, not a
  // selection, and must never silently lock the first displayed course.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const role = item?.role || (item?.direction === 'inbound' ? 'user' : 'assistant');
    if (role !== 'user') continue;
    const text = item?.text || item?.content || item?.message || '';
    const histNumbered = numberedCourseSelection(text, history, catalog, index);
    if (histNumbered) return histNumbered;
    const exact = findExactCourse(text, catalog);
    if (exact) return exact;
    // A family reference ("full stack dev" with no tier) establishes the
    // active topic but is not itself a single-course selection. Stop walking
    // further back into unrelated earlier topics once that's found.
    if (findCourseOptions(text, catalog).length > 1) return null;
  }
  return null;
}

function findBmAcademyCourseFamily(message, chatHistory = [], catalog = []) {
  const currentOptions = findCourseOptions(message, catalog);
  if (currentOptions.length > 1 && !findExactCourse(message, catalog)) return currentOptions;
  const history = Array.isArray(chatHistory) ? chatHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const role = item?.role || (item?.direction === 'inbound' ? 'user' : 'assistant');
    if (role !== 'user') continue;
    const options = findCourseOptions(item?.text || item?.content || item?.message, catalog);
    if (options.length > 1) return options;
  }
  return [];
}

module.exports = {
  buildBmAcademyCatalog,
  findBmAcademyCourseFamily,
  resolveBmAcademyCourseContext,
};
