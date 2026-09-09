import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';
import { C } from '../../constants/theme.js';
import {
  Brain, Plus, Trash2, Edit2, Check, X, Sparkles, Wrench,
  MessageSquare, HelpCircle, AlertTriangle, ShieldAlert,
  Tag, Calendar, Volume2
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function GmbBrain() {
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Brain entries list
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  // Form states
  const [entryType, setEntryType] = useState('tone');
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [seasonTitle, setSeasonTitle] = useState('');
  const [editSeasonTitle, setEditSeasonTitle] = useState('');

  // 1. Tone Form States
  const [toneVoice, setToneVoice] = useState('Friendly');
  const [toneStyles, setToneStyles] = useState(['Appreciative', 'Conversational']);
  const [toneEmoji, setToneEmoji] = useState('Minimal');
  const [toneLength, setToneLength] = useState('Medium');
  const [toneAvoidText, setToneAvoidText] = useState('');
  const [toneAvoid, setToneAvoid] = useState(['Robotic', 'Defensive']);

  // 2. Review Guidelines Form States
  const [rgPositive, setRgPositive] = useState('');
  const [rgNeutral, setRgNeutral] = useState('');
  const [rgNegative, setRgNegative] = useState('');
  const [rgAdditionalText, setRgAdditionalText] = useState('');
  const [rgAdditional, setRgAdditional] = useState(['Mention customer name', 'Invite them back']);

  // 3. Keywords & 4. Blacklist Form States
  const [kwText, setKwText] = useState('');
  const [kwTags, setKwTags] = useState([]);
  const [blText, setBlText] = useState('');
  const [blTags, setBlTags] = useState([]);

  // 5. Offers Repeatable Cards State
  const [offersList, setOffersList] = useState([{ title: '', description: '', validUntil: '', cta: '' }]);

  // 6. Q&A Bank Repeatable Cards State
  const [qaList, setQaList] = useState([{ question: '', answer: '' }]);

  // 7. Seasonal Repeatable Cards State
  const [seasonalList, setSeasonalList] = useState([{ occasion: '', startDate: '', endDate: '', instructions: '' }]);

  // 8. Creative Brief Form States
  const [cbBrandStyle, setCbBrandStyle] = useState('Modern');
  const [cbBrandColorsText, setCbBrandColorsText] = useState('');
  const [cbBrandColors, setCbBrandColors] = useState([]);
  const [cbImageStyleText, setCbImageStyleText] = useState('');
  const [cbImageStyle, setCbImageStyle] = useState([]);
  const [cbNegativeText, setCbNegativeText] = useState('');
  const [cbNegative, setCbNegative] = useState([]);
  const [cbTypography, setCbTypography] = useState('');

  // Active DB entry ID for the selected category (so we can update instead of duplicate)
  const [activeEntryId, setActiveEntryId] = useState(null);

  // Automatically pre-fill structured form states when selecting tab or loading entries
  useEffect(() => {
    if (!entries || entries.length === 0) return;
    const existing = entries.find(e => e.entry_type.toLowerCase() === entryType.toLowerCase());
    if (existing) {
      setActiveEntryId(existing.id);
      try {
        const data = JSON.parse(existing.content);
        if (entryType === 'tone') {
          setToneVoice(data.voice || 'Friendly');
          setToneStyles(data.style || []);
          setToneEmoji(data.emoji || 'Minimal');
          setToneLength(data.length || 'Medium');
          setToneAvoid(data.avoid || []);
        } else if (entryType === 'review_rules') {
          setRgPositive(data.positive || '');
          setRgNeutral(data.neutral || '');
          setRgNegative(data.negative || '');
          setRgAdditional(data.additional || []);
        } else if (entryType === 'keyword') {
          setKwTags(Array.isArray(data) ? data : data.keywords || []);
        } else if (entryType === 'blacklist') {
          setBlTags(Array.isArray(data) ? data : data.words || []);
        } else if (entryType === 'offer') {
          setOffersList(Array.isArray(data) ? data : [data]);
        } else if (entryType === 'qa') {
          setQaList(Array.isArray(data) ? data : [data]);
        } else if (entryType === 'seasonal') {
          setSeasonalList(Array.isArray(data) ? data : [data]);
        } else if (entryType === 'creative_brief') {
          setCbBrandStyle(data.brandStyle || 'Modern');
          setCbBrandColors(data.brandColors || []);
          setCbImageStyle(data.imageStyle || []);
          setCbNegative(data.negativePrompt || []);
          setCbTypography(data.typography || '');
        }
      } catch (e) {
        // Fallback for legacy plain text entries
        if (entryType === 'tone') setContent(existing.content);
        else if (entryType === 'review_rules') setRgPositive(existing.content);
        else if (entryType === 'keyword') setKwTags(existing.content.split(',').map(x => x.trim()).filter(Boolean));
        else if (entryType === 'blacklist') setBlTags(existing.content.split(',').map(x => x.trim()).filter(Boolean));
      }
    } else {
      setActiveEntryId(null);
      // Reset to defaults
      if (entryType === 'tone') {
        setToneVoice('Friendly');
        setToneStyles(['Appreciative', 'Conversational']);
        setToneEmoji('Minimal');
        setToneLength('Medium');
        setToneAvoid(['Robotic', 'Defensive']);
      } else if (entryType === 'review_rules') {
        setRgPositive('');
        setRgNeutral('');
        setRgNegative('');
        setRgAdditional(['Mention customer name', 'Invite them back']);
      } else if (entryType === 'keyword') {
        setKwTags([]);
      } else if (entryType === 'blacklist') {
        setBlTags([]);
      } else if (entryType === 'offer') {
        setOffersList([{ title: '', description: '', validUntil: '', cta: '' }]);
      } else if (entryType === 'qa') {
        setQaList([{ question: '', answer: '' }]);
      } else if (entryType === 'seasonal') {
        setSeasonalList([{ occasion: '', startDate: '', endDate: '', instructions: '' }]);
      } else if (entryType === 'creative_brief') {
        setCbBrandStyle('Modern');
        setCbBrandColors([]);
        setCbImageStyle([]);
        setCbNegative([]);
        setCbTypography('');
      }
    }
  }, [entryType, entries]);

  const [polishing, setPolishing] = useState(false);

  const handleAiPolish = async () => {
    if (!content.trim()) return;
    setPolishing(true);
    try {
      const token = localStorage.getItem('leados_token');
      const { data } = await axios.post(`${API_URL}/api/mafiya/reviews/brain/polish`, {
        content: content.trim(),
        entryType,
        clientId: activeClient?.id
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (data.polishedText) {
        setContent(data.polishedText);
        toast.success('Instruction polished with AI!');
      }
    } catch (err) {
      console.error('AI Polish error:', err);
      const msg = err.response?.data?.message || 'Failed to polish text';
      toast.error(msg);
    } finally {
      setPolishing(false);
    }
  };

  const [suggesting, setSuggesting] = useState(false);

  const handleAiSuggest = async (forceScratch = false) => {
    if (!activeClient) return;
    setSuggesting(true);
    try {
      let currentConfig = {};
      if (!forceScratch) {
        if (entryType === 'tone') {
          currentConfig = {
            voice: toneVoice,
            style: toneStyles,
            emoji: toneEmoji,
            length: toneLength,
            avoid: toneAvoid
          };
        } else if (entryType === 'review_rules') {
          currentConfig = {
            positive: rgPositive,
            neutral: rgNeutral,
            negative: rgNegative,
            additional: rgAdditional
          };
        } else if (entryType === 'keyword') {
          currentConfig = kwTags;
        } else if (entryType === 'blacklist') {
          currentConfig = blTags;
        } else if (entryType === 'offer') {
          currentConfig = offersList;
        } else if (entryType === 'qa') {
          currentConfig = qaList;
        } else if (entryType === 'seasonal') {
          currentConfig = seasonalList;
        } else if (entryType === 'creative_brief') {
          currentConfig = {
            brandStyle: cbBrandStyle,
            brandColors: cbBrandColors,
            imageStyle: cbImageStyle,
            negativePrompt: cbNegative,
            typography: cbTypography
          };
        }
      }

      const token = localStorage.getItem('leados_token');
      const { data } = await axios.post(`${API_URL}/api/mafiya/reviews/brain/suggest-config`, {
        clientId: activeClient.id,
        entryType,
        currentConfig
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const config = data.suggestedConfig;
      if (entryType === 'tone') {
        setToneVoice(config.voice || 'Friendly');
        setToneStyles(config.style || []);
        setToneEmoji(config.emoji || 'Minimal');
        setToneLength(config.length || 'Medium');
        setToneAvoid(config.avoid || []);
      } else if (entryType === 'review_rules') {
        setRgPositive(config.positive || '');
        setRgNeutral(config.neutral || '');
        setRgNegative(config.negative || '');
        setRgAdditional(config.additional || []);
      } else if (entryType === 'keyword') {
        setKwTags(config);
      } else if (entryType === 'blacklist') {
        setBlTags(config);
      } else if (entryType === 'offer') {
        setOffersList(config);
      } else if (entryType === 'qa') {
        setQaList(config);
      } else if (entryType === 'seasonal') {
        setSeasonalList(config);
      } else if (entryType === 'creative_brief') {
        setCbBrandStyle(config.brandStyle || 'Modern');
        setCbBrandColors(config.brandColors || []);
        setCbImageStyle(config.imageStyle || []);
        setCbNegative(config.negativePrompt || []);
        setCbTypography(config.typography || '');
      }
      toast.success(`Generated suggestions based on ${activeClient.display_name || activeClient.business_name || 'profile'}!`);
    } catch (err) {
      console.error('Suggest config error:', err);
      const msg = err.response?.data?.message || 'Failed to generate suggestions. Please try again.';
      toast.error(msg);
    } finally {
      setSuggesting(false);
    }
  };

  // Active tab/filter for the list
  const [activeTab, setActiveTab] = useState('all');

  const setActiveClient = (client) => {
    setActiveClientState(client);
    if (client) {
      localStorage.setItem('activeGmbClient', JSON.stringify(client));
    } else {
      localStorage.removeItem('activeGmbClient');
    }
  };

  // 1. Fetch Clients
  const fetchClients = async () => {
    try {
      const token = localStorage.getItem('leados_token');
      const { data: clientsData } = await axios.get(`${API_URL}/api/mafiya/clients`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClients(clientsData);
      if (clientsData.length > 0) {
        const savedGmbClient = localStorage.getItem('activeGmbClient');
        if (savedGmbClient) {
          try {
            const parsed = JSON.parse(savedGmbClient);
            const found = clientsData.find(c => c.id === parsed.id);
            if (found) {
              setActiveClient(found);
              setLoading(false);
              return;
            }
          } catch (e) {}
        }
        setActiveClient(clientsData[0]);
      }
    } catch (err) {
      console.error('Fetch clients error:', err);
      toast.error('Failed to load GMB clients');
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch Brain Entries for active client
  const fetchBrainEntries = async (clientId) => {
    if (!clientId) return;
    setEntriesLoading(true);
    try {
      const token = localStorage.getItem('leados_token');
      const { data } = await axios.get(`${API_URL}/api/mafiya/reviews/brain?clientId=${clientId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEntries(data);
    } catch (err) {
      console.error('Fetch brain error:', err);
      toast.error('Failed to load brain entries');
    } finally {
      setEntriesLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    if (activeClient) {
      fetchBrainEntries(activeClient.id);
    }
  }, [activeClient]);

  // 3. Save / Update Entry
  const handleSaveEntry = async (e) => {
    if (e) e.preventDefault();
    if (!activeClient) return;

    setSaving(true);
    try {
      const token = localStorage.getItem('leados_token');
      let finalContent = '';

      if (entryType === 'tone') {
        finalContent = JSON.stringify({
          voice: toneVoice,
          style: toneStyles,
          emoji: toneEmoji,
          length: toneLength,
          avoid: toneAvoid
        });
      } else if (entryType === 'review_rules') {
        finalContent = JSON.stringify({
          positive: rgPositive.trim(),
          neutral: rgNeutral.trim(),
          negative: rgNegative.trim(),
          additional: rgAdditional
        });
      } else if (entryType === 'keyword') {
        finalContent = JSON.stringify(kwTags);
      } else if (entryType === 'blacklist') {
        finalContent = JSON.stringify(blTags);
      } else if (entryType === 'offer') {
        const validOffers = offersList.filter(o => o.title.trim() || o.description.trim());
        if (validOffers.length === 0) {
          toast.error('Please add at least one offer title or description');
          setSaving(false);
          return;
        }
        finalContent = JSON.stringify(validOffers);
      } else if (entryType === 'qa') {
        const validQa = qaList.filter(q => q.question.trim() || q.answer.trim());
        if (validQa.length === 0) {
          toast.error('Please add at least one question or answer');
          setSaving(false);
          return;
        }
        finalContent = JSON.stringify(validQa);
      } else if (entryType === 'seasonal') {
        const validSeasonal = seasonalList.filter(s => s.occasion.trim() || s.instructions.trim());
        if (validSeasonal.length === 0) {
          toast.error('Please add at least one seasonal occasion or instructions');
          setSaving(false);
          return;
        }
        finalContent = JSON.stringify(validSeasonal);
      } else if (entryType === 'creative_brief') {
        finalContent = JSON.stringify({
          brandStyle: cbBrandStyle,
          brandColors: cbBrandColors,
          imageStyle: cbImageStyle,
          negativePrompt: cbNegative,
          typography: cbTypography.trim()
        });
      }

      const payload = {
        clientId: activeClient.id,
        entryType,
        content: finalContent
      };

      if (activeEntryId) {
        payload.id = activeEntryId;
      }

      await axios.post(`${API_URL}/api/mafiya/reviews/brain`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success(activeEntryId ? 'Updated brain entry!' : 'Saved to brain successfully!');
      fetchBrainEntries(activeClient.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 4. Update Existing Entry
  const handleUpdateEntry = async (id, type) => {
    if (!editContent.trim()) return;
    if (type === 'seasonal' && !editSeasonTitle.trim()) {
      toast.error('Please enter a Season Title');
      return;
    }

    try {
      const token = localStorage.getItem('leados_token');
      const finalContent = type === 'seasonal'
        ? JSON.stringify({ title: editSeasonTitle.trim(), text: editContent.trim() })
        : editContent.trim();

      await axios.post(`${API_URL}/api/mafiya/reviews/brain`, {
        id,
        clientId: activeClient.id,
        entryType: type,
        content: finalContent
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Updated brain entry!');
      setEditingId(null);
      setEditContent('');
      setEditSeasonTitle('');
      fetchBrainEntries(activeClient.id);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // 5. Delete Entry
  const handleDeleteEntry = async (id) => {
    if (!window.confirm('Are you sure you want to delete this brain entry?')) return;
    try {
      const token = localStorage.getItem('leados_token');
      await axios.delete(`${API_URL}/api/mafiya/reviews/brain/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success('Entry deleted from brain');
      fetchBrainEntries(activeClient.id);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Entry type cards/tabs configuration
  const cardTypes = [
    { type: 'tone', title: 'Tone', desc: 'How AI sounds', Icon: Volume2, color: C.purple },
    { type: 'review_rules', title: 'Review Guidelines', desc: 'Rules for review replies', Icon: MessageSquare, color: '#06b6d4' },
    { type: 'offer', title: 'Offers', desc: 'Current deals', Icon: Tag, color: C.green },
    { type: 'keyword', title: 'Hashtags', desc: 'Social tags', Icon: Sparkles, color: '#f59e0b' },
    { type: 'qa', title: 'Q&A Bank', desc: 'Questions + answers', Icon: HelpCircle, color: C.blue },
    { type: 'blacklist', title: 'Blacklist', desc: 'Never use words', Icon: ShieldAlert, color: C.red },
    { type: 'seasonal', title: 'Daily Poster', desc: 'Time-based focus', Icon: Calendar, color: C.pink }
    // { type: 'creative_brief', title: 'AI Creative Brief', desc: 'Poster visual styles & rules', Icon: Sparkles, color: C.accent }
  ];

  const getBadgeStyle = (type) => {
    switch (type.toLowerCase()) {
      case 'tone': return { background: `${C.purple}22`, color: C.purple, border: `1px solid ${C.purple}44` };
      case 'review_rules': return { background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.3)' };
      case 'offer': return { background: `${C.green}22`, color: C.green, border: `1px solid ${C.green}44` };
      case 'keyword': return { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' };
      case 'qa': return { background: `${C.blue}22`, color: C.blue, border: `1px solid ${C.blue}44` };
      case 'blacklist': return { background: `${C.red}22`, color: C.red, border: `1px solid ${C.red}44` };
      case 'seasonal': return { background: `${C.pink}22`, color: C.pink, border: `1px solid ${C.pink}44` };
      case 'creative_brief': return { background: `${C.accent}22`, color: C.accent, border: `1px solid ${C.accent}44` };
      default: return { background: `${C.muted}22`, color: C.text, border: `1px solid ${C.border}` };
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <div style={{ textAlign: 'center' }}>
          <Brain size={42} className="animate-pulse" style={{ color: C.accent, marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Loading GMB Brain Configurations...</p>
        </div>
      </div>
    );
  }

  // Filter entries based on the activeTab
  const filteredEntries = activeTab === 'all'
    ? entries
    : entries.filter(e => e.entry_type.toLowerCase() === activeTab.toLowerCase());

  const clientName = activeClient?.display_name || activeClient?.business_name || 'GMB Profile';

  // Extract main title and subtitle from potentially long GMB names
  let displayTitle = clientName;
  let displaySubtitle = '';
  if (clientName.includes(' - ')) {
    const parts = clientName.split(' - ');
    displayTitle = parts[0];
    displaySubtitle = parts.slice(1).join(' - ');
  } else if (clientName.includes(',')) {
    const parts = clientName.split(',');
    displayTitle = parts[0];
    displaySubtitle = parts.slice(1).join(', ');
  }

  return (
    <div className="p-mobile" style={{ padding: 28, overflowY: 'auto', height: '100%', background: C.bg || '#090a0f', position: 'relative' }}>
      {/* Background Radiance gradient */}
      <style>{`
        @keyframes pulse-accent {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, #1c1c1f 25%, #27272a 50%, #1c1c1f 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite linear;
          border-radius: 8px;
        }
        .brain-card {
          background: #121214 !important;
          border: 1px solid rgba(255, 255, 255, 0.05) !important;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .brain-card:hover {
          transform: translateY(-4px);
          border-color: #f97316 !important;
          box-shadow: 0 12px 24px rgba(0, 0, 0, 0.5), 0 0 20px rgba(249, 115, 22, 0.12);
        }
        .entry-row {
          transition: all 0.2s ease;
        }
        .entry-row:hover {
          border-color: rgba(255, 255, 255, 0.12) !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
      `}</style>

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, background: 'radial-gradient(circle at 50% -20%, rgba(249,115,22,0.08) 0%, rgba(139,92,246,0.04) 50%, transparent 100%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Header Section */}
        <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 25, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>
                {displayTitle}'s Brain
              </h1>
              <span style={{ fontSize: 10, fontWeight: 800, background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', padding: '4px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.8, boxShadow: '0 2px 8px rgba(249,115,22,0.2)' }}>AI Training</span>
            </div>
            {displaySubtitle && (
              <div style={{ color: C.accent || '#f97316', fontSize: 12.5, fontWeight: 600, marginTop: 6, opacity: 0.9 }}>
                {displaySubtitle}
              </div>
            )}
            <p style={{ color: C.muted || '#71717a', fontSize: 13, marginTop: 6 }}>
              Configure preferences to customize post copy, customer review replies, and marketing prompts automatically.
            </p>
          </div>

          {/* Client Select dropdown */}
          <select
            value={activeClient ? activeClient.id : ''}
            onChange={(e) => {
              const c = clients.find(cl => cl.id === parseInt(e.target.value));
              if (c) setActiveClient(c);
            }}
            style={{ background: '#121214', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 10, color: '#fff', padding: '12px 18px', fontSize: 13, outline: 'none', cursor: 'pointer', minWidth: 220, boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.business_name}
              </option>
            ))}
          </select>
        </div>

        {/* Explain Banner */}
        <div style={{ background: 'rgba(249, 115, 22, 0.03)', border: `1px solid rgba(249, 115, 22, 0.1)`, borderRadius: 16, padding: 20, marginBottom: 30, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ background: `rgba(249, 115, 22, 0.1)`, padding: 10, borderRadius: 12, color: '#f97316', display: 'flex' }}>
            <Brain size={18} />
          </div>
          <div>
            <h4 style={{ fontSize: 13.5, fontWeight: 700, color: '#f97316', marginBottom: 6, marginTop: 2 }}>How {clientName}'s Brain works:</h4>
            <p style={{ fontSize: 12.5, color: '#a1a1aa', lineHeight: 1.6, margin: 0 }}>
              The parameters defined below act as core constraints for the Google Gemini and Groq AI engines. The LLM automatically references these rules first when writing GMB posts, responding to customer reviews, or planning design prompts.
            </p>
          </div>
        </div>

        {/* Brain Grid Layout */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 24, marginBottom: 32 }} className="grid-responsive">
          {/* Left Column: Category Tabs */}
          <div style={{ gridColumn: 'span 7', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignSelf: 'start' }} className="grid-responsive">
            {cardTypes.map((card) => {
              const cardCount = entries.filter(e => e.entry_type.toLowerCase() === card.type).length;
              const isSelected = entryType === card.type;
              return (
                <div
                  key={card.type}
                  onClick={() => {
                    setEntryType(card.type);
                    setActiveTab(card.type);
                  }}
                  className="brain-card"
                  style={{
                    borderRadius: 16,
                    padding: 20,
                    cursor: 'pointer',
                    position: 'relative',
                    border: isSelected ? '1px solid #f97316 !important' : '1px solid rgba(255,255,255,0.06)',
                    background: isSelected ? 'rgba(249,115,22,0.02) !important' : '#121214',
                    boxShadow: isSelected ? '0 8px 20px rgba(0,0,0,0.3), inset 0 0 12px rgba(249,115,22,0.04)' : '0 4px 10px rgba(0,0,0,0.15)',
                    minHeight: 135,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ background: `${card.color}15`, padding: 9, borderRadius: 10, color: card.color, display: 'flex' }}>
                      <card.Icon size={18} />
                    </div>
                    {cardCount > 0 && (
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: card.color, background: `${card.color}10`, padding: '3px 9px', borderRadius: 20, border: `1px solid ${card.color}22` }}>
                        {cardCount} Active
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 4px 0' }}>{card.title}</h3>
                    <p style={{ fontSize: 11.5, color: '#71717a', margin: 0, lineHeight: 1.4 }}>{card.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Input Box */}
          <div style={{ gridColumn: 'span 5', alignSelf: 'start' }}>
            <div style={{ background: '#121214', border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Plus size={17} color="#f97316" />
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>Add New Brain Entry</h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleAiSuggest(true)}
                    disabled={suggesting}
                    style={{
                      background: 'rgba(249,115,22,0.08)',
                      border: '1px solid rgba(249,115,22,0.2)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      color: '#f97316',
                      fontSize: 11,
                      fontWeight: 750,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.2s',
                      opacity: suggesting ? 0.7 : 1
                    }}
                  >
                    <Sparkles size={11} />
                    {suggesting ? 'Suggesting...' : 'Suggest with AI'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAiSuggest(false)}
                    disabled={suggesting}
                    style={{
                      background: 'rgba(6,182,212,0.08)',
                      border: '1px solid rgba(6,182,212,0.2)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      color: '#06b6d4',
                      fontSize: 11,
                      fontWeight: 750,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.2s',
                      opacity: suggesting ? 0.7 : 1
                    }}
                  >
                    <Wrench size={11} />
                    {suggesting ? 'Optimizing...' : 'Optimize with AI'}
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveEntry} style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Entry Type</label>
                  <select
                    value={entryType}
                    onChange={(e) => setEntryType(e.target.value)}
                    style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="tone">Tone</option>
                    <option value="review_rules">Review Guidelines</option>
                    <option value="offer">Offers</option>
                    <option value="keyword">Hashtags</option>
                    <option value="qa">Q&A Bank</option>
                    <option value="blacklist">Blacklist</option>
                    <option value="seasonal">Daily Poster</option>
                    {/* <option value="creative_brief">AI Creative Brief</option> */}
                  </select>
                </div>

                {/* Category Specific Forms */}
                {suggesting ? (
                  /* Render skeleton loader */
                  (() => {
                    if (entryType === 'tone') {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <div className="skeleton-shimmer" style={{ height: 12, width: 80 }} />
                            <div className="skeleton-shimmer" style={{ height: 38, width: '100%' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <div className="skeleton-shimmer" style={{ height: 12, width: 90 }} />
                            <div className="skeleton-shimmer" style={{ height: 50, width: '100%' }} />
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div className="skeleton-shimmer" style={{ height: 38 }} />
                            <div className="skeleton-shimmer" style={{ height: 38 }} />
                          </div>
                          <div className="skeleton-shimmer" style={{ height: 38, width: '100%' }} />
                        </div>
                      );
                    }
                    if (entryType === 'review_rules') {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div className="skeleton-shimmer" style={{ height: 60, width: '100%' }} />
                          <div className="skeleton-shimmer" style={{ height: 60, width: '100%' }} />
                          <div className="skeleton-shimmer" style={{ height: 60, width: '100%' }} />
                          <div className="skeleton-shimmer" style={{ height: 40, width: '100%' }} />
                        </div>
                      );
                    }
                    if (entryType === 'keyword' || entryType === 'blacklist') {
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          <div className="skeleton-shimmer" style={{ height: 45, width: '100%' }} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <div className="skeleton-shimmer" style={{ height: 25, width: 80, borderRadius: 12 }} />
                            <div className="skeleton-shimmer" style={{ height: 25, width: 100, borderRadius: 12 }} />
                            <div className="skeleton-shimmer" style={{ height: 25, width: 60, borderRadius: 12 }} />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div className="skeleton-shimmer" style={{ height: 110, width: '100%' }} />
                        <div className="skeleton-shimmer" style={{ height: 110, width: '100%' }} />
                      </div>
                    );
                  })()
                ) : (
                  <>
                    {entryType === 'tone' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Voice / Tone Tone</label>
                      <select value={toneVoice} onChange={(e) => setToneVoice(e.target.value)} style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                        <option value="Professional">Professional</option>
                        <option value="Friendly">Friendly</option>
                        <option value="Warm">Warm</option>
                        <option value="Luxury">Luxury</option>
                        <option value="Corporate">Corporate</option>
                        <option value="Casual">Casual</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reply Style (Select all that apply)</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                        {['Humble', 'Appreciative', 'Conversational', 'Confident', 'Empathetic', 'Solution-Oriented'].map((style) => (
                          <label key={style} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12.5, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={toneStyles.includes(style)}
                              onChange={(e) => {
                                if (e.target.checked) setToneStyles([...toneStyles, style]);
                                else setToneStyles(toneStyles.filter(s => s !== style));
                              }}
                              style={{ accentColor: '#f97316' }}
                            />
                            {style}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Emoji Usage</label>
                        <select value={toneEmoji} onChange={(e) => setToneEmoji(e.target.value)} style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                          <option value="None">None</option>
                          <option value="Minimal">Minimal (1-2 max)</option>
                          <option value="Moderate">Moderate</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Response Length</label>
                        <select value={toneLength} onChange={(e) => setToneLength(e.target.value)} style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                          <option value="Short">Short (40-60 words)</option>
                          <option value="Medium">Medium (60-90 words)</option>
                          <option value="Detailed">Detailed</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Words or Styles to Avoid</label>
                      <input
                        type="text"
                        placeholder="Type word and press Enter"
                        value={toneAvoidText}
                        onChange={(e) => setToneAvoidText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = toneAvoidText.trim();
                            if (val && !toneAvoid.includes(val)) setToneAvoid([...toneAvoid, val]);
                            setToneAvoidText('');
                          }
                        }}
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {toneAvoid.map(tag => (
                          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                            {tag}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setToneAvoid(toneAvoid.filter(t => t !== tag))} />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {entryType === 'review_rules' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>For Positive Reviews (4-5 Stars)</label>
                      <textarea
                        value={rgPositive}
                        onChange={(e) => setRgPositive(e.target.value)}
                        placeholder="e.g. Thank customer by name, invite them back"
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none', resize: 'vertical', minHeight: 60 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>For Neutral Reviews (3 Stars)</label>
                      <textarea
                        value={rgNeutral}
                        onChange={(e) => setRgNeutral(e.target.value)}
                        placeholder="e.g. Acknowledge feedback, express willingness to improve"
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none', resize: 'vertical', minHeight: 60 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>For Negative Reviews (1-2 Stars)</label>
                      <textarea
                        value={rgNegative}
                        onChange={(e) => setRgNegative(e.target.value)}
                        placeholder="e.g. Apologize politely, offer support email, invite to private chat"
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none', resize: 'vertical', minHeight: 60 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Additional Rules</label>
                      <input
                        type="text"
                        placeholder="Type rule and press Enter"
                        value={rgAdditionalText}
                        onChange={(e) => setRgAdditionalText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = rgAdditionalText.trim();
                            if (val && !rgAdditional.includes(val)) setRgAdditional([...rgAdditional, val]);
                            setRgAdditionalText('');
                          }
                        }}
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {rgAdditional.map(tag => (
                          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                            {tag}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setRgAdditional(rgAdditional.filter(t => t !== tag))} />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {entryType === 'keyword' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Target Hashtags</label>
                    <input
                      type="text"
                      placeholder="Type hashtag and press Enter"
                      value={kwText}
                      onChange={(e) => setKwText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = kwText.trim();
                          if (val && !kwTags.includes(val)) setKwTags([...kwTags, val]);
                          setKwText('');
                        }
                      }}
                      style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {kwTags.map(tag => (
                        <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', padding: '3px 10px', borderRadius: 20, fontSize: 11.5 }}>
                          {tag}
                          <X size={11} style={{ cursor: 'pointer' }} onClick={() => setKwTags(kwTags.filter(t => t !== tag))} />
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {entryType === 'blacklist' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Blacklisted Words (Never use)</label>
                    <input
                      type="text"
                      placeholder="Type word and press Enter"
                      value={blText}
                      onChange={(e) => setBlText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = blText.trim();
                          if (val && !blTags.includes(val)) setBlTags([...blTags, val]);
                          setBlText('');
                        }
                      }}
                      style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '12px 14px', color: '#fff', fontSize: 13, outline: 'none' }}
                    />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      {blTags.map(tag => (
                        <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '3px 10px', borderRadius: 20, fontSize: 11.5 }}>
                          {tag}
                          <X size={11} style={{ cursor: 'pointer' }} onClick={() => setBlTags(blTags.filter(t => t !== tag))} />
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {entryType === 'offer' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    {offersList.map((offer, idx) => (
                      <div key={idx} style={{ background: '#1c1c1f', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 14, position: 'relative' }}>
                        {offersList.length > 1 && (
                          <Trash2 size={13} style={{ position: 'absolute', top: 12, right: 12, color: '#ef4444', cursor: 'pointer' }} onClick={() => setOffersList(offersList.filter((_, i) => i !== idx))} />
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Offer Title (e.g. 10% Off Full Stack Course)"
                            value={offer.title}
                            onChange={(e) => {
                              const updated = [...offersList];
                              updated[idx].title = e.target.value;
                              setOffersList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, padding: '4px 0', outline: 'none' }}
                          />
                          <textarea
                            placeholder="Offer Description Details"
                            value={offer.description}
                            onChange={(e) => {
                              const updated = [...offersList];
                              updated[idx].description = e.target.value;
                              setOffersList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#a1a1aa', fontSize: 12, outline: 'none', resize: 'none', height: 40 }}
                          />
                          <div style={{ display: 'flex', gap: 10 }}>
                            <input
                              type="text"
                              placeholder="Valid Until (e.g. Aug 31)"
                              value={offer.validUntil}
                              onChange={(e) => {
                                const updated = [...offersList];
                                updated[idx].validUntil = e.target.value;
                                setOffersList(updated);
                              }}
                              style={{ width: '50%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a1a1aa', fontSize: 11.5, outline: 'none' }}
                            />
                            <input
                              type="text"
                              placeholder="CTA (e.g. Apply Now)"
                              value={offer.cta}
                              onChange={(e) => {
                                const updated = [...offersList];
                                updated[idx].cta = e.target.value;
                                setOffersList(updated);
                              }}
                              style={{ width: '50%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a1a1aa', fontSize: 11.5, outline: 'none' }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setOffersList([...offersList, { title: '', description: '', validUntil: '', cta: '' }])}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      + Add Offer Card
                    </button>
                  </div>
                )}

                {entryType === 'qa' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    {qaList.map((item, idx) => (
                      <div key={idx} style={{ background: '#1c1c1f', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 14, position: 'relative' }}>
                        {qaList.length > 1 && (
                          <Trash2 size={13} style={{ position: 'absolute', top: 12, right: 12, color: '#ef4444', cursor: 'pointer' }} onClick={() => setQaList(qaList.filter((_, i) => i !== idx))} />
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Question"
                            value={item.question}
                            onChange={(e) => {
                              const updated = [...qaList];
                              updated[idx].question = e.target.value;
                              setQaList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, padding: '4px 0', outline: 'none' }}
                          />
                          <textarea
                            placeholder="Answer text"
                            value={item.answer}
                            onChange={(e) => {
                              const updated = [...qaList];
                              updated[idx].answer = e.target.value;
                              setQaList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#a1a1aa', fontSize: 12.5, outline: 'none', resize: 'none', height: 45 }}
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setQaList([...qaList, { question: '', answer: '' }])}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      + Add Question card
                    </button>
                  </div>
                )}

                {entryType === 'seasonal' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    {seasonalList.map((item, idx) => (
                      <div key={idx} style={{ background: '#1c1c1f', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 14, position: 'relative' }}>
                        {seasonalList.length > 1 && (
                          <Trash2 size={13} style={{ position: 'absolute', top: 12, right: 12, color: '#ef4444', cursor: 'pointer' }} onClick={() => setSeasonalList(seasonalList.filter((_, i) => i !== idx))} />
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Occasion (e.g. Diwali Sale 2026)"
                            value={item.occasion}
                            onChange={(e) => {
                              const updated = [...seasonalList];
                              updated[idx].occasion = e.target.value;
                              setSeasonalList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, padding: '4px 0', outline: 'none' }}
                          />
                          <div style={{ display: 'flex', gap: 10 }}>
                            <input
                              type="text"
                              placeholder="Start Date (e.g. Oct 20)"
                              value={item.startDate}
                              onChange={(e) => {
                                const updated = [...seasonalList];
                                updated[idx].startDate = e.target.value;
                                setSeasonalList(updated);
                              }}
                              style={{ width: '50%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a1a1aa', fontSize: 11.5, outline: 'none' }}
                            />
                            <input
                              type="text"
                              placeholder="End Date (e.g. Oct 31)"
                              value={item.endDate}
                              onChange={(e) => {
                                const updated = [...seasonalList];
                                updated[idx].endDate = e.target.value;
                                setSeasonalList(updated);
                              }}
                              style={{ width: '50%', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#a1a1aa', fontSize: 11.5, outline: 'none' }}
                            />
                          </div>
                          <textarea
                            placeholder="Campaign Instructions"
                            value={item.instructions}
                            onChange={(e) => {
                              const updated = [...seasonalList];
                              updated[idx].instructions = e.target.value;
                              setSeasonalList(updated);
                            }}
                            style={{ background: 'transparent', border: 'none', color: '#a1a1aa', fontSize: 12.5, outline: 'none', resize: 'none', height: 45 }}
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSeasonalList([...seasonalList, { occasion: '', startDate: '', endDate: '', instructions: '' }])}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                    >
                      + Add Daily Poster Campaign
                    </button>
                  </div>
                )}

                {entryType === 'creative_brief' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 5 }}>Brand Visual Style</label>
                      <select value={cbBrandStyle} onChange={(e) => setCbBrandStyle(e.target.value)} style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                        <option value="Modern">Modern</option>
                        <option value="Luxury">Luxury</option>
                        <option value="Premium">Premium</option>
                        <option value="Minimal">Minimalist</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 5 }}>Brand Colors</label>
                      <input
                        type="text"
                        placeholder="Type color and press Enter"
                        value={cbBrandColorsText}
                        onChange={(e) => setCbBrandColorsText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = cbBrandColorsText.trim();
                            if (val && !cbBrandColors.includes(val)) setCbBrandColors([...cbBrandColors, val]);
                            setCbBrandColorsText('');
                          }
                        }}
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {cbBrandColors.map(tag => (
                          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                            {tag}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setCbBrandColors(cbBrandColors.filter(t => t !== tag))} />
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 5 }}>Image Preferences</label>
                      <input
                        type="text"
                        placeholder="Type style preference and press Enter"
                        value={cbImageStyleText}
                        onChange={(e) => setCbImageStyleText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = cbImageStyleText.trim();
                            if (val && !cbImageStyle.includes(val)) setCbImageStyle([...cbImageStyle, val]);
                            setCbImageStyleText('');
                          }
                        }}
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {cbImageStyle.map(tag => (
                          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                            {tag}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setCbImageStyle(cbImageStyle.filter(t => t !== tag))} />
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 5 }}>Do Not Use</label>
                      <input
                        type="text"
                        placeholder="Type negative prompt and press Enter"
                        value={cbNegativeText}
                        onChange={(e) => setCbNegativeText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = cbNegativeText.trim();
                            if (val && !cbNegative.includes(val)) setCbNegative([...cbNegative, val]);
                            setCbNegativeText('');
                          }
                        }}
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none' }}
                      />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {cbNegative.map(tag => (
                          <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(239,68,68,0.08)', color: '#ef4444', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>
                            {tag}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setCbNegative(cbNegative.filter(t => t !== tag))} />
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 700, marginBottom: 5 }}>Typography Notes</label>
                      <textarea
                        value={cbTypography}
                        onChange={(e) => setCbTypography(e.target.value)}
                        placeholder="e.g. Bold headings, clean sans-serif fonts only"
                        style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 8, padding: '10px 12px', color: '#fff', fontSize: 12.5, outline: 'none', resize: 'vertical', minHeight: 60 }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* AI Directive Preview Panel */}
                {(() => {
                  let previewText = '';
                  if (entryType === 'tone') {
                    previewText = `Voice/Tone: ${toneVoice}\nStyle: ${toneStyles.join(', ') || 'None'}\nEmojis: ${toneEmoji}\nResponse Length: ${toneLength}\nAvoid: ${toneAvoid.join(', ') || 'None'}`;
                  } else if (entryType === 'review_rules') {
                    previewText = `For Positive reviews: ${rgPositive || 'Default'}\nFor Neutral reviews: ${rgNeutral || 'Default'}\nFor Negative reviews: ${rgNegative || 'Default'}\nAdditional: ${rgAdditional.join(', ')}`;
                  } else if (entryType === 'keyword') {
                    previewText = `Include these terms naturally: ${kwTags.join(', ') || 'None'}`;
                  } else if (entryType === 'blacklist') {
                    previewText = `NEVER use these words: ${blTags.join(', ') || 'None'}`;
                  } else if (entryType === 'offer') {
                    previewText = offersList.map(o => `[Offer: ${o.title || 'Untitled'}] ${o.description || 'No description'}${o.validUntil ? ` (Valid: ${o.validUntil})` : ''}`).join('\n');
                  } else if (entryType === 'qa') {
                    previewText = qaList.map(q => `Q: ${q.question || 'Empty'}\nA: ${q.answer || 'Empty'}`).join('\n\n');
                  } else if (entryType === 'seasonal') {
                    previewText = seasonalList.map(s => `[Season: ${s.occasion || 'Untitled'}] ${s.startDate} to ${s.endDate} - Instructions: ${s.instructions || 'None'}`).join('\n');
                  } else if (entryType === 'creative_brief') {
                    previewText = `Style: ${cbBrandStyle}\nColors: ${cbBrandColors.join(', ')}\nVisuals: ${cbImageStyle.join(', ')}\nAvoid: ${cbNegative.join(', ')}\nTypography: ${cbTypography}`;
                  }
                  return (
                    <div style={{ marginTop: 10, background: '#1c1c1f', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 10, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <Sparkles size={13} color="#f97316" />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI Directive Preview</span>
                      </div>
                      <pre style={{ margin: 0, fontSize: 11.5, color: '#a1a1aa', whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.5 }}>
                        {previewText || 'No configuration entered yet.'}
                      </pre>
                    </div>
                  );
                })()}

                <button
                  type="submit"
                  disabled={saving}
                  style={{ width: '100%', background: 'linear-gradient(135deg,#f97316,#ea580c)', border: 'none', borderRadius: 8, padding: '14px', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', transition: 'opacity 0.2s', opacity: saving ? 0.7 : 1, boxShadow: '0 4px 14px rgba(249,115,22,0.3)' }}
                >
                  <Plus size={15} />
                  {saving ? 'Saving...' : activeEntryId ? `Update ${cardTypes.find(c => c.type === entryType)?.title}` : `Save ${cardTypes.find(c => c.type === entryType)?.title}`}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Bottom Section: List of Saved Entries */}
        <div style={{ background: '#121214', border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 18, padding: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
          <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid rgba(255,255,255,0.08)`, paddingBottom: 18, marginBottom: 24, gap: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              Saved Entries — {clientName}
              <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', color: '#71717a', padding: '3px 9px', borderRadius: 12 }}>
                {entries.length} active
              </span>
            </h2>

            {/* List Filter Toolbar */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => setActiveTab('all')}
                style={{ background: activeTab === 'all' ? 'rgba(255,255,255,0.08)' : 'transparent', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 14px', color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
              >
                All
              </button>
              {cardTypes.map(c => (
                <button
                  key={c.type}
                  onClick={() => setActiveTab(c.type)}
                  style={{ background: activeTab === c.type ? 'rgba(255,255,255,0.08)' : 'transparent', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 14px', color: activeTab === c.type ? '#fff' : '#71717a', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}
                >
                  {c.title}
                </button>
              ))}
            </div>
          </div>

          {entriesLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#71717a', fontSize: 13 }}>
              Loading brain entries...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#71717a', fontSize: 13 }}>
              No brain entries found for this {activeTab === 'all' ? 'client' : `category`}. Add one above!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {filteredEntries.map((entry) => {
                const isEditing = editingId === entry.id;
                const badge = getBadgeStyle(entry.entry_type);

                // Find card type config to get category color
                const categoryColor = cardTypes.find(c => c.type === entry.entry_type.toLowerCase())?.color || '#a1a1aa';

                return (
                  <div
                    key={entry.id}
                    className="entry-row flex-col-mobile"
                    style={{
                      background: '#18181b',
                      border: `1px solid rgba(255, 255, 255, 0.05)`,
                      borderRadius: 12,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 20,
                      borderLeft: `4px solid ${categoryColor}`
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1 }} className="flex-col-mobile">
                      <span style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '4px 10px',
                        borderRadius: 6,
                        textTransform: 'uppercase',
                        letterSpacing: 0.6,
                        alignSelf: 'flex-start',
                        minWidth: 90,
                        textAlign: 'center',
                        ...badge
                      }}>
                        {cardTypes.find(c => c.type === entry.entry_type.toLowerCase())?.title || entry.entry_type}
                      </span>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                          {entry.entry_type === 'seasonal' && (
                            <input
                              type="text"
                              placeholder="Season Title (e.g. Summer Camp)"
                              value={editSeasonTitle}
                              onChange={(e) => setEditSeasonTitle(e.target.value)}
                              style={{ width: '100%', background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, color: '#fff', fontSize: 13, padding: '10px 12px', outline: 'none' }}
                            />
                          )}
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            style={{ flex: 1, minHeight: 65, background: '#1c1c1f', border: `1px solid rgba(255,255,255,0.08)`, borderRadius: 6, color: '#fff', fontSize: 13, padding: 10, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
                          />
                        </div>
                      ) : (
                        <div style={{ flex: 1 }}>
                          {(() => {
                            try {
                              const parsed = JSON.parse(entry.content);
                              if (typeof parsed !== 'object' || parsed === null) {
                                return <p style={{ fontSize: 13, color: '#cbd5e1', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.content}</p>;
                              }

                              if (entry.entry_type === 'tone') {
                                return (
                                  <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
                                    <div style={{ marginBottom: 4 }}><strong>Voice/Tone:</strong> <span style={{ color: '#fff' }}>{parsed.voice}</span></div>
                                    <div style={{ marginBottom: 4 }}><strong>Style:</strong> <span style={{ color: '#fff' }}>{parsed.style?.join(', ') || 'None'}</span></div>
                                    <div style={{ marginBottom: 4 }}><strong>Emoji Usage:</strong> <span style={{ color: '#fff' }}>{parsed.emoji}</span></div>
                                    <div style={{ marginBottom: 4 }}><strong>Length:</strong> <span style={{ color: '#fff' }}>{parsed.length}</span></div>
                                    {parsed.avoid?.length > 0 && <div><strong>Avoid:</strong> <span style={{ color: '#ef4444' }}>{parsed.avoid.join(', ')}</span></div>}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'review_rules') {
                                return (
                                  <div style={{ fontSize: 12.5, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {parsed.positive && <div><strong style={{ color: '#22c55e' }}>Positive Reviews:</strong> <span style={{ color: '#cbd5e1' }}>{parsed.positive}</span></div>}
                                    {parsed.neutral && <div><strong style={{ color: '#eab308' }}>Neutral Reviews:</strong> <span style={{ color: '#cbd5e1' }}>{parsed.neutral}</span></div>}
                                    {parsed.negative && <div><strong style={{ color: '#ef4444' }}>Negative Reviews:</strong> <span style={{ color: '#cbd5e1' }}>{parsed.negative}</span></div>}
                                    {parsed.additional?.length > 0 && <div><strong>Additional:</strong> <span style={{ color: '#cbd5e1' }}>{parsed.additional.join(', ')}</span></div>}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'keyword') {
                                return (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {parsed.map(tag => (
                                      <span key={tag} style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)', color: '#f59e0b', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{tag}</span>
                                    ))}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'blacklist') {
                                return (
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {parsed.map(tag => (
                                      <span key={tag} style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#ef4444', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{tag}</span>
                                    ))}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'offer') {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {parsed.map((o, idx) => (
                                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{o.title}</div>
                                        <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>{o.description}</div>
                                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#71717a', marginTop: 4 }}>
                                          {o.validUntil && <span>Valid: {o.validUntil}</span>}
                                          {o.cta && <span>CTA: {o.cta}</span>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'qa') {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {parsed.map((q, idx) => (
                                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f97316' }}>Q: {q.question}</div>
                                        <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 2 }}>A: {q.answer}</div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'seasonal') {
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {parsed.map((s, idx) => (
                                      <div key={idx} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899' }}>{s.occasion} ({s.startDate} to {s.endDate})</div>
                                        <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{s.instructions}</div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              }
                              if (entry.entry_type === 'creative_brief') {
                                return (
                                  <div style={{ fontSize: 12.5, color: '#94a3b8', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                                    <div><strong>Style:</strong> <span style={{ color: '#fff' }}>{parsed.brandStyle}</span></div>
                                    <div><strong>Colors:</strong> <span style={{ color: '#fff' }}>{parsed.brandColors?.join(', ') || 'Any'}</span></div>
                                    <div><strong>Visuals:</strong> <span style={{ color: '#fff' }}>{parsed.imageStyle?.join(', ') || 'Any'}</span></div>
                                    <div><strong>Avoid:</strong> <span style={{ color: '#ef4444' }}>{parsed.negativePrompt?.join(', ') || 'None'}</span></div>
                                    <div style={{ gridColumn: 'span 2' }}><strong>Typography:</strong> <span style={{ color: '#fff' }}>{parsed.typography || 'None'}</span></div>
                                  </div>
                                );
                              }
                            } catch (e) {
                              return <p style={{ fontSize: 13, color: '#cbd5e1', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{entry.content}</p>;
                            }
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Actions panel */}
                    <div style={{ display: 'flex', gap: 8, alignSelf: 'center' }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleUpdateEntry(entry.id, entry.entry_type)}
                            title="Save"
                            style={{ background: 'rgba(34,197,94,0.1)', border: 'none', borderRadius: 6, padding: 8, color: '#22c55e', display: 'flex', cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,197,94,0.1)'}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditContent('');
                              setEditSeasonTitle('');
                            }}
                            title="Cancel"
                            style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6, padding: 8, color: '#a1a1aa', display: 'flex', cursor: 'pointer' }}
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(entry.id);
                              if (entry.entry_type === 'seasonal') {
                                try {
                                  const parsed = JSON.parse(entry.content);
                                  setEditSeasonTitle(parsed.title || '');
                                  setEditContent(parsed.text || '');
                                } catch (e) {
                                  setEditSeasonTitle('');
                                  setEditContent(entry.content);
                                }
                              } else {
                                setEditContent(entry.content);
                              }
                            }}
                            title="Edit"
                            style={{ background: 'rgba(255,255,255,0.04)', border: 'none', borderRadius: 6, padding: 8, color: '#a1a1aa', display: 'flex', cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(entry.id)}
                            title="Delete"
                            style={{ background: 'rgba(239,68,68,0.08)', border: 'none', borderRadius: 6, padding: 8, color: '#ef4444', display: 'flex', cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
