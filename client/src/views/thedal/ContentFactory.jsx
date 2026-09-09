import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import SopModal from '../../components/common/SopModal.jsx';
import { getSopForPath } from '../../constants/sopContent.js';
import { C } from '../../constants/theme.js';
import { Sparkles, Copy, Check, FileText, Wand2, Lightbulb, Code2, Loader2, Building, Calendar, Globe, Eye, ChevronDown, ChevronUp, ChevronRight, CheckCircle2, Download, ImagePlus } from 'lucide-react';
import { api } from '../../services/api.js';
import { useClient } from '../../contexts/ClientContext.jsx';
import toast from 'react-hot-toast';

const TABS = ["Blog Drafts", "Meta Rewriter", "Topic Ideas", "Schema Library"];
const TAB_SOP_KEYS = ["/thedal/content-factory#blog-drafts", "/thedal/content-factory#meta-rewriter", "/thedal/content-factory#topic-ideas", "/thedal/content-factory#schema-library"];

// Maps a data-field on the rendered preview HTML to the id of the editable
// field in the panel below it — clicking a section in the preview jumps here.
const PREVIEW_FIELD_MAP = {
  title: 'cf-field-title',
  hero: 'cf-field-hero',
  author: 'cf-field-author',
  body: 'cf-field-body',
  blurb: 'cf-field-blurb',
  ctaHeading: 'cf-field-ctaHeading',
  ctaText: 'cf-field-ctaText',
  hashtags: 'cf-field-hashtags',
  date: 'cf-field-date',
};

// Which editor sub-tab each jump target lives on — the Content/Design panels
// are hidden with display:none rather than unmounted (see editSubTab), so
// scrolling/focusing a field on the tab that ISN'T currently visible is a
// silent no-op unless the matching tab is switched to first.
const FIELD_SUBTAB = {
  'cf-field-title': 'content',
  'cf-field-body': 'content',
  'cf-field-hero': 'design',
  'cf-field-author': 'design',
  'cf-field-date': 'design',
  'cf-field-blurb': 'design',
  'cf-field-ctaHeading': 'design',
  'cf-field-ctaText': 'design',
  'cf-field-hashtags': 'design',
};

let sectionKeySeq = 0;
const nextSectionKey = (prefix) => `${prefix}-${Date.now()}-${sectionKeySeq++}`;

// Splits the body HTML into an ordered list of whole-section cards — one row
// per H2 block (heading + its image + text + button, together), plus
// standalone rows for the intro, conclusion, FAQ block and closing CTA. This
// is what makes drag-to-reorder work at all: dragging arbitrary elements
// inside one long scrolling HTML blob (the previous approach) was unreliable,
// but reordering whole rows in a plain list is a well-trodden, robust pattern.
const parseBodySections = (html) => {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<div id="cf-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('cf-root');
  const sections = [];
  let textBuf = [];
  let textGroups = 0;
  const flushText = () => {
    if (!textBuf.length) return;
    textGroups += 1;
    sections.push({ id: nextSectionKey('text'), type: 'text', label: textGroups === 1 ? 'Intro' : 'Extra Text', html: textBuf.map((n) => n.outerHTML).join('') });
    textBuf = [];
  };
  Array.from(root.children).forEach((el) => {
    const h2Text = el.querySelector(':scope > h2')?.textContent?.trim();
    const styleAttr = el.getAttribute('style') || '';
    if (el.querySelector('[data-block-image]')) {
      flushText();
      sections.push({ id: nextSectionKey('section'), type: 'section', label: h2Text || 'Untitled Section', html: el.outerHTML });
    } else if (h2Text === 'Conclusion') {
      flushText();
      sections.push({ id: nextSectionKey('conclusion'), type: 'conclusion', label: 'Conclusion', html: el.outerHTML });
    } else if (h2Text === 'Frequently Asked Questions') {
      flushText();
      sections.push({ id: nextSectionKey('faq'), type: 'faq', label: 'FAQ', html: el.outerHTML });
    } else if (/linear-gradient\(120deg/.test(styleAttr)) {
      flushText();
      sections.push({ id: nextSectionKey('cta'), type: 'cta', label: 'Closing CTA', html: el.outerHTML });
    } else {
      textBuf.push(el);
    }
  });
  flushText();
  return sections;
};

// Pulls the current button label out of a section's html string — used to
// keep the "Button Text" input showing the right value without touching the
// live card DOM on every render.
const extractButtonLabel = (html) => {
  const match = html.match(/data-block-cta[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
};

const SECTION_TYPE_META = {
  text: { icon: '📝' },
  section: { icon: '📚' },
  conclusion: { icon: '✅' },
  faq: { icon: '❓' },
  cta: { icon: '📣' },
};

const BLANK_SECTION_HTML = `
    <div style="margin-top:44px;">
      <h2 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.3;">New Section Heading</h2>
      <div data-block-image="new" style="width:100%;height:220px;border-radius:16px;margin:0 0 20px;border:1px solid #e5e7eb;background:linear-gradient(135deg,#eef2ff,#f3e8ff);display:flex;align-items:center;justify-content:center;color:#818cf8;font-size:13px;font-weight:600;overflow:hidden;text-align:center;padding:12px;">Add an image for this section (1200&times;600 recommended)</div>
      <p style="margin:0 0 20px;color:#374151;">New section text — click to edit.</p>
    </div>`;

const SCHEMA_TYPE_INFO = {
  LocalBusiness: { what: 'Marks this as a real, physical local business — name, address, service area and contact details.', use: 'Powers Google Maps / "near me" / Local Pack results; can show your address & contact directly in search.' },
  FAQPage: { what: 'Marks up a real question-and-answer section already on the page.', use: 'Google can show an expandable FAQ dropdown directly under your search result — more space, more clicks, no ad spend.' },
  BreadcrumbList: { what: "Describes a page's navigation path (Home > Services > This Page).", use: 'Google shows this breadcrumb trail instead of a raw URL, and understands your site structure better.' },
  Product: { what: 'Marks a specific product or paid service — name, price, availability.', use: 'Can trigger rich results showing price/stock directly in search — for a real pricing or service page.' },
  Organization: { what: 'Your business as an entity — official name, logo, and verified social profiles.', use: 'Helps Google build a Knowledge Panel and correctly link your real social accounts to your brand.' },
  Article: { what: 'A blog post or news piece — headline, author, publish date.', use: 'Tells Google this is an article, not a static page; needed for author/date display and some article rich results.' },
};

const SCHEMA_FIELDS = {
  LocalBusiness: [
    { key: 'name', label: 'Business Name', type: 'text', example: 'e.g. Bmtechx Digital Solutions' },
    { key: 'streetAddress', label: 'Street Address', type: 'text', example: 'e.g. 12 MG Road, Muthialpet' },
    { key: 'addressLocality', label: 'City / Locality', type: 'text', example: 'e.g. Pondicherry' },
    { key: 'addressRegion', label: 'State', type: 'text', example: 'e.g. Puducherry' },
    { key: 'postalCode', label: 'PIN Code', type: 'text', example: 'e.g. 605001' },
    { key: 'telephone', label: 'Phone Number', type: 'text', example: 'e.g. +91 98765 43210' },
    { key: 'priceRange', label: 'Price Range (e.g. ₹₹)', type: 'text', example: 'e.g. ₹₹' },
  ],
  FAQPage: [{ key: 'faqs', label: 'Questions & Answers', type: 'faqList' }],
  BreadcrumbList: [{ key: 'crumbs', label: 'Page Path (Home → … → This Page)', type: 'breadcrumbList' }],
  Product: [
    { key: 'name', label: 'Product / Service Name', type: 'text', example: 'e.g. Website Design Package' },
    { key: 'description', label: 'Description', type: 'textarea', example: 'e.g. A complete 5-page business website with on-page SEO setup and 1 year of hosting.' },
    { key: 'price', label: 'Price (INR)', type: 'text', example: 'e.g. 15000' },
    { key: 'availability', label: 'Availability', type: 'select', options: ['InStock', 'OutOfStock', 'PreOrder'] },
  ],
  Organization: [
    { key: 'name', label: 'Organization Name', type: 'text', example: 'e.g. Bmtechx Digital Solutions' },
    { key: 'logoUrl', label: 'Logo URL', type: 'text', example: 'e.g. https://bmtechx.in/logo.png' },
    { key: 'socialLinks', label: 'Social Profile URLs (one per line)', type: 'textarea', example: 'e.g. https://facebook.com/bmtechx\nhttps://instagram.com/bmtechx' },
  ],
  Article: [
    { key: 'headline', label: 'Headline', type: 'text', example: 'e.g. 5 SEO Tips for Local Businesses in 2026' },
    { key: 'authorName', label: 'Author Name', type: 'text', example: 'e.g. Bmtechx Team' },
    { key: 'datePublished', label: 'Date Published', type: 'date' },
    { key: 'imageUrl', label: 'Featured Image URL', type: 'text', example: 'e.g. https://bmtechx.in/blog/hero.jpg' },
  ],
};

const SCHEMA_BLANK_DATA = {
  LocalBusiness: { name: '', streetAddress: '', addressLocality: '', addressRegion: '', postalCode: '', telephone: '', priceRange: '' },
  FAQPage: { faqs: [{ question: '', answer: '' }] },
  BreadcrumbList: { crumbs: [{ name: 'Home', url: '' }, { name: '', url: '' }] },
  Product: { name: '', description: '', price: '', availability: 'InStock' },
  Organization: { name: '', logoUrl: '', socialLinks: '' },
  Article: { headline: '', authorName: '', datePublished: '', imageUrl: '' },
};
const SCHEMA_TYPES = ["LocalBusiness", "FAQPage", "BreadcrumbList", "Product", "Organization", "Article"];

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button 
      onClick={copy} 
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        background: C.dim,
        border: `1px solid ${C.border}`,
        color: C.text,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = C.muted; }}
      onMouseOut={(e) => { e.currentTarget.style.background = C.dim; }}
    >
      {copied ? <><Check size={12} color={C.green} />Copied!</> : <><Copy size={12} />Copy</>}
    </button>
  );
}

export default function ContentFactory() {
  const { activeClient } = useClient();
  const [activeTab, setActiveTab] = useState(0);

  // Blog Tab State
  const [drafts, setDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);
  const [blogForm, setBlogForm] = useState({ keyword: '', language: 'english', wordCount: 800, tone: 'professional' });
  const [blogResult, setBlogResult] = useState(null);
  const [genLoading, setGenLoading] = useState(false);
  const [pageOverrides, setPageOverrides] = useState({ heroImageUrl: '', authorName: '', sidebarBlurb: '', ctaHeading: '', ctaText: '', hashtags: '', postDate: '' });
  const [suggestingBlurb, setSuggestingBlurb] = useState(false);
  const [updatingPreview, setUpdatingPreview] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [editSubTab, setEditSubTab] = useState('content');
  const [bodySections, setBodySections] = useState([]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState(() => new Set());
  const previewIframeRef = useRef(null);
  const cardRefs = useRef({});
  const blockImageFileInputRef = useRef(null);
  const pendingImageCardIdRef = useRef(null);
  const dragSectionIndexRef = useRef(null);

  // Meta Rewriter State
  const [metaForm, setMetaForm] = useState({ pageUrl: '', currentTitle: '', currentMeta: '', targetKeyword: '' });
  const [metaResult, setMetaResult] = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);

  // Topic Ideas State
  const [topicMonth, setTopicMonth] = useState(new Date().toISOString().slice(0, 7));
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [siteAnalyzed, setSiteAnalyzed] = useState(null);

  // Inline SOP panel State
  const [sopCollapsed, setSopCollapsed] = useState(false);

  // Schema State
  const [schemaType, setSchemaType] = useState('LocalBusiness');
  const [schemaData, setSchemaData] = useState(SCHEMA_BLANK_DATA.LocalBusiness);
  const [schemaFoundFields, setSchemaFoundFields] = useState([]);
  const [schemaSiteAnalyzed, setSchemaSiteAnalyzed] = useState(null);
  const [schemaResult, setSchemaResult] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaPrefilling, setSchemaPrefilling] = useState(false);

  // Fetch drafts
  const fetchDrafts = async () => {
    if (!activeClient?.id) return;
    setDraftsLoading(true);
    try {
      const res = await api.get(`/thedal/content/${activeClient.id}`);
      setDrafts(res.content || []);
    } catch (err) {
      console.error('Failed to fetch content calendar:', err);
    } finally {
      setDraftsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, [activeClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kw = params.get('keyword');
    if (kw) {
      setBlogForm(prev => ({ ...prev, keyword: kw }));
      // Clean query parameters from address bar to avoid duplicate initialization
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleGenerateBlog = async () => {
    if (!blogForm.keyword.trim()) {
      toast.error('Please enter a target keyword');
      return;
    }
    setGenLoading(true);
    setBlogResult(null);
    setPageOverrides({ heroImageUrl: '', authorName: '', sidebarBlurb: '', ctaHeading: '', ctaText: '', hashtags: '', postDate: '' });
    setEditSubTab('content');
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/generate-blog`, blogForm);
      setBlogResult(res.post);
      setBodySections(parseBodySections(res.post.content));
      setCollapsedSectionIds(new Set());
      toast.success('Blog post generated successfully!');
      fetchDrafts(); // Reload saved drafts list
    } catch (err) {
      toast.error(err.message || 'Generation failed');
    } finally {
      setGenLoading(false);
    }
  };

  const handleLoadDraft = async (id) => {
    try {
      const res = await api.get(`/thedal/content/${activeClient.id}/${id}`);
      const c = res.content;
      setBlogResult({
        id: c.id,
        title: c.title,
        metaDescription: c.meta_description,
        slug: c.slug,
        content: c.body,
        fullPageHtml: c.fullPageHtml,
        jsonLd: c.jsonLd,
        wordCount: c.word_count,
        readingTime: `${Math.round((c.word_count || 800) / 200)} min read`,
        focusKeyword: c.target_keyword,
        secondaryKeywords: [],
        createdAt: c.created_at,
      });
      // Restore whatever was actually saved last — resetting these to blank
      // on load was the bug: the preview would still show the real saved
      // state (rebuilt server-side from the same overrides), but this panel
      // wouldn't, so the next Save & Update Preview silently wiped it back
      // to defaults even though nothing here was touched.
      const savedOverrides = c.overrides || {};
      setPageOverrides({
        heroImageUrl: savedOverrides.heroImageUrl || '',
        authorName: savedOverrides.authorName || '',
        sidebarBlurb: savedOverrides.sidebarBlurb || '',
        ctaHeading: savedOverrides.ctaHeading || '',
        ctaText: savedOverrides.ctaText || '',
        hashtags: savedOverrides.hashtags || '',
        postDate: savedOverrides.postDate || (c.created_at ? new Date(c.created_at).toISOString().slice(0, 10) : ''),
      });
      setBodySections(parseBodySections(c.body));
      setCollapsedSectionIds(new Set());
      setEditSubTab('content');
      setDraftsOpen(false);
      toast.success('Draft loaded');
    } catch (err) {
      toast.error('Failed to load draft');
    }
  };

  const handleHeroImageUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Image is too large — please use one under 3MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPageOverrides(prev => ({ ...prev, heroImageUrl: reader.result }));
      toast.success('Image attached — click Save & Update Preview to apply');
    };
    reader.onerror = () => toast.error('Failed to read image file');
    reader.readAsDataURL(file);
  };

  // The flattened body HTML sent to the backend/preview — kept in sync with
  // bodySections instead of being separately edited, so there's one source
  // of truth for "what does the article actually say right now".
  const liveBodyHtml = useMemo(() => bodySections.map((s) => s.html).join(''), [bodySections]);

  const updateSectionHtml = (id, html) => {
    setBodySections((prev) => prev.map((s) => (s.id === id ? { ...s, html } : s)));
  };

  // Every card's contentEditable region is captured on blur — reads the live
  // DOM back into that one section's html rather than the whole article.
  const handleCardBlur = (id) => () => {
    const el = cardRefs.current[id];
    if (el) updateSectionHtml(id, el.innerHTML);
  };

  // Wires click-to-upload on each card's image slot(s) whenever the section
  // list changes. Scoped per card instead of one global container — this is
  // what makes the drag/click conflict from the old single-blob editor go
  // away: each card's drag handle lives in its own header bar, entirely
  // separate from the content area, so there's no ambiguity for the browser.
  useEffect(() => {
    bodySections.forEach((s) => {
      const el = cardRefs.current[s.id];
      if (!el) return;
      el.querySelectorAll('[data-block-image]').forEach((img) => {
        img.onclick = () => {
          pendingImageCardIdRef.current = s.id;
          blockImageFileInputRef.current?.click();
        };
      });
    });
  }, [bodySections]);

  const handleBlockImageFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const cardId = pendingImageCardIdRef.current;
    const container = cardId && cardRefs.current[cardId];
    if (!file || !container) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Image is too large — please use one under 3MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const slot = container.querySelector('[data-block-image]');
      if (!slot) return;
      slot.innerHTML = '';
      const img = document.createElement('img');
      img.src = reader.result;
      img.alt = 'Section image';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      slot.appendChild(img);
      updateSectionHtml(cardId, container.innerHTML);
      toast.success('Image added — click Save & Update Preview to apply');
    };
    reader.onerror = () => toast.error('Failed to read image file');
    reader.readAsDataURL(file);
  };

  const handleRemoveCardImage = (id) => {
    const el = cardRefs.current[id];
    const slot = el?.querySelector('[data-block-image]');
    if (!slot) return;
    slot.remove();
    updateSectionHtml(id, el.innerHTML);
  };

  const handleRemoveCardButton = (id) => {
    const el = cardRefs.current[id];
    const btn = el?.querySelector('[data-block-cta]');
    if (!btn) return;
    btn.remove();
    updateSectionHtml(id, el.innerHTML);
  };

  // Editing a button's label by clicking directly into the rendered pill
  // isn't obvious, so it also gets an explicit "Button Text" input like every
  // other field — this writes straight into the live card DOM, same as the
  // image/paragraph handlers above.
  const handleUpdateButtonLabel = (id, newLabel) => {
    const el = cardRefs.current[id];
    const link = el?.querySelector('[data-block-cta] a');
    if (!link) return;
    link.textContent = newLabel;
    updateSectionHtml(id, el.innerHTML);
  };

  const handleAddCardImage = (id) => {
    const el = cardRefs.current[id];
    if (!el || el.querySelector('[data-block-image]')) return;
    const key = nextSectionKey('img');
    el.insertAdjacentHTML('beforeend', `<div data-block-image="${key}" style="width:100%;height:220px;border-radius:16px;margin:12px 0 0;border:1px solid #e5e7eb;background:linear-gradient(135deg,#eef2ff,#f3e8ff);display:flex;align-items:center;justify-content:center;color:#818cf8;font-size:13px;font-weight:600;overflow:hidden;text-align:center;padding:12px;">Add an image for this section (1200&times;600 recommended)</div>`);
    updateSectionHtml(id, el.innerHTML);
  };

  const handleAddCardButton = (id) => {
    const el = cardRefs.current[id];
    if (!el || el.querySelector('[data-block-cta]')) return;
    const phoneDigits = String(activeClient?.phone || '').replace(/\D/g, '');
    const ctaHref = phoneDigits ? `https://wa.me/${phoneDigits}` : '#contact';
    el.insertAdjacentHTML('beforeend', `<div data-block-cta="${nextSectionKey('btn')}" style="text-align:center;margin-top:16px;"><a href="${ctaHref}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:80px;min-height:1em;background:#4338ca;color:#fff;font-weight:700;font-size:13px;padding:12px 28px;border-radius:100px;text-decoration:none;">New Button</a></div>`);
    updateSectionHtml(id, el.innerHTML);
  };

  const handleAddCardParagraph = (id) => {
    const el = cardRefs.current[id];
    if (!el) return;
    el.insertAdjacentHTML('beforeend', `<p style="margin:12px 0 0;color:#374151;">New paragraph — click to edit this text.</p>`);
    updateSectionHtml(id, el.innerHTML);
  };

  const handleRemoveSection = (id) => {
    setBodySections((prev) => prev.filter((s) => s.id !== id));
  };

  // New sections land just before the Conclusion/FAQ/CTA rows (or at the end
  // if none exist yet) so they stay part of the main article body.
  const handleAddNewSection = () => {
    setBodySections((prev) => {
      const newSection = { id: nextSectionKey('section'), type: 'section', label: 'New Section Heading', html: BLANK_SECTION_HTML };
      const tailIndex = prev.findIndex((s) => s.type === 'conclusion' || s.type === 'faq' || s.type === 'cta');
      if (tailIndex === -1) return [...prev, newSection];
      const next = [...prev];
      next.splice(tailIndex, 0, newSection);
      return next;
    });
  };

  const toggleSectionCollapsed = (id) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Whole-section drag reordering — simple array-index swap between list
  // rows, which is far more reliable than the previous approach of dragging
  // arbitrary elements around inside one long scrolling HTML blob.
  const handleSectionDragStart = (index) => (e) => {
    dragSectionIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'section-reorder'); } catch { /* Firefox requires setData to start a drag */ }
  };
  const handleSectionDragOver = (e) => { e.preventDefault(); };
  const handleSectionDrop = (index) => (e) => {
    e.preventDefault();
    const from = dragSectionIndexRef.current;
    dragSectionIndexRef.current = null;
    if (from === null || from === index) return;
    setBodySections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
  };

  // Wires up click-to-jump: elements in the rendered preview carry a
  // data-field attribute; clicking one scrolls to and focuses the matching
  // editable input in the panel below, with a brief highlight flash.
  const handlePreviewLoad = () => {
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc) return;
    doc.querySelectorAll('[data-field]').forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        const fieldId = PREVIEW_FIELD_MAP[el.getAttribute('data-field')];
        if (!fieldId) return;
        const subtab = FIELD_SUBTAB[fieldId];
        if (subtab) setEditSubTab(subtab);
        // Wait a frame for the tab switch to actually render before the
        // target field exists in a visible (non display:none) layout box —
        // scrollIntoView/focus on a hidden element is otherwise a no-op.
        requestAnimationFrame(() => {
          const target = document.getElementById(fieldId);
          if (!target) return;
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.focus();
          target.style.transition = 'box-shadow 0.2s ease';
          target.style.boxShadow = `0 0 0 3px ${C.accent}66`;
          setTimeout(() => { target.style.boxShadow = 'none'; }, 1200);
        });
      };
    });
  };

  const handleSuggestBlurb = async () => {
    if (!blogResult) return;
    setSuggestingBlurb(true);
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/suggest-sidebar-blurb`, { title: blogResult.title, keyword: blogResult.focusKeyword });
      setPageOverrides({ ...pageOverrides, sidebarBlurb: res.blurb });
      toast.success('AI suggestion added — edit it below if needed');
    } catch (err) {
      toast.error(err.message || 'Failed to get AI suggestion');
    } finally {
      setSuggestingBlurb(false);
    }
  };

  const handleUpdatePreview = async () => {
    if (!blogResult) return;
    setUpdatingPreview(true);
    try {
      const dateLabel = pageOverrides.postDate
        ? new Date(`${pageOverrides.postDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : undefined;
      const res = await api.post(`/thedal/content/${activeClient.id}/render-preview`, {
        id: blogResult.id,
        title: blogResult.title,
        metaDescription: blogResult.metaDescription,
        leadParagraph: pageOverrides.sidebarBlurb || blogResult.metaDescription,
        bodyHtml: liveBodyHtml,
        slug: blogResult.slug,
        createdAt: pageOverrides.postDate || blogResult.createdAt,
        overrides: { ...pageOverrides, dateLabel },
      });
      setBlogResult({ ...blogResult, fullPageHtml: res.fullPageHtml, jsonLd: res.jsonLd });
      toast.success(res.saved ? 'Saved — preview updated' : 'Preview updated (not saved — no draft id)');
      if (res.saved) fetchDrafts();
    } catch (err) {
      toast.error(err.message || 'Failed to update preview');
    } finally {
      setUpdatingPreview(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!blogResult?.fullPageHtml) return;
    try {
      const zip = new JSZip();
      const styleMatch = blogResult.fullPageHtml.match(/<style>([\s\S]*?)<\/style>/);
      const css = styleMatch ? styleMatch[1].trim() : '';
      const html = blogResult.fullPageHtml
        .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="style.css">')
        .replace('</body>', '<script src="script.js"></script>\n</body>');
      zip.file('index.html', html);
      zip.file('style.css', css);
      zip.file('script.js', '// No JavaScript is required for this static page — the FAQ accordion uses native <details>/<summary>.\n// Add analytics or interactivity here if needed.\n');
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${blogResult.slug || 'blog-post'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Downloaded — index.html, style.css, script.js');
    } catch (err) {
      toast.error('Failed to build the ZIP file');
    }
  };

  const handleRewriteMeta = async () => {
    if (!metaForm.targetKeyword.trim()) {
      toast.error('Please enter a target keyword');
      return;
    }
    setMetaLoading(true);
    setMetaResult(null);
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/rewrite-meta`, metaForm);
      setMetaResult(res.result);
      toast.success('Meta tags rewritten!');
    } catch (err) {
      toast.error(err.message || 'Meta rewrite failed');
    } finally {
      setMetaLoading(false);
    }
  };

  const handleGetTopics = async () => {
    setTopicsLoading(true);
    setTopics([]);
    setSiteAnalyzed(null);
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/topic-ideas`, { month: topicMonth, count: 8 });
      setTopics(res.ideas?.topics || []);
      setSiteAnalyzed(res.siteAnalyzed || null);
      toast.success(res.siteAnalyzed ? `Analyzed ${res.siteAnalyzed.pagesCrawled} live page(s) on ${res.siteAnalyzed.origin}` : 'Topic ideas generated!');
    } catch (err) {
      toast.error(err.message || 'Failed to fetch topic ideas');
    } finally {
      setTopicsLoading(false);
    }
  };

  const handleSelectSchemaType = (type) => {
    setSchemaType(type);
    setSchemaData(SCHEMA_BLANK_DATA[type]);
    setSchemaFoundFields([]);
    setSchemaSiteAnalyzed(null);
    setSchemaResult(null);
  };

  const handleAutoFillSchema = async () => {
    setSchemaPrefilling(true);
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/schema/prefill`, { schemaType });
      setSchemaData({ ...SCHEMA_BLANK_DATA[schemaType], ...res.data });
      setSchemaFoundFields(res.foundFields || []);
      setSchemaSiteAnalyzed(res.siteAnalyzed || null);
      toast.success(res.siteAnalyzed ? `Analyzed ${res.siteAnalyzed.pagesCrawled} live page(s) — filled ${res.foundFields?.length || 0} field(s) from real content` : 'Auto-fill attempted, but the site could not be reached');
    } catch (err) {
      toast.error(err.message || 'Auto-fill failed');
    } finally {
      setSchemaPrefilling(false);
    }
  };

  const handleGenerateSchema = async () => {
    setSchemaLoading(true);
    setSchemaResult(null);
    try {
      const res = await api.post(`/thedal/content/${activeClient.id}/schema`, { schemaType, data: schemaData });
      setSchemaResult(res.schema?.jsonLd);
      toast.success(`${schemaType} Schema generated!`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate schema');
    } finally {
      setSchemaLoading(false);
    }
  };

  const handleUpdateStatus = async (draftId, newStatus) => {
    try {
      await api.put(`/thedal/content/${activeClient.id}/${draftId}/status`, { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
      fetchDrafts();
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  if (!activeClient) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.text, padding: 30 }}>
        <div style={{ textAlign: 'center', maxWidth: 450, background: C.surface, border: `1px solid ${C.border}`, padding: 40, borderRadius: 16, boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
          <Building size={48} color={C.accent} style={{ marginBottom: 20 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, fontFamily: "'Syne', sans-serif" }}>No Active Client Selected</h2><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }}>
            Please select an active client from the client selector in the sidebar or onboard a new client to access the Content Factory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '30px 40px', color: C.text, height: '100%', overflowY: 'auto', background: C.bg }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#f8fafc', margin: 0, fontFamily: "'Syne', sans-serif" }}>Content Factory</h1>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 6 }}>
            AI-powered content writer and calendar optimization for <strong style={{ color: C.accent }}>{activeClient.business_name || activeClient.domain}</strong>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, width: 'fit-content', marginBottom: 30, flexWrap: 'wrap' }}>
        {TABS.map((t, i) => (
          <button 
            key={i} 
            onClick={() => setActiveTab(i)}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab === i ? C.accent : 'transparent',
              color: activeTab === i ? '#fff' : C.text,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {i === 0 && <FileText size={16} />}
              {i === 1 && <Wand2 size={16} />}
              {i === 2 && <Lightbulb size={16} />}
              {i === 3 && <Code2 size={16} />}
              {t}
            </div>
          </button>
        ))}
      </div>

      {/* Inline SOP panel — always visible on the page, not a popup */}
      {(() => {
        const activeSop = getSopForPath(TAB_SOP_KEYS[activeTab]);
        if (!activeSop) return null;
        return (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 24, overflow: 'hidden' }}>
            <div
              onClick={() => setSopCollapsed(c => !c)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', background: 'rgba(37,99,235,0.06)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>{activeSop.icon}</span>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1 }}>SOP Guide</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{activeSop.title}</div>
                </div>
              </div>
              {sopCollapsed ? <ChevronDown size={18} color={C.muted} /> : <ChevronUp size={18} color={C.muted} />}
            </div>
            {!sopCollapsed && (
              <div style={{ padding: '18px 20px' }}>
                <p style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.6, margin: '0 0 18px' }}>{activeSop.overview}</p>

                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Step-by-Step Procedure</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10, marginBottom: 18 }}>
                  {activeSop.steps.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg, #2563eb, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                        {s.step}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                          <ChevronRight size={12} color="#2563eb" />
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#f0f6fc' }}>{s.title}</span>
                        </div>
                        <p style={{ fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {activeSop.tips?.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>💡 Pro Tips</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {activeSop.tips.map((tip, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <CheckCircle2 size={13} color="#22c55e" style={{ flexShrink: 0, marginTop: 2 }} />
                          <p style={{ fontSize: 12, color: '#c9d1d9', margin: 0, lineHeight: 1.5 }}>{tip}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Main Tab Area */}
      <div style={{ minHeight: 400 }}>
        {/* Tab 0: Blog Drafts */}
        {activeTab === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Compact generate + drafts bar */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 240px', minWidth: 200 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Target Keyword</label>
                  <input
                    type="text"
                    value={blogForm.keyword}
                    onChange={e => setBlogForm({ ...blogForm, keyword: e.target.value })}
                    placeholder="e.g. root canal treatment in Pondicherry"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none' }}
                  />
                </div>
                <div style={{ width: 150 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Language</label>
                  <select value={blogForm.language} onChange={e => setBlogForm({ ...blogForm, language: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                    <option value="english">English (Indian)</option>
                    <option value="tamil">Tamil (தமிழ்)</option>
                    <option value="tanglish">Tanglish</option>
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Words</label>
                  <select value={blogForm.wordCount} onChange={e => setBlogForm({ ...blogForm, wordCount: Number(e.target.value) })} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                    {[600, 800, 1000, 1200, 1500].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div style={{ width: 170 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Tone</label>
                  <select value={blogForm.tone} onChange={e => setBlogForm({ ...blogForm, tone: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                    <option value="professional">Professional</option>
                    <option value="conversational">Friendly & Casual</option>
                    <option value="educational">Academic</option>
                    <option value="persuasive">Sales-oriented</option>
                  </select>
                </div>
                <button
                  onClick={handleGenerateBlog}
                  disabled={genLoading}
                  style={{ background: `linear-gradient(135deg, ${C.accent} 0%, #f43f5e 100%)`, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: genLoading ? 0.6 : 1, whiteSpace: 'nowrap' }}
                >
                  {genLoading ? <><Loader2 size={15} className="spin" /> Writing...</> : <><Sparkles size={15} /> Generate</>}
                </button>
                <button
                  onClick={() => setDraftsOpen(o => !o)}
                  style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}
                >
                  <Calendar size={14} color={C.blue} /> Drafts ({drafts.length}) {draftsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              {draftsOpen && (
                <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                  {draftsLoading ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                      {[...Array(3)].map((_, i) => (
                        <div key={i} style={{ height: 70, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, animation: 'pulse 1.5s infinite' }} />
                      ))}
                    </div>
                  ) : drafts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: C.muted }}>
                      <FileText size={30} style={{ marginBottom: 10, opacity: 0.5 }} />
                      <p style={{ fontSize: 13, margin: 0 }}>No blog drafts created yet.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, maxHeight: 400, overflowY: 'auto', paddingRight: 4 }}>
                      {drafts.map(d => (
                        <div key={d.id} onClick={() => handleLoadDraft(d.id)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer', transition: 'border-color 0.2s' }} onMouseEnter={e => e.currentTarget.style.borderColor = C.accent} onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>
                              {d.title || 'Untitled Draft'}
                            </div>
                            <select
                              value={d.status}
                              onClick={e => e.stopPropagation()}
                              onChange={e => handleUpdateStatus(d.id, e.target.value)}
                              style={{
                                background: d.status === 'published' ? 'rgba(16, 185, 129, 0.1)' : d.status === 'scheduled' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                color: d.status === 'published' ? C.green : d.status === 'scheduled' ? C.blue : C.text,
                                border: `1px solid ${d.status === 'published' ? C.green : d.status === 'scheduled' ? C.blue : C.border}`,
                                borderRadius: 6,
                                padding: '2px 6px',
                                fontSize: 11,
                                fontWeight: 600,
                                outline: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              <option value="draft" style={{ background: C.card, color: C.text }}>Draft</option>
                              <option value="scheduled" style={{ background: C.card, color: C.text }}>Scheduled</option>
                              <option value="published" style={{ background: C.card, color: C.text }}>Published</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: C.muted }}>
                            <span>Keyword: <strong style={{ color: C.text }}>{d.target_keyword || 'None'}</strong></span>
                            <span>{d.language || 'english'} · {d.word_count || 0}w</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!blogResult && (
              <div style={{ textAlign: 'center', padding: '80px 20px', color: C.muted, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
                <FileText size={40} style={{ marginBottom: 14, opacity: 0.5 }} />
                <p style={{ fontSize: 14, margin: 0 }}>Generate a post above, or open a saved draft, to start editing.</p>
              </div>
            )}

            {blogResult && (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 420px', gap: 24, alignItems: 'start' }} className="grid-responsive">
                {/* PREVIEW PANE — sticky so it stays in view while you work through the fields on the right */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 20 }}>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                      <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#f8fafc' }}>{blogResult.title}</h4>
                      <CopyBtn text={blogResult.title} />
                    </div>
                    <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, margin: '0 0 12px 0' }}>{blogResult.metaDescription}</p>
                    <div style={{ display: 'flex', gap: 12, color: C.muted, fontSize: 12, fontWeight: 500 }}>
                      <span>Word Count: <strong>{blogResult.wordCount}</strong></span>
                      <span>•</span>
                      <span>Read Time: <strong>{blogResult.readingTime}</strong></span>
                    </div>
                  </div>
                  {blogResult.fullPageHtml && (
                    <div style={{ background: '#0d1117', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>Live Preview <span style={{ fontWeight: 500, color: C.muted }}>— click a section to jump to its field</span></span>
                        <button
                          onClick={handleDownloadZip}
                          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#fff', border: 0, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Download size={13} /> Download ZIP
                        </button>
                      </div>
                      <iframe
                        ref={previewIframeRef}
                        onLoad={handlePreviewLoad}
                        title="Blog preview"
                        srcDoc={blogResult.fullPageHtml}
                        style={{ width: '100%', height: 700, border: 'none', background: '#fff' }}
                        sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                      />
                    </div>
                  )}
                </div>

                {/* CONTROLS PANE — tabbed instead of one long form */}
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                    {['content', 'design'].map(t => (
                      <button
                        key={t}
                        onClick={() => setEditSubTab(t)}
                        style={{
                          flex: 1,
                          padding: '14px 10px',
                          border: 'none',
                          borderBottom: `2px solid ${editSubTab === t ? C.accent : 'transparent'}`,
                          background: 'transparent',
                          color: editSubTab === t ? '#f8fafc' : C.muted,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {t === 'content' ? 'Content' : 'Design'}
                      </button>
                    ))}
                  </div>

                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 760, overflowY: 'auto' }}>
                    {/* Content: title, meta description, body article */}
                    <div style={{ display: editSubTab === 'content' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Blog Title</label>
                        <input id="cf-field-title" value={blogResult.title || ''} onChange={e => setBlogResult({ ...blogResult, title: e.target.value })} placeholder="Blog post title" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Meta Description</label>
                        <textarea value={blogResult.metaDescription || ''} onChange={e => setBlogResult({ ...blogResult, metaDescription: e.target.value })} placeholder="Search-result description (150-160 chars)" rows={2} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none', resize: 'vertical' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: C.muted }}>Body Content <span style={{ color: C.muted, fontWeight: 400 }}>— drag ⠿ to reorder sections, click a row to expand and edit it</span></span>
                        <CopyBtn text={liveBodyHtml} />
                      </div>
                      <input type="file" ref={blockImageFileInputRef} accept="image/*" onChange={handleBlockImageFile} style={{ display: 'none' }} />
                      <style>{`.cf-section-card [data-block-image] { cursor: pointer; }`}</style>
                      <div id="cf-field-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {bodySections.map((s, index) => {
                          const collapsed = collapsedSectionIds.has(s.id);
                          const hasImage = s.html.includes('data-block-image');
                          const hasButton = s.html.includes('data-block-cta');
                          const miniBtn = { background: 'transparent', border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer' };
                          return (
                            <div
                              key={s.id}
                              onDragOver={handleSectionDragOver}
                              onDrop={handleSectionDrop(index)}
                              style={{ background: '#090d16', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}
                            >
                              <div
                                draggable
                                onDragStart={handleSectionDragStart(index)}
                                onClick={() => toggleSectionCollapsed(s.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: C.card, cursor: 'pointer', userSelect: 'none' }}
                              >
                                <span title="Drag to reorder" style={{ cursor: 'grab', color: C.muted, fontSize: 14 }}>⠿</span>
                                <span style={{ fontSize: 13 }}>{SECTION_TYPE_META[s.type]?.icon}</span>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                                <button onClick={e => { e.stopPropagation(); handleRemoveSection(s.id); }} title="Remove this section" style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 15, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>×</button>
                                {collapsed ? <ChevronDown size={14} color={C.muted} /> : <ChevronUp size={14} color={C.muted} />}
                              </div>
                              {!collapsed && (
                                <div style={{ padding: 14 }}>
                                  {s.type === 'section' && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                                      {hasImage
                                        ? <button onClick={() => handleRemoveCardImage(s.id)} style={miniBtn}>Remove Image</button>
                                        : <button onMouseDown={e => e.preventDefault()} onClick={() => handleAddCardImage(s.id)} style={miniBtn}>+ Image</button>}
                                      {hasButton
                                        ? <button onClick={() => handleRemoveCardButton(s.id)} style={miniBtn}>Remove Button</button>
                                        : <button onMouseDown={e => e.preventDefault()} onClick={() => handleAddCardButton(s.id)} style={miniBtn}>+ Button</button>}
                                      <button onMouseDown={e => e.preventDefault()} onClick={() => handleAddCardParagraph(s.id)} style={miniBtn}>+ Paragraph</button>
                                      {hasButton && (
                                        <>
                                          <label style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>Button Text:</label>
                                          <input
                                            key={`${s.id}-btn-${extractButtonLabel(s.html)}`}
                                            defaultValue={extractButtonLabel(s.html)}
                                            onBlur={e => handleUpdateButtonLabel(s.id, e.target.value)}
                                            style={{ flex: '1 1 140px', minWidth: 100, boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', color: C.text, fontSize: 11, outline: 'none' }}
                                          />
                                        </>
                                      )}
                                    </div>
                                  )}
                                  <div
                                    ref={el => { cardRefs.current[s.id] = el; }}
                                    className="cf-section-card"
                                    contentEditable
                                    suppressContentEditableWarning
                                    onBlur={handleCardBlur(s.id)}
                                    style={{ maxHeight: 320, overflowY: 'auto', fontSize: 14, lineHeight: 1.6, background: '#f9fafb', color: '#1f2937', borderRadius: 8, padding: 14, outline: 'none', cursor: 'text' }}
                                    dangerouslySetInnerHTML={{ __html: s.html }}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                        <button onClick={handleAddNewSection} style={{ background: 'transparent', border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 10, padding: '10px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add Section</button>
                      </div>
                    </div>

                    {/* Design: everything about the page chrome around the article */}
                    <div style={{ display: editSubTab === 'design' ? 'flex' : 'none', flexDirection: 'column', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Hero Image</label>
                        <input id="cf-field-hero" value={pageOverrides.heroImageUrl?.startsWith('data:') ? '' : pageOverrides.heroImageUrl} onChange={e => setPageOverrides({ ...pageOverrides, heroImageUrl: e.target.value })} placeholder="https://... (paste an image URL)" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none', marginBottom: 6 }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px dashed ${C.border}`, color: C.muted, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                            <ImagePlus size={12} /> Upload Image
                            <input type="file" accept="image/*" onChange={handleHeroImageUpload} style={{ display: 'none' }} />
                          </label>
                          {pageOverrides.heroImageUrl && (
                            <>
                              <img src={pageOverrides.heroImageUrl} alt="Hero preview" style={{ height: 26, width: 40, objectFit: 'cover', borderRadius: 4, border: `1px solid ${C.border}` }} />
                              <button onClick={() => setPageOverrides({ ...pageOverrides, heroImageUrl: '' })} title="Remove hero image" style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Author Name</label>
                          <input id="cf-field-author" value={pageOverrides.authorName} onChange={e => setPageOverrides({ ...pageOverrides, authorName: e.target.value })} placeholder={`${activeClient.business_name || activeClient.domain} Team (default)`} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Publish Date</label>
                          <input id="cf-field-date" type="date" value={pageOverrides.postDate} onChange={e => setPageOverrides({ ...pageOverrides, postDate: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none', colorScheme: 'dark' }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <label style={{ fontSize: 11, color: C.muted }}>Sidebar "About" Blurb</label>
                          <button onClick={handleSuggestBlurb} disabled={suggestingBlurb} style={{ background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {suggestingBlurb ? <Loader2 size={10} className="spin" /> : <Sparkles size={10} />} AI Suggest
                          </button>
                        </div>
                        <textarea id="cf-field-blurb" value={pageOverrides.sidebarBlurb} onChange={e => setPageOverrides({ ...pageOverrides, sidebarBlurb: e.target.value })} placeholder="Defaults to the lead paragraph — click AI Suggest for something written fresh for this post" rows={2} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none', resize: 'vertical' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>CTA Card Heading</label>
                        <input id="cf-field-ctaHeading" value={pageOverrides.ctaHeading} onChange={e => setPageOverrides({ ...pageOverrides, ctaHeading: e.target.value })} placeholder="Need help with this? (default)" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>CTA Card Text</label>
                        <input id="cf-field-ctaText" value={pageOverrides.ctaText} onChange={e => setPageOverrides({ ...pageOverrides, ctaText: e.target.value })} placeholder="Chat with us directly... (default)" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 4 }}>Hashtags <span style={{ fontWeight: 400 }}>(space or comma separated)</span></label>
                        <input id="cf-field-hashtags" value={pageOverrides.hashtags} onChange={e => setPageOverrides({ ...pageOverrides, hashtags: e.target.value })} placeholder="#DigitalMarketing #FresherHiring (auto-generated if left blank)" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, background: C.card }}>
                    <button onClick={handleUpdatePreview} disabled={updatingPreview} style={{ width: '100%', background: C.accent, color: '#fff', border: 0, borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {updatingPreview ? <><Loader2 size={13} className="spin" /> Saving...</> : 'Save & Update Preview'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Meta Rewriter */}
        {activeTab === 1 && (
          <div style={{ maxWidth: 700, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}><Wand2 size={20} color={C.accent} /> AI Meta Tag Optimizer</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              {[
                { key: 'pageUrl', label: 'Page URL', placeholder: 'https://example.com/services/root-canal' },
                { key: 'currentTitle', label: 'Current Page Title', placeholder: 'Root Canal Treatment | Dentist Pondicherry' },
                { key: 'currentMeta', label: 'Current Meta Description', placeholder: 'Looking for a dentist? We offer root canals at our clinic. Contact us today.' },
                { key: 'targetKeyword', label: 'Target Keyword', placeholder: 'root canal cost pondicherry' }
              ].map(f => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>{f.label}</label>
                  <input 
                    type="text"
                    value={metaForm[f.key]}
                    onChange={e => setMetaForm({ ...metaForm, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    style={{
                      width: '100%',
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: '12px 16px',
                      color: C.text,
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>

            <button 
              onClick={handleRewriteMeta}
              disabled={metaLoading}
              style={{
                width: 'fit-content',
                background: C.accent,
                color: '#fff',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: metaLoading ? 0.6 : 1,
              }}
            >
              {metaLoading ? <><Loader2 size={16} className="spin" /> Optimizing...</> : <><Sparkles size={16} /> Optimize Meta Tags</>}
            </button>

            {metaResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>OPTIMIZED TITLE ({metaResult.titleLength} chars)</span>
                    <CopyBtn text={metaResult.newTitle} />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>{metaResult.newTitle}</div>
                </div>

                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.accent }}>OPTIMIZED META DESCRIPTION ({metaResult.metaLength} chars)</span>
                    <CopyBtn text={metaResult.newMetaDescription} />
                  </div>
                  <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.5 }}>{metaResult.newMetaDescription}</div>
                </div>

                <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <h5 style={{ fontSize: 13, fontWeight: 700, color: C.blue, margin: '0 0 6px 0' }}>Strategic Improvement:</h5>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{metaResult.improvement}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Topic Ideas */}
        {activeTab === 2 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>Target Month</label>
                  <input 
                    type="month"
                    value={topicMonth}
                    onChange={e => setTopicMonth(e.target.value)}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: '10px 16px',
                      color: C.text,
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>
                <button 
                  onClick={handleGetTopics}
                  disabled={topicsLoading}
                  style={{
                    background: C.accent,
                    color: '#fff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 22,
                    opacity: topicsLoading ? 0.6 : 1,
                  }}
                >
                  {topicsLoading ? <><Loader2 size={16} className="spin" /> Brainstorming...</> : <><Lightbulb size={16} /> Get Topic Ideas</>}
                </button>
              </div>
            </div>

            {topics.length > 0 && (
              <>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, width: 'fit-content', color: siteAnalyzed ? '#34d399' : '#fbbf24', background: siteAnalyzed ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)', border: `1px solid ${siteAnalyzed ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}` }}>
                  {siteAnalyzed ? `Grounded in ${siteAnalyzed.pagesCrawled} live page(s) crawled from ${siteAnalyzed.origin}` : "Site couldn't be reached — based on the stored business profile instead"}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {topics.map((t, idx) => (
                  <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(249, 115, 22, 0.1)', color: C.accent, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>
                          Priority {t.priority}
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          background: t.estimatedTraffic === 'high' ? 'rgba(16, 185, 129, 0.1)' : t.estimatedTraffic === 'medium' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(255,255,255,0.05)',
                          color: t.estimatedTraffic === 'high' ? C.green : t.estimatedTraffic === 'medium' ? '#eab308' : C.muted,
                          padding: '2px 8px',
                          borderRadius: 4,
                          textTransform: 'capitalize'
                        }}>
                          {t.estimatedTraffic} traffic
                        </span>
                      </div>
                      <h4 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: '0 0 10px 0', lineHeight: 1.4 }}>{t.title}</h4>
                      <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Keyword: <strong style={{ color: C.text }}>{t.targetKeyword}</strong></p>
                      {t.basedOn && <p style={{ fontSize: 11, color: C.accent, margin: '6px 0 0' }}>Based on: {t.basedOn}</p>}
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${C.border}`, paddingTop: 12, fontSize: 12, color: C.muted }}>
                      <span style={{ textTransform: 'capitalize' }}>Type: {t.contentType}</span>
                      <span style={{ textTransform: 'capitalize' }}>Intent: {t.intent}</span>
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Schema Library */}
        {activeTab === 3 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}><Code2 size={20} color={C.accent} /> JSON-LD Schema Generator</h3>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {SCHEMA_TYPES.map(type => (
                <button
                  key={type}
                  onClick={() => handleSelectSchemaType(type)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: `1px solid ${schemaType === type ? C.accent : C.border}`,
                    background: schemaType === type ? 'rgba(249, 115, 22, 0.1)' : C.card,
                    color: schemaType === type ? C.accent : C.text,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {type}
                </button>
              ))}
            </div>

            {SCHEMA_TYPE_INFO[schemaType] && (
              <div style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#c9d1d9', lineHeight: 1.6 }}>
                <div><strong style={{ color: '#f8fafc' }}>What it is:</strong> {SCHEMA_TYPE_INFO[schemaType].what}</div>
                <div style={{ marginTop: 6 }}><strong style={{ color: '#f8fafc' }}>What it's for:</strong> {SCHEMA_TYPE_INFO[schemaType].use}</div>
              </div>
            )}

            {/* Option 1: auto-fill from the live site. Option 2: the form below stays editable/manual either way. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                onClick={handleAutoFillSchema}
                disabled={schemaPrefilling}
                style={{ background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: schemaPrefilling ? 0.6 : 1 }}
              >
                {schemaPrefilling ? <><Loader2 size={14} className="spin" /> Analyzing site...</> : <><Globe size={14} /> Auto-fill from Website</>}
              </button>
              <span style={{ fontSize: 12, color: C.muted }}>or fill in the fields below manually</span>
            </div>

            {schemaSiteAnalyzed && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20, width: 'fit-content', color: schemaFoundFields.length ? '#34d399' : '#fbbf24', background: schemaFoundFields.length ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)', border: `1px solid ${schemaFoundFields.length ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}` }}>
                {schemaFoundFields.length > 0
                  ? `Filled ${schemaFoundFields.length} field(s) from ${schemaSiteAnalyzed.pagesCrawled} real page(s) on ${schemaSiteAnalyzed.origin}`
                  : `Analyzed ${schemaSiteAnalyzed.pagesCrawled} page(s) on ${schemaSiteAnalyzed.origin} but found nothing usable — fill in manually`}
              </div>
            )}

            {/* Dynamic form for the selected schema type */}
            <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
              {SCHEMA_FIELDS[schemaType].map(field => {
                if (field.type === 'faqList') {
                  const faqs = schemaData.faqs || [];
                  return (
                    <div key={field.key}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>{field.label}</label>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {faqs.map((f, i) => (
                          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
                            <input value={f.question} onChange={e => { const next = [...faqs]; next[i] = { ...next[i], question: e.target.value }; setSchemaData({ ...schemaData, faqs: next }); }} placeholder="e.g. What services do you offer?" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
                            <textarea value={f.answer} onChange={e => { const next = [...faqs]; next[i] = { ...next[i], answer: e.target.value }; setSchemaData({ ...schemaData, faqs: next }); }} placeholder="e.g. We offer web design, SEO, and Google Business Profile management." rows={2} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none', resize: 'vertical' }} />
                            {faqs.length > 1 && <button onClick={() => setSchemaData({ ...schemaData, faqs: faqs.filter((_, fi) => fi !== i) })} style={{ justifySelf: 'end', background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>Remove</button>}
                          </div>
                        ))}
                        <button onClick={() => setSchemaData({ ...schemaData, faqs: [...faqs, { question: '', answer: '' }] })} style={{ width: 'fit-content', background: 'transparent', border: `1px dashed ${C.border}`, color: C.muted, padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>+ Add question</button>
                      </div>
                    </div>
                  );
                }
                if (field.type === 'breadcrumbList') {
                  const crumbs = schemaData.crumbs || [];
                  return (
                    <div key={field.key}>
                      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>{field.label}</label>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {crumbs.map((c, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8 }}>
                            <input value={c.name} onChange={e => { const next = [...crumbs]; next[i] = { ...next[i], name: e.target.value }; setSchemaData({ ...schemaData, crumbs: next }); }} placeholder="e.g. Services" style={{ boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
                            <input value={c.url} onChange={e => { const next = [...crumbs]; next[i] = { ...next[i], url: e.target.value }; setSchemaData({ ...schemaData, crumbs: next }); }} placeholder="e.g. https://bmtechx.in/services" style={{ boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', color: C.text, fontSize: 13, outline: 'none' }} />
                            {crumbs.length > 1 && <button onClick={() => setSchemaData({ ...schemaData, crumbs: crumbs.filter((_, ci) => ci !== i) })} style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>✕</button>}
                          </div>
                        ))}
                        <button onClick={() => setSchemaData({ ...schemaData, crumbs: [...crumbs, { name: '', url: '' }] })} style={{ width: 'fit-content', background: 'transparent', border: `1px dashed ${C.border}`, color: C.muted, padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>+ Add page</button>
                      </div>
                    </div>
                  );
                }
                const found = schemaFoundFields.includes(field.key);
                return (
                  <div key={field.key}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 8 }}>
                      {field.label}
                      {found && <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '1px 6px', borderRadius: 4 }}>from site</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea value={schemaData[field.key] || ''} onChange={e => setSchemaData({ ...schemaData, [field.key]: e.target.value })} placeholder={field.example} rows={3} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', resize: 'vertical' }} />
                    ) : field.type === 'select' ? (
                      <select value={schemaData[field.key] || field.options[0]} onChange={e => setSchemaData({ ...schemaData, [field.key]: e.target.value })} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                        {field.options.map(o => <option key={o} value={o} style={{ background: C.card, color: C.text }}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={field.type === 'date' ? 'date' : 'text'} value={schemaData[field.key] || ''} onChange={e => setSchemaData({ ...schemaData, [field.key]: e.target.value })} placeholder={field.example} style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none' }} />
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleGenerateSchema}
              disabled={schemaLoading}
              style={{
                width: 'fit-content',
                background: C.accent,
                color: '#fff',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: schemaLoading ? 0.6 : 1,
              }}
            >
              {schemaLoading ? <><Loader2 size={16} className="spin" /> Generating...</> : <><Code2 size={16} /> Generate Schema Script</>}
            </button>

            {schemaResult && (
              <div style={{ background: '#090d16', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>Copy script tag into the &lt;head&gt; of your page</span>
                  <CopyBtn text={schemaResult} />
                </div>
                <pre style={{ margin: 0, padding: 20, overflowX: 'auto', fontSize: 13, fontFamily: 'monospace', color: '#cbd5e1', lineHeight: 1.5 }}>
                  {schemaResult}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
