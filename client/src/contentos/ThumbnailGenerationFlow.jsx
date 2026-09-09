import React, { useState, useEffect } from 'react';
import { loadConfig } from './thumbnailBrain/thumbnailBrainConfig.js';
import { renderTextOverlayCanvas, extractPunchyHeadline, extractMarketingCopy } from '../src/utils/canvasTextOverlay.js';

import {
  Video,
  FileText,
  Share2,
  Image as ImageIcon,
  Database,
  Cloud,
  Wand2,
  Play,
  Pause,
  Upload,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Download,
  Eye,
  Sliders,
  Check,
  Cpu,
  Layers,
  Zap,
  Info,
  ChevronRight,
  ExternalLink
} from 'lucide-react';

// Sample pre-loaded frame options for demo
const INITIAL_FRAMES = [
  {
    id: 1,
    timecode: '00:04',
    title: 'Opening Hook',
    description: 'Speaker gesture with high emotional focus',
    gradient: 'from-slate-700 via-indigo-900 to-slate-900',
    accentColor: '#6366F1',
    score: '98% Clarity',
    src: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 2,
    timecode: '00:14',
    title: 'Key Reaction',
    description: 'Dynamic facial expression & wide eye contact',
    gradient: 'from-stone-700 via-amber-900 to-slate-900',
    accentColor: '#F59E0B',
    score: '95% Engagement',
    src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 3,
    timecode: '00:28',
    title: 'Product Focus',
    description: 'High contrast product closeup with depth of field',
    gradient: 'from-slate-800 via-emerald-950 to-stone-900',
    accentColor: '#10B981',
    score: '92% Impact',
    src: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
  },
  {
    id: 4,
    timecode: '00:42',
    title: 'Outro CTA',
    description: 'Clean architectural framing for bold text overlay',
    gradient: 'from-indigo-950 via-slate-900 to-cyan-950',
    accentColor: '#06B6D4',
    score: '99% Text Safe',
    src: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=800&q=80',
  },
];

export function ThumbnailGenerationFlow() {
  // State pipeline
  const [videoLoaded, setVideoLoaded] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTone, setSelectedTone] = useState('Authoritative');
  const [isExtractingCaptions, setIsExtractingCaptions] = useState(false);
  
  // Social Media Data State
  const [title, setTitle] = useState(
    'Architectural OS: Scaling Enterprise Content Workflows with AI Precision'
  );
  const [description, setDescription] = useState(
    'Explore how leading digital agencies structure their automated content pipelines for maximum reach, zero latency, and absolute brand integrity.'
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState(['youtube', 'instagram', 'linkedin']);

  // Selective Frame Slot State
  const [selectedFrameId, setSelectedFrameId] = useState(1);
  const selectedFrame = INITIAL_FRAMES.find((f) => f.id === selectedFrameId) || INITIAL_FRAMES[0];

  // Processing & Final Output State
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [finalThumbnailGenerated, setFinalThumbnailGenerated] = useState(true);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [stylePreset, setStylePreset] = useState('Architectural Editorial');

  // Thumbnail Brain Config & Marketing Overlay State
  const brainConfig = loadConfig();
  const textOverlayConfig = brainConfig.textOverlay || {};

  const [overlayTitle, setOverlayTitle] = useState(textOverlayConfig.customHeadline || 'BECOME A DATA ANALYST');
  const [overlaySubtitle, setOverlaySubtitle] = useState(textOverlayConfig.subtitle || 'Placement in 90 Days');
  const [overlayCtaBadge, setOverlayCtaBadge] = useState(textOverlayConfig.ctaBadge || 'Admissions Open');
  const [renderedPosterUrl, setRenderedPosterUrl] = useState(null);

  // Auto-extract headline when description changes if auto mode enabled
  useEffect(() => {
    if (description) {
      const copy = extractMarketingCopy(description);
      if (textOverlayConfig.headlineSource === 'auto') {
        setOverlayTitle(copy.title);
      }
      setOverlaySubtitle(copy.subtitle);
      setOverlayCtaBadge(copy.cta);
    }
  }, [description]);

  // Re-render poster canvas whenever frame, marketing copy or config changes
  useEffect(() => {
    let isMounted = true;
    if (selectedFrame?.src && textOverlayConfig.enabled !== false) {
      renderTextOverlayCanvas(selectedFrame.src, {
        title: overlayTitle,
        subtitle: overlaySubtitle,
        ctaBadge: overlayCtaBadge,
        fontFamily: textOverlayConfig.fontFamily || 'Anton',
        fontSize: textOverlayConfig.fontSize || 54,
        textColor: textOverlayConfig.textColor || '#FFFFFF',
        strokeColor: textOverlayConfig.strokeColor || '#000000',
        strokeWidth: textOverlayConfig.strokeWidth || 6,
        bgColor: textOverlayConfig.bgColor || 'rgba(249, 115, 22, 0.95)',
        subBgColor: textOverlayConfig.subBgColor || 'rgba(15, 23, 42, 0.9)',
        subTextColor: textOverlayConfig.subTextColor || '#E2E8F0',
        ctaBgColor: textOverlayConfig.ctaBgColor || '#10B981',
        ctaTextColor: textOverlayConfig.ctaTextColor || '#FFFFFF',
        bgPadding: textOverlayConfig.bgPadding || 14,
        borderRadius: textOverlayConfig.borderRadius || 8,
        shadowColor: textOverlayConfig.shadowColor || 'rgba(0, 0, 0, 0.75)',
        shadowBlur: textOverlayConfig.shadowBlur || 14,
        position: textOverlayConfig.position || 'top_left',
        showBgPill: textOverlayConfig.showBgPill !== false,
        showSubtitle: textOverlayConfig.showSubtitle !== false,
        showCtaBadge: textOverlayConfig.showCtaBadge !== false,
      }).then((url) => {
        if (isMounted) setRenderedPosterUrl(url);
      }).catch(err => console.warn('Overlay render error:', err));
    }
    return () => { isMounted = false; };
  }, [selectedFrame, overlayTitle, overlaySubtitle, overlayCtaBadge]);


  // Handle caption & thumbnail copy generation trigger
  const handleGenerateCaptions = () => {
    setIsExtractingCaptions(true);
    setTimeout(() => {
      setIsExtractingCaptions(false);
      setTitle('Building High-Yield Content Engine: 5 Structural Principles');
      setDescription('In this breakdown, we unpack the exact database-backed workflow architecture used to generate high-performing video thumbnails and social captions automatically.');
      setOverlayTitle('BECOME A DATA ANALYST');
      setOverlaySubtitle('Placement in 90 Days');
      setOverlayCtaBadge('Admissions Open');
    }, 600);
  };


  // Handle final thumbnail generation
  const handleGenerateThumbnail = () => {
    setIsGenerating(true);
    setGenerationProgress(15);
    
    const interval = setInterval(() => {
      setGenerationProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsGenerating(false);
          setFinalThumbnailGenerated(true);
          return 100;
        }
        return prev + 25;
      });
    }, 200);
  };

  const togglePlatform = (p) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    );
  };

  return (
    <div className="w-full bg-[#FAFAFA] min-h-screen text-slate-800 font-sans p-4 md:p-8 selection:bg-slate-200">
      
      {/* ── ARCHITECTURAL HEADER ── */}
      <header className="max-w-7xl mx-auto mb-8 border-b border-slate-200 pb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-600"></span>
              <span className="font-mono text-xs uppercase tracking-widest text-slate-500 font-semibold">
                Content OS Pipeline Architecture
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-medium tracking-tight text-slate-900">
              Thumbnail Generation Flow
            </h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl font-light leading-relaxed">
              Sequential video-to-thumbnail pipeline utilizing automated frame analysis, neural prompt mapping, and cloud API rendering.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono text-slate-600 shadow-sm">
              <span className="text-emerald-600 font-bold">● ONLINE</span>
              <span className="text-slate-300">|</span>
              <span>BRAIN DB v2.4</span>
            </div>
            <button
              onClick={() => {
                setVideoLoaded(true);
                setFinalThumbnailGenerated(true);
              }}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Flow
            </button>
          </div>
        </div>
      </header>

      {/* ── PIPELINE FLOW CONTAINER ── */}
      <main className="max-w-7xl mx-auto space-y-8">

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 1: VIDEO VIEW CONTAINER (PRIMARY BLUE BLOCK) */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-sm">
          {/* Header Bar */}
          <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                01
              </div>
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-blue-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Primary Video View Container
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-blue-300 bg-blue-950/80 border border-blue-800/60 px-2.5 py-0.5 rounded">
              INPUT SOURCE NODE
            </span>
          </div>

          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Video Player Display */}
            <div className="lg:col-span-8 space-y-4">
              <div className="relative aspect-video bg-slate-950 rounded-lg overflow-hidden border border-slate-800 group shadow-inner">
                {videoLoaded ? (
                  <div className="relative w-full h-full flex flex-col justify-between p-4">
                    {/* Background Visual Mockup */}
                    <img
                      src={selectedFrame.src}
                      alt="Source Video Frame"
                      className="absolute inset-0 w-full h-full object-cover opacity-80"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent"></div>

                    {/* Top Overlay */}
                    <div className="relative z-10 flex justify-between items-start">
                      <span className="bg-slate-900/90 text-slate-200 font-mono text-xs px-2.5 py-1 rounded border border-slate-700/80 backdrop-blur-sm">
                        SOURCE_MASTER_VIDEO_01.MP4
                      </span>
                      <span className="bg-blue-600/90 text-white font-mono text-[10px] uppercase font-bold px-2 py-0.5 rounded backdrop-blur-sm">
                        1080p • 60 FPS
                      </span>
                    </div>

                    {/* Play Button Overlay */}
                    <div className="relative z-10 flex items-center justify-center my-auto">
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="w-14 h-14 rounded-full bg-white/90 hover:bg-white text-slate-900 flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 active:scale-95"
                      >
                        {isPlaying ? (
                          <Pause className="w-6 h-6 fill-current text-slate-900" />
                        ) : (
                          <Play className="w-6 h-6 fill-current text-slate-900 ml-1" />
                        )}
                      </button>
                    </div>

                    {/* Bottom Controls Bar */}
                    <div className="relative z-10 space-y-2 bg-slate-900/90 p-3 rounded-lg border border-slate-800/80 backdrop-blur-sm">
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full w-1/3"></div>
                      </div>
                      <div className="flex justify-between items-center text-[11px] font-mono text-slate-300">
                        <span>00:14 / 00:45</span>
                        <div className="flex items-center gap-3">
                          <span>BITRATE: 18.4 Mbps</span>
                          <span>AUDIO: 48kHz Stereo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-slate-900">
                    <Upload className="w-10 h-10 text-slate-600 mb-3" />
                    <p className="text-sm font-medium text-slate-300">Upload Source Video File</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Drag & drop MP4 or MOV file up to 500MB
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Source Metadata & Specifications */}
            <div className="lg:col-span-4 flex flex-col justify-between bg-slate-50 rounded-lg p-5 border border-slate-200/80">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold mb-3">
                  Video Master Specifications
                </h3>
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Filename:</span>
                    <span className="text-slate-800 font-medium truncate max-w-[170px]">content_os_master.mp4</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Duration:</span>
                    <span className="text-slate-800 font-medium">00:45 Seconds</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Resolution:</span>
                    <span className="text-slate-800 font-medium">1080 × 1920 (Vertical)</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">File Size:</span>
                    <span className="text-slate-800 font-medium">42.8 MB</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">Keyframe Analysis:</span>
                    <span className="text-emerald-700 font-medium">4 Selected</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200">
                <button
                  onClick={handleGenerateCaptions}
                  disabled={isExtractingCaptions}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  {isExtractingCaptions ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Processing Audio Track...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5" />
                      Proceed to Caption Generation
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 1 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 2: CAPTION GENERATION STEP */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                02
              </div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Caption Generation Module
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-indigo-300 bg-indigo-950/80 border border-indigo-800/60 px-2.5 py-0.5 rounded">
              NLP PROCESSING NODE
            </span>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-4 space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Editorial Tone Selection
                </label>
                <select
                  value={selectedTone}
                  onChange={(e) => setSelectedTone(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-lg p-2.5 focus:outline-none focus:border-blue-600 font-medium"
                >
                  <option value="Authoritative">Authoritative / Enterprise</option>
                  <option value="Engaging">Engaging / High Contrast</option>
                  <option value="Editorial">Editorial / Scholarly</option>
                  <option value="Educational">Educational / Step-by-Step</option>
                </select>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Audio Sync Accuracy:</span>
                  <span className="text-emerald-700 font-bold">99.4%</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Detected Language:</span>
                  <span className="text-slate-800 font-medium">English (US)</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Key Entity Extraction:</span>
                  <span className="text-slate-800 font-medium">Content OS, AI</span>
                </div>
              </div>
            </div>

            <div className="md:col-span-8 space-y-3">
              <label className="block text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                Extracted Transcript & Smart Summary
              </label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 font-serif text-sm text-slate-700 leading-relaxed min-h-[110px]">
                "In this operational guide, we demonstrate the architectural setup of Content OS for managing high-volume social video assets. By linking keyframe extraction directly to prompt synthesis, content teams maintain rigorous visual authority while scaling throughput."
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleGenerateCaptions}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Re-analyze Transcript with AI
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 2 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 3: SOCIAL MEDIA SECTION (INPUT FIELDS) */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-sky-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                03
              </div>
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-sky-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Social Media Section (Metadata Output)
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-sky-300 bg-sky-950/80 border border-sky-800/60 px-2.5 py-0.5 rounded">
              METADATA DISPATCH NODE
            </span>
          </div>

          <div className="p-6 space-y-6">
            {/* Target Platform Chips */}
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold mb-2.5">
                Target Distribution Channels
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'youtube', label: 'YouTube Shorts', color: 'bg-red-50 text-red-700 border-red-200' },
                  { id: 'instagram', label: 'Instagram Reels', color: 'bg-pink-50 text-pink-700 border-pink-200' },
                  { id: 'linkedin', label: 'LinkedIn Video', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  { id: 'facebook', label: 'Facebook Reels', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                ].map((p) => {
                  const active = selectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePlatform(p.id)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${
                        active
                          ? `${p.color} border-current shadow-sm`
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5" />}
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Fields: Title & Description */}
            <div className="grid grid-cols-1 gap-5">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-700 font-semibold">
                    Content Title
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {title.length} / 100 chars
                  </span>
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 font-medium focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
                  placeholder="Enter video title..."
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-mono uppercase tracking-wider text-slate-700 font-semibold">
                    Post Description & Tags
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {description.length} / 500 chars
                  </span>
                </div>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs text-slate-800 font-normal leading-relaxed focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
                  placeholder="Enter social post description..."
                />
              </div>
            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 3 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 4: THUMBNAIL GENERATE ACTION STEP */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center md:text-left">
              <div className="flex items-center gap-2 justify-center md:justify-start">
                <Sparkles className="w-4 h-4 text-amber-600" />
                <h3 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-800">
                  Step 4 — Trigger Visual Generation
                </h3>
              </div>
              <p className="text-xs text-slate-500 font-light">
                Configure render engine specifications and generate the final editorial poster.
              </p>
            </div>

            {/* Controls & Generate Trigger Button */}
            <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">Ratio:</span>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-3 py-2 text-slate-800 focus:outline-none"
                >
                  <option value="16:9">16:9 Landscape</option>
                  <option value="9:16">9:16 Vertical</option>
                  <option value="1:1">1:1 Square</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">Style:</span>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg px-3 py-2 text-slate-800 focus:outline-none"
                >
                  <option value="Architectural Editorial">Architectural Editorial</option>
                  <option value="Hyper-Realistic Cyber">Hyper-Realistic Cyber</option>
                  <option value="Minimal Scholarly">Minimal Scholarly</option>
                </select>
              </div>

              <button
                onClick={handleGenerateThumbnail}
                disabled={isGenerating}
                className="w-full md:w-auto bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs px-6 py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-md transition-all active:scale-98"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
                    Synthesizing ({generationProgress}%)...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 text-amber-400" />
                    Generate Thumbnail Now
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 4 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 5: SELECTIVE FRAME (4 FRAME SLOTS GALLERY) */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-sm">
          <div className="bg-slate-800 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-amber-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                05
              </div>
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-amber-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Selective Frame Sequence (4 Keyframe Slots)
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-amber-300 bg-amber-950/80 border border-amber-800/60 px-2.5 py-0.5 rounded">
              KEYFRAME ANALYZER NODE
            </span>
          </div>

          <div className="p-6">
            <p className="text-xs text-slate-500 mb-4 font-light">
              Select one of the 4 automatically extracted keyframe moments below to seed the AI thumbnail layout engine:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {INITIAL_FRAMES.map((frame) => {
                const isSelected = selectedFrameId === frame.id;
                return (
                  <div
                    key={frame.id}
                    onClick={() => setSelectedFrameId(frame.id)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all cursor-pointer group bg-slate-900 ${
                      isSelected
                        ? 'border-blue-600 shadow-md ring-2 ring-blue-600/20'
                        : 'border-slate-200 hover:border-slate-400 opacity-90 hover:opacity-100'
                    }`}
                  >
                    {/* Frame Preview Image */}
                    <div className="relative aspect-video overflow-hidden">
                      <img
                        src={frame.src}
                        alt={frame.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>

                      {/* Timecode Badge */}
                      <span className="absolute top-2 left-2 font-mono text-[10px] font-bold text-white bg-slate-950/80 border border-slate-700/80 px-2 py-0.5 rounded">
                        {frame.timecode}
                      </span>

                      {/* Active Selection Checkmark */}
                      {isSelected && (
                        <span className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1 shadow-sm">
                          <CheckCircle2 className="w-4 h-4" />
                        </span>
                      )}

                      {/* Score Badge */}
                      <span className="absolute bottom-2 left-2 font-mono text-[9px] text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60">
                        {frame.score}
                      </span>
                    </div>

                    {/* Frame Slot Meta */}
                    <div className="p-3 bg-white border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-slate-900">
                          Slot 0{frame.id}: {frame.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 font-light">
                        {frame.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 5 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 6: PROCESSING LOGIC (BRAIN DB & CLOUD API NODE GRAPH) */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-slate-900 text-white border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="bg-slate-950 px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                06
              </div>
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-emerald-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Processing Logic — Brain DB & Cloud API Flow
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950 border border-emerald-800 px-2.5 py-0.5 rounded">
              NEURAL ROUTING GRAPH
            </span>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              
              {/* NODE A: SELECTED FRAME DATA SOURCE */}
              <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 space-y-3 relative">
                <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    <span className="font-mono text-xs font-bold text-slate-200">
                      FRAME NODE
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">SLOT 0{selectedFrame.id}</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 space-y-1">
                  <p>Timecode: <span className="text-amber-300">{selectedFrame.timecode}</span></p>
                  <p>Anchor: <span className="text-slate-100">{selectedFrame.title}</span></p>
                  <p>Vector: <span className="text-slate-400">512-dim embedding</span></p>
                </div>
              </div>

              {/* CENTER CONNECTORS & BRAIN NODE */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 text-center space-y-3 shadow-inner relative">
                <div className="w-10 h-10 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100">
                    Brain DB / Storage Node
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 font-light">
                    Retrieves brand color palette, font safe zones & prompt rules.
                  </p>
                </div>
                <div className="inline-block bg-slate-900 px-2.5 py-1 rounded text-[10px] font-mono text-emerald-400 border border-slate-800">
                  STATUS: QUERY MATCH (100%)
                </div>
              </div>

              {/* NODE C: CLOUD API GENERATION NODE */}
              <div className="bg-slate-800/90 border border-slate-700 rounded-xl p-4 space-y-3 relative">
                <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-sky-400" />
                    <span className="font-mono text-xs font-bold text-slate-200">
                      CLOUD API NODE
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-sky-400">SYNTHESIS</span>
                </div>
                <div className="font-mono text-[11px] text-slate-300 space-y-1">
                  <p>Engine: <span className="text-sky-300">FLUX.1-Enterprise</span></p>
                  <p>Resolution: <span className="text-slate-100">{aspectRatio} (2K)</span></p>
                  <p>Latency: <span className="text-emerald-400">1.2 seconds</span></p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* CONNECTING PIPELINE CONNECTOR 6 */}
        <div className="flex justify-center -my-3">
          <div className="bg-slate-200 text-slate-500 p-1.5 rounded-full border border-slate-300 shadow-sm">
            <ChevronRight className="w-4 h-4 rotate-90" />
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* PIPELINE STEP 7: FINAL THUMBNAIL CONTAINER */}
        {/* ───────────────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200/90 rounded-xl overflow-hidden shadow-md">
          <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white text-xs font-mono font-bold">
                07
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h2 className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-100">
                  Final Generated Thumbnail Container
                </h2>
              </div>
            </div>
            <span className="font-mono text-[11px] text-emerald-300 bg-emerald-950/80 border border-emerald-800/60 px-2.5 py-0.5 rounded">
              OUTPUT ASSET NODE
            </span>
          </div>

          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Final Poster Preview Display */}
            <div className="lg:col-span-7 space-y-3">
              <div className="relative aspect-video rounded-xl overflow-hidden border border-slate-800 shadow-xl bg-slate-950 group">
                <img
                  src={renderedPosterUrl || selectedFrame.src}
                  alt="Completed Thumbnail"
                  className="w-full h-full object-cover"
                />
                
                {/* Architectural Overlay Tag */}
                <div className="absolute top-3 right-3 flex items-center gap-2">
                  <span className="bg-slate-900/90 text-slate-200 font-mono text-[10px] uppercase font-bold px-2 py-0.5 rounded backdrop-blur-sm border border-slate-700">
                    {aspectRatio} · {textOverlayConfig.fontFamily || 'Anton'} Font
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-slate-500 px-1">
                <span>Asset ID: THUMB_88392_FINAL.PNG</span>
                <span>Rendered via Thumbnail Brain Text Overlay</span>
              </div>
            </div>

            {/* Asset Actions & Export Panel */}
            <div className="lg:col-span-5 bg-slate-50 rounded-xl p-6 border border-slate-200/90 space-y-5">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold mb-2">
                  Thumbnail Asset Summary
                </h3>
                <div className="space-y-2.5 font-mono text-xs">
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Seed Frame:</span>
                    <span className="text-slate-800 font-medium">Slot 0{selectedFrame.id} ({selectedFrame.timecode})</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Preset Style:</span>
                    <span className="text-slate-800 font-medium">{stylePreset}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-500">Google Font:</span>
                    <span className="text-blue-600 font-bold">{textOverlayConfig.fontFamily || 'Anton'}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">Output Quality:</span>
                    <span className="text-emerald-700 font-bold">1920 × 1080 (High-Res)</span>
                  </div>
                </div>
              </div>

              {/* INTERACTIVE PROMOTIONAL MARKETING COPY EDITOR */}
              <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
                <label className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-700 block">
                  🚀 Edit Thumbnail Marketing Copy Stack
                </label>
                
                <div>
                  <label className="text-[10px] font-mono font-semibold text-slate-500 block mb-1">Thumbnail Title</label>
                  <input
                    type="text"
                    value={overlayTitle}
                    onChange={(e) => setOverlayTitle(e.target.value)}
                    placeholder="e.g. BECOME A DATA ANALYST"
                    className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono font-semibold text-slate-500 block mb-1">Subtitle / Outcome</label>
                  <input
                    type="text"
                    value={overlaySubtitle}
                    onChange={(e) => setOverlaySubtitle(e.target.value)}
                    placeholder="e.g. Placement in 90 Days"
                    className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono font-semibold text-slate-500 block mb-1">CTA Badge</label>
                  <input
                    type="text"
                    value={overlayCtaBadge}
                    onChange={(e) => setOverlayCtaBadge(e.target.value)}
                    placeholder="e.g. Admissions Open"
                    className="w-full bg-slate-50 border border-slate-300 rounded px-3 py-1.5 text-xs font-bold text-emerald-700 outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                <p className="text-[10px] text-slate-500 font-mono pt-1">
                  Updates live on thumbnail using {textOverlayConfig.fontFamily || 'Anton'} typography & brand colors.
                </p>
              </div>

              <div className="space-y-2.5 pt-1">
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = renderedPosterUrl || selectedFrame.src;
                    link.download = `marketing-thumbnail-${(overlayTitle || 'promo').toLowerCase().replace(/\s+/g, '-')}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-sm"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  Download High-Res Promotional Thumbnail (.PNG)
                </button>

                <button
                  onClick={() => alert('Successfully attached to Content OS Approval Queue!')}
                  className="w-full bg-white hover:bg-slate-100 text-slate-800 font-medium text-xs py-2.5 px-4 rounded-lg border border-slate-300 flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Attach to Content OS Approval Queue
                </button>
              </div>
            </div>


          </div>
        </section>

      </main>

      {/* FOOTER METADATA */}
      <footer className="max-w-7xl mx-auto mt-12 pt-6 border-t border-slate-200 text-center text-xs font-mono text-slate-400">
        Content OS — Architectural Scholar Design System • Zero Text Animations • Instant Load Integrity
      </footer>
    </div>
  );
}
export default ThumbnailGenerationFlow;
