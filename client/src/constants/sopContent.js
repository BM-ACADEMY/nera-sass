// SOP Content for each page/route in the portal
export const SOP_CONTENT = {
  '/thedal/serp-radar': {
    title: 'SERP Radar',
    icon: '📡',
    overview: 'SERP Radar tracks your client\'s keyword rankings on Google search results. Run periodic rank checks and monitor position trends.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'Choose the active client from the left sidebar before running any tracking.' },
      { step: 2, title: 'Add Target Keywords', desc: 'Enter the keywords you want to track. Each keyword is checked against Google\'s search results for the client\'s domain.' },
      { step: 3, title: 'Run Rank Check', desc: 'Click "Run Rank Check" to fetch the current Google ranking positions for all tracked keywords.' },
      { step: 4, title: 'Monitor Trends', desc: 'Review the rank position columns showing current position, previous position, and the change (up/down) per keyword.' },
      { step: 5, title: 'Export/Report', desc: 'Use the export option to download the rank data for client reporting.' },
    ],
    tips: [
      'Run rank checks at least once a week for accurate trend tracking.',
      'Target a mix of branded and non-branded keywords.',
      'Keywords ranking in positions 1–10 are on Page 1 of Google — aim to move keywords from page 2 into page 1.',
    ],
  },
  '/thedal/keyword-tracking': {
    title: 'Keyword Tracking',
    icon: '🔍',
    overview: 'Manage and track long-term keyword performance for a client. Assign target URLs and monitor how each keyword climbs or drops over time.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'Pick the client from the sidebar. Keywords are stored per-client.' },
      { step: 2, title: 'Add Keywords', desc: 'Click "Add Keyword" and enter the keyword, its target page URL, and any notes.' },
      { step: 3, title: 'Run Check', desc: 'Click "Check Rankings" to fetch the latest ranking data from Google via the SERP API.' },
      { step: 4, title: 'Review History', desc: 'Each keyword shows its historical positions as a trend chart — identify upward or downward movements.' },
      { step: 5, title: 'Set Targets', desc: 'Assign a target rank (e.g., Top 3) for each keyword to track progress against goals.' },
    ],
    tips: [
      'Group keywords by topic clusters or pages to better understand content performance.',
      'Investigate keywords that drop more than 5 positions in a single week.',
    ],
  },
  '/thedal/gsc-intel': {
    title: 'GSC Intel (Google Search Console)',
    icon: '📊',
    overview: 'GSC Intel pulls real performance data from Google Search Console — clicks, impressions, CTR, and position — for all your client\'s queries.',
    steps: [
      { step: 1, title: 'Connect Google Account', desc: 'Click "Connect GSC" and authorize with the Google account that has access to the client\'s Search Console property.' },
      { step: 2, title: 'Select Site Property', desc: 'Choose the website property from the dropdown once authenticated.' },
      { step: 3, title: 'Set Date Range', desc: 'Select a date range (Last 7 days, 28 days, or custom) to pull performance data.' },
      { step: 4, title: 'Filter by Device/Country', desc: 'Apply device (mobile/desktop) or country filters to narrow down the analysis.' },
      { step: 5, title: 'Review Queries', desc: 'The table shows all search queries with clicks, impressions, CTR, and average position. Sort by any column to find opportunities.' },
    ],
    tips: [
      'Queries with high impressions but low CTR have good potential — optimise the title and meta description of those pages.',
      'Pages ranking between position 5–15 are "almost there" — small on-page improvements can push them to top 5.',
    ],
  },
  '/thedal/rank-drop-alert': {
    title: 'Rank Drop Alert',
    icon: '🚨',
    overview: 'Rank Drop Alert monitors your tracked keywords and sends notifications when a significant drop in ranking is detected, so you can respond quickly.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'Pick the client from the sidebar. Alerts are client-specific.' },
      { step: 2, title: 'Configure Threshold', desc: 'Set the minimum drop threshold (e.g., 5 positions) that triggers an alert.' },
      { step: 3, title: 'Review Active Alerts', desc: 'Any keyword that dropped beyond the threshold in the last check appears in the "Active Alerts" list with the old and new positions.' },
      { step: 4, title: 'Investigate', desc: 'Click on an alert to investigate — review the keyword\'s trend chart and determine if it\'s a Google update, competitor move, or content issue.' },
      { step: 5, title: 'Dismiss Alert', desc: 'Once you\'ve investigated and taken action, dismiss the alert to keep the list clean.' },
    ],
    tips: [
      'Check alerts every Monday morning as a standard practice.',
      'Sudden drops for multiple keywords simultaneously usually indicate a Google core update.',
      'Single keyword drops often indicate a specific page issue — check that page\'s technical SEO.',
    ],
  },
  '/thedal/backlink-tracker': {
    title: 'Backlink Tracker',
    icon: '🔗',
    overview: 'Track all backlinks pointing to your client\'s website. Monitor new links, lost links, domain authority of linking sites, and follow/nofollow status.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'Backlinks are stored and tracked per client.' },
      { step: 2, title: 'Add Backlinks', desc: 'Paste the linking URL, the anchor text, the target page on the client\'s site, and select follow/nofollow status.' },
      { step: 3, title: 'Monitor Status', desc: 'The system periodically checks if each backlink is still live. "Lost" backlinks are flagged automatically.' },
      { step: 4, title: 'Review Domain Authority', desc: 'DA score is shown for each linking domain — prioritize earning links from high-DA sites (DA 50+).' },
      { step: 5, title: 'Export Link Report', desc: 'Download the full backlink report to share with clients or for your own records.' },
    ],
    tips: [
      'Aim for a healthy mix of dofollow and nofollow links.',
      'Disavow spammy low-quality links to protect from Google penalties.',
      'Lost backlinks from high-DA sites should be immediately followed up with the website owner.',
    ],
  },
  '/thedal/local-seo-bridge': {
    title: 'Local SEO Bridge',
    icon: '📍',
    overview: 'Local SEO Bridge manages and optimises your client\'s Google Business Profile (GBP) — posts, Q&A, reviews, and business info updates from one place.',
    steps: [
      { step: 1, title: 'Connect Google Account', desc: 'Click "Connect GBP" and authorize with the Google account managing the client\'s Business Profile.' },
      { step: 2, title: 'Select Business Location', desc: 'Choose the business location from the dropdown after authentication.' },
      { step: 3, title: 'Review GBP Info', desc: 'Check the business name, address, phone, categories, and hours for accuracy. Inconsistency hurts local rankings.' },
      { step: 4, title: 'Create GBP Post', desc: 'Write and schedule posts to the Google Business Profile to keep the listing active and engaging.' },
      { step: 5, title: 'Monitor Reviews', desc: 'View and respond to customer reviews directly from this page to improve reputation signals.' },
    ],
    tips: [
      'Post at least once a week on GBP to show Google the listing is active.',
      'The business categories should precisely match the client\'s primary service.',
      'Respond to ALL reviews (positive and negative) within 48 hours.',
    ],
  },
  '/thedal/local-citations': {
    title: 'Local Citations',
    icon: '📋',
    overview: 'Track NAP (Name, Address, Phone) consistency across all major local directories. Inconsistent citations are a top reason for poor local rankings.',
    steps: [
      { step: 1, title: 'Enter Business NAP', desc: 'Input the client\'s exact business name, address, and phone number as they should appear everywhere.' },
      { step: 2, title: 'Run Citation Scan', desc: 'The system checks major directories (Google, Yelp, JustDial, Facebook, etc.) for NAP inconsistencies.' },
      { step: 3, title: 'Review Issues', desc: 'Listings with incorrect or missing information are flagged as "Needs Fix".' },
      { step: 4, title: 'Fix Inconsistencies', desc: 'Update each directory listing manually or use the direct links provided to navigate to the business profile.' },
      { step: 5, title: 'Track Progress', desc: 'Re-scan periodically to confirm all citations are now consistent.' },
    ],
    tips: [
      'NAP must be identical across ALL directories — even minor differences (St. vs Street) matter.',
      'Start with the top 10 directories: Google, Facebook, Yelp, Bing Places, Apple Maps.',
    ],
  },
  '/thedal/gap-hunter': {
    title: 'Gap Hunter (Content Gap Analysis)',
    icon: '🎯',
    overview: 'Gap Hunter finds keywords your competitors rank for that your client does not. This reveals untapped opportunities to capture more search traffic.',
    steps: [
      { step: 1, title: 'Enter Client Domain', desc: 'Type the client\'s domain (e.g., example.com) in the field.' },
      { step: 2, title: 'Add Competitors', desc: 'Enter 2–5 competitor domains to compare against.' },
      { step: 3, title: 'Run Gap Analysis', desc: 'Click "Find Gaps" to analyse which keywords competitors rank for that the client does not.' },
      { step: 4, title: 'Review Gaps', desc: 'The results show keywords ordered by traffic potential — focus on high-volume, low-difficulty gaps first.' },
      { step: 5, title: 'Create Content Plan', desc: 'Export the gap keywords and use them to build a content plan — create new pages or optimise existing pages to rank for these terms.' },
    ],
    tips: [
      'Focus on keywords where 2+ competitors rank but your client doesn\'t.',
      'Combine with the Content Factory to generate SEO content targeting these gap keywords.',
    ],
  },
  '/thedal/schema-library': {
    title: 'Schema Library',
    icon: '🧩',
    overview: 'Schema Library lets you create, manage, and deploy structured data (schema markup) to help search engines better understand your client\'s content and earn rich results.',
    steps: [
      { step: 1, title: 'Browse Templates', desc: 'Choose from pre-built templates: LocalBusiness, FAQ, Product, Article, Review, etc.' },
      { step: 2, title: 'Fill in Details', desc: 'Fill in the schema fields with the client\'s specific information (name, address, review rating, etc.).' },
      { step: 3, title: 'Validate Schema', desc: 'Click "Validate" to ensure the generated JSON-LD is error-free before deploying.' },
      { step: 4, title: 'Copy JSON-LD', desc: 'Copy the generated JSON-LD code and paste it into the <head> section of the client\'s website.' },
      { step: 5, title: 'Test in Google Rich Results', desc: 'Use Google\'s Rich Results Test tool to confirm the schema is parsed correctly.' },
    ],
    tips: [
      'LocalBusiness schema is the highest priority for local SEO clients.',
      'FAQ schema can win FAQ rich results in Google SERPs — increasing CTR significantly.',
      'Never add schema for content that doesn\'t exist on the page.',
    ],
  },
  '/thedal/seo-audit': {
    title: 'All-in-One SEO Audit',
    icon: '🔬',
    overview: 'Run a comprehensive automated SEO audit on any website. Covers On-Page, Technical, Off-Page, and Local SEO signals with an overall health score.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'Select the active client so the audit results are saved to their profile in the database.' },
      { step: 2, title: 'Enter Website URL', desc: 'Type the full website URL to audit (e.g., https://example.com).' },
      { step: 3, title: 'Run Full SEO Audit', desc: 'Click "Run Full SEO Audit". The system fetches and analyses the page HTML, technical signals, and local SEO indicators.' },
      { step: 4, title: 'Review Scores', desc: 'Review the Overall Health Score (A–F grade) and the individual scores for On-Page, Technical, and Local SEO.' },
      { step: 5, title: 'Complete Off-Page Checklist', desc: 'Manually tick off the Backlink Submission tasks you\'ve completed — this directly updates the Off-Page score.' },
      { step: 6, title: 'Download PDF Report', desc: 'Click "Download as PDF" to generate and download the full audit report to share with the client.' },
    ],
    tips: [
      'Audit the client\'s website at the start of engagement as a baseline.',
      'Re-audit every month to track improvement progress.',
      'Prioritise "failed" and "warning" items from the On-Page checks first — they have the most impact.',
    ],
  },
  '/thedal/content-factory#blog-drafts': {
    title: 'Content Factory — Blog Drafts',
    icon: '✍️',
    overview: 'Generates a complete, publication-ready SEO blog post from a single target keyword — tag pill, lead paragraph, sub-sectioned blocks, an optional comparison table, a callout, an FAQ accordion and a closing CTA, all in one AI call.',
    steps: [
      { step: 1, title: 'Enter Target Keyword', desc: 'The one keyword this post should rank for, e.g. "hire digital marketing staff" — everything the AI writes is built around this.' },
      { step: 2, title: 'Set Language, Word Count & Tone', desc: 'Language Style (English / Tamil / Tanglish), target Word Count, and Tone of Voice (professional, friendly, academic, sales-oriented).' },
      { step: 3, title: 'Generate Post', desc: 'Click "Generate Post." The AI writes title, meta description, and the full structured body in one pass.' },
      { step: 4, title: 'Review the Preview', desc: 'The result panel shows title, meta description, word count, reading time, and the rendered HTML — check it before using it live.' },
      { step: 5, title: 'Find It in Saved Drafts', desc: 'Every generation is auto-saved as a Draft in the calendar list on the right. Change its status (Draft / Scheduled / Published) from the dropdown there.' },
    ],
    tips: [
      'Always review AI content before publishing — check facts, local details, and that no invented statistics or fake examples slipped in.',
      'A comparison table only appears when it\'s genuinely relevant to the topic — its absence is expected, not a bug.',
      'Use Gap Hunter or Keyword Tracking keywords as the target keyword here for maximum strategic value.',
    ],
  },
  '/thedal/content-factory#meta-rewriter': {
    title: 'Content Factory — Meta Rewriter',
    icon: '🪄',
    overview: 'Fixes an EXISTING page\'s search-result snippet — not a blog generator. Rewrites a page\'s title and meta description to be more click-worthy and keyword-optimized, with length checks so nothing gets cut off in Google.',
    steps: [
      { step: 1, title: 'Paste the Page URL', desc: 'The real, already-live page you want to improve, e.g. https://example.com/services/root-canal.' },
      { step: 2, title: 'Paste Current Title & Meta Description', desc: 'Copy the page\'s existing <title> and meta description exactly as they are now, so the AI has a starting point to improve on.' },
      { step: 3, title: 'Enter Target Keyword', desc: 'The keyword this page should rank for — the AI works it into the new title and description.' },
      { step: 4, title: 'Optimize Meta Tags', desc: 'Click "Optimize Meta Tags." Get back a new title (~50-60 chars) and meta description (~150-160 chars), plus a one-line explanation of what changed and why.' },
    ],
    tips: [
      'This tool only rewrites metadata — it does not touch the page\'s actual body content.',
      'Use it on pages that already rank but have a weak or generic snippet in search results, not brand-new pages.',
    ],
  },
  '/thedal/content-factory#topic-ideas': {
    title: 'Content Factory — Topic Ideas',
    icon: '💡',
    overview: 'A content-planning brainstorm tool, not a writer. Live-crawls the selected client\'s actual website (homepage + a few internal pages) and returns blog title ideas grounded in what the business genuinely offers — feed these into Blog Drafts next.',
    steps: [
      { step: 1, title: 'Pick a Target Month', desc: 'Which month these ideas are being planned for — shown on each generated topic.' },
      { step: 2, title: 'Click Get Topic Ideas', desc: 'The AI first crawls the client\'s live domain (up to ~4 pages, skipping login/legal pages), then generates ideas grounded in that real content plus any tracked SEO keywords.' },
      { step: 3, title: 'Check the "Grounded in..." Badge', desc: 'A green badge confirms how many live pages were actually crawled. An amber badge means the site couldn\'t be reached and ideas fell back to the stored business profile instead — treat those more skeptically.' },
      { step: 4, title: 'Read "Based on"', desc: 'Each idea card shows which real page or service it was grounded in — use this to sanity-check the idea is actually relevant before writing it.' },
      { step: 5, title: 'Take a Title into Blog Drafts', desc: 'Copy a promising title/keyword pair over to the Blog Drafts tab to generate the full post.' },
    ],
    tips: [
      'If every idea looks generic, check the site-analyzed badge first — it likely means the crawl failed and it\'s working off the stored category only.',
      'Ideas referencing "Based on" a page not actually relevant to a blog post are still worth a manual read before discarding.',
    ],
  },
  '/thedal/content-factory#schema-library': {
    title: 'Content Factory — Schema Library',
    icon: '</>',
    overview: 'Generates JSON-LD structured data — the invisible markup search engines use for rich results (star ratings, FAQ dropdowns, business info in Search). This produces SEO markup, not visible page content.',
    steps: [
      { step: 1, title: 'Pick a Schema Type', desc: 'LocalBusiness, FAQPage, BreadcrumbList, Product, Organization, or Article — pick the one matching the page you\'re adding markup to.' },
      { step: 2, title: 'Generate Schema', desc: 'Click "Generate." The template is pre-filled using the client\'s real business name, domain, and location from their profile.' },
      { step: 3, title: 'Copy and Paste', desc: 'Copy the resulting JSON and paste it inside a <script type="application/ld+json"> tag in the target page\'s <head>.' },
      { step: 4, title: 'Fill In Placeholders', desc: 'FAQPage and similar templates include placeholder answers ("Add your answer here.") — replace these with real content before publishing.' },
    ],
    tips: [
      'Never publish a placeholder answer as-is — Google can penalize structured data that doesn\'t match the visible page content.',
      'Validate the output in Google\'s Rich Results Test before deploying to production.',
    ],
  },
  '/thedal': {
    title: 'Thedal HQ',
    icon: '🏁',
    overview: 'Thedal HQ is your command center for SEO operations — review high-level health metrics, run scans, and jump into any specialized module.',
    steps: [
      { step: 1, title: 'Review Key Metrics', desc: 'Scan the dashboard for overall keyword tracking, client health, and performance trends at a glance.' },
      { step: 2, title: 'Run Global Scan', desc: 'Use the global scan action to refresh primary SEO snapshots and surface potential issues across clients.' },
      { step: 3, title: 'Open Specialized Modules', desc: 'Use the menu to navigate to keyword tracking, backlink analysis, local SEO, and other Thedal tools.' },
      { step: 4, title: 'Validate Client Insights', desc: 'Check the recent rank movements and client health cards to prioritise the next strategic actions.' },
      { step: 5, title: 'Share Findings', desc: 'Use the summary view to communicate key wins and opportunities with stakeholders.' },
    ],
    tips: [
      'Use Thedal HQ as the first stop for daily SEO reviews.',
      'Look for any sudden drops or spikes in rank change before drilling into specific modules.',
    ],
  },
  '/thedal/clients': {
    title: 'Client Onboard',
    icon: '🤝',
    overview: 'Manage client onboarding and profiles for Thedal services. Add new clients, assign plans, and update contact and billing details.',
    steps: [
      { step: 1, title: 'Collect Client Details', desc: 'Enter the client name, business details, domain, and contact information into the onboarding form.' },
      { step: 2, title: 'Assign a Plan', desc: 'Select a Thedal plan or package for the client based on their SEO needs.' },
      { step: 3, title: 'Save the Client Profile', desc: 'Submit the form to save the client record and make it available across the platform.' },
      { step: 4, title: 'Review Client List', desc: 'Use the client list to edit existing clients, view plan details, or remove outdated records.' },
      { step: 5, title: 'Re-run Client Refresh', desc: 'Reload the client data to confirm that the new profile and plan are linked correctly.' },
    ],
    tips: [
      'Ensure the domain is normalized (no http:// or trailing slash) before saving.',
      'Keep the client business category consistent for reporting and filtering.',
    ],
  },
  '/thedal/plans': {
    title: 'Plan Management',
    icon: '📦',
    overview: 'Create and manage Thedal service plans, package features, and pricing tiers for SEO clients.',
    steps: [
      { step: 1, title: 'Review Existing Plans', desc: 'Check the current plan catalog to see what services and pricing are already available.' },
      { step: 2, title: 'Add or Edit Plans', desc: 'Create a new plan or modify an existing one to reflect updated offerings or features.' },
      { step: 3, title: 'Set Subscription Terms', desc: 'Define the monthly or yearly billing terms and any included usage limits.' },
      { step: 4, title: 'Save Changes', desc: 'Save plan updates and validate that they appear correctly in the client onboarding and subscription modules.' },
      { step: 5, title: 'Verify Client Assignment', desc: 'Confirm that clients are assigned to the correct plan after any modifications.' },
    ],
    tips: [
      'Keep plan names short but descriptive so team members can quickly understand what each package includes.',
      'Use consistent feature naming across plans to avoid confusion during client onboarding.',
    ],
  },
  '/thedal/plan-subscription': {
    title: 'Plan Subscription',
    icon: '🧾',
    overview: 'Manage client subscriptions, billing status, and plan renewals for Thedal SEO services.',
    steps: [
      { step: 1, title: 'Select the Client', desc: 'Choose the client whose subscription details you want to review or update.' },
      { step: 2, title: 'Review Plan Details', desc: 'Confirm the current plan, pricing, and subscription cycle for the selected client.' },
      { step: 3, title: 'Update Billing', desc: 'Change plan status, renewals, or payment method information as needed.' },
      { step: 4, title: 'Save the Subscription', desc: 'Persist the subscription update to ensure the client remains on the correct plan.' },
      { step: 5, title: 'Confirm Status', desc: 'Verify that the client subscription is active and that renewal reminders are scheduled.' },
    ],
    tips: [
      'Review upcoming renewals weekly to prevent accidental service lapses.',
      'Keep a note of any custom client agreements or discounts tied to the subscription.',
    ],
  },
  '/thedal/on-page-audit': {
    title: 'On-Page Audit',
    icon: '🔬',
    overview: 'Run a page-level SEO audit to identify technical and on-page issues that impact search engine visibility.',
    steps: [
      { step: 1, title: 'Enter a Page URL', desc: 'Input the full URL of the page to audit and ensure it is the correct canonical version.' },
      { step: 2, title: 'Run the Audit', desc: 'Click the audit action to scan the page for title, meta, heading, content, and structure issues.' },
      { step: 3, title: 'Review Findings', desc: 'Review the audit results and prioritize critical errors first.' },
      { step: 4, title: 'Apply Fixes', desc: 'Update the page content, tags, or technical settings based on the audit recommendations.' },
      { step: 5, title: 'Re-check the Page', desc: 'Run another audit after changes to confirm the issue is resolved.' },
    ],
    tips: [
      'Start with issues marked as "Error" before looking at "Warnings".',
      'Use the copy summary feature to easily paste results into client emails.'
    ]
  },
  '/thedal/competitor-spy': {
    title: 'Competitor Spy',
    icon: '🕵️',
    steps: [
      { step: 1, title: 'Enter Competitor Domain', desc: 'Type a competitor\'s domain name (e.g., competitor.com).' },
      { step: 2, title: 'Run Analysis', desc: 'Click "Analyse" to pull the competitor\'s top keywords, estimated traffic, and high-performing pages.' },
      { step: 3, title: 'Review Top Pages', desc: 'See which pages drive the most traffic for the competitor and what keywords they rank for.' },
      { step: 4, title: 'Analyse Keyword Overlap', desc: 'See where you and the competitor overlap in rankings and where they\'re beating you.' },
      { step: 5, title: 'Export Insights', desc: 'Use the insights to inform your content strategy and identify the gaps to target.' },
    ],
    tips: [
      'Monitor your top 3 competitors at least once per month.',
      'Look for competitor pages with lots of traffic but thin content — these are opportunities to create better resources.',
    ],
  },
  '/thedal/monthly-report': {
    title: 'Monthly PDF Report',
    icon: '📄',
    overview: 'Generate a professional, branded monthly SEO performance report for your client in one click — aggregating data from all modules.',
    steps: [
      { step: 1, title: 'Select a Client', desc: 'The report is client-specific — all data is pulled from the active client\'s profile.' },
      { step: 2, title: 'Review Data Sections', desc: 'The report includes Keyword Rankings, GSC Performance, Backlinks, Local SEO, and On-Page Audit scores.' },
      { step: 3, title: 'Add Executive Summary', desc: 'Write a brief executive summary to personalise the report and highlight key wins/recommendations for the client.' },
      { step: 4, title: 'Copy Summary (optional)', desc: 'Use "Copy Summary" to copy the report text for use in email or a separate document.' },
      { step: 5, title: 'Download PDF', desc: 'Click "Download as PDF" to generate and save the final professional report for client delivery.' },
    ],
    tips: [
      'Send the monthly report by the 5th of each month for the previous month.',
      'Always include a narrative of wins: "Your site moved from position 8 to position 3 for [keyword]."',
      'Frame challenges positively — explain what actions you\'re taking to resolve them.',
    ],
  },
};

export const getSopForPath = (pathname) => {
  // Exact match first
  if (SOP_CONTENT[pathname]) return SOP_CONTENT[pathname];
  // Partial match (e.g. /thedal/seo-audit/something)
  const match = Object.keys(SOP_CONTENT).find(key => pathname.startsWith(key));
  return match ? SOP_CONTENT[match] : null;
};
