import React, { forwardRef } from 'react';

const SeoReportTemplate = forwardRef(({ data }, ref) => {
  if (!data) return null;

  // AIOSEO-style blue theme
  const primaryColor = '#1a73e8';
  const successColor = '#22c55e';
  const warningColor = '#f59e0b';
  const dangerColor = '#ef4444';
  const textColor = '#333333';

  const getScoreColor = (score) => {
    if (score >= 80) return successColor;
    if (score >= 50) return warningColor;
    return dangerColor;
  };

  const getScoreText = (score) => {
    if (score >= 80) return "Excellent";
    if (score >= 50) return "Good";
    return "Needs Improvement";
  };

  const styles = {
    page: {
      width: '100%',
      backgroundColor: '#ffffff',
      color: textColor,
      fontFamily: 'Arial, sans-serif',
      padding: '0', // We manage padding per section now for full-bleed cover
    },
    // --- New Cover Page Styles ---
    coverPage: {
      height: '10.5in', // slightly less than 11in to prevent overflow blank pages
      position: 'relative',
      padding: '60px',
      boxSizing: 'border-box',
      overflow: 'hidden'
    },
    coverTitle: {
      fontSize: '48px',
      color: primaryColor,
      fontWeight: 'bold',
      margin: '0 0 16px 0',
      letterSpacing: '-1px'
    },
    coverUrl: {
      fontSize: '20px',
      color: '#333',
      marginBottom: '24px',
      fontWeight: 'bold'
    },
    coverDateTag: {
      backgroundColor: '#e0f2fe',
      color: '#0369a1',
      padding: '8px 16px',
      borderRadius: '4px',
      display: 'inline-block',
      fontSize: '14px',
      fontWeight: 'bold'
    },
    coverGraphic: {
      position: 'absolute',
      bottom: '-100px',
      right: '-100px',
      width: '600px',
      height: '600px',
      backgroundColor: primaryColor,
      borderRadius: '50%',
      opacity: 0.9
    },
    coverGraphicLight: {
      position: 'absolute',
      bottom: '-150px',
      left: '-200px',
      width: '800px',
      height: '800px',
      backgroundColor: '#bae6fd',
      borderRadius: '50%',
      opacity: 0.5
    },
    brandFooter: {
      position: 'absolute',
      bottom: '40px',
      left: '60px',
      fontSize: '16px',
      fontWeight: 'bold',
      color: '#fff',
      zIndex: 10
    },
    // --- Table of Contents Styles ---
    tocPage: {
      padding: '60px',
      height: '10.5in',
      boxSizing: 'border-box'
    },
    tocTitle: {
      fontSize: '32px',
      color: '#0f172a',
      borderLeft: `8px solid ${primaryColor}`,
      paddingLeft: '16px',
      marginBottom: '40px'
    },
    tocItem: {
      display: 'flex',
      alignItems: 'baseline',
      marginBottom: '20px',
      fontSize: '18px',
      color: '#333'
    },
    tocDots: {
      flex: 1,
      borderBottom: '2px dotted #cbd5e1',
      margin: '0 12px'
    },
    // --- Standard Section Styles ---
    standardPage: {
      padding: '40px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingBottom: '20px',
      borderBottom: '2px solid #f0f0f0',
      marginBottom: '40px'
    },
    section: {
      marginBottom: '40px',
      pageBreakInside: 'avoid'
    },
    scoreCircle: {
      width: '200px',
      height: '200px',
      borderRadius: '50%',
      border: `12px solid ${getScoreColor(data.overallScore)}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 20px auto'
    },
    box: {
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      padding: '20px',
      marginBottom: '20px',
      backgroundColor: '#f9fafb'
    },
    list: {
      listStyle: 'none',
      padding: 0,
      margin: 0
    },
    listItem: {
      padding: '12px 16px',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  };

  const renderCheckList = (categoryData, title) => {
    if (!categoryData) return null;
    return (
      <div style={{ ...styles.section, pageBreakInside: 'avoid' }}>
        <h2 style={{ fontSize: '20px', color: primaryColor, marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>{title}</h2>
        <ul style={styles.list}>
          {categoryData.failed.map((check, idx) => (
            <li key={`failed-${idx}`} style={{ ...styles.listItem, borderLeft: `4px solid ${dangerColor}`, backgroundColor: '#fef2f2' }}>
              <span style={{ color: dangerColor, fontWeight: 'bold', fontSize: '18px' }}>✕</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', lineHeight: '1.5', fontWeight: 'bold' }}>{check.title || check}</span>
                {check.description && <span style={{ fontSize: '12px', lineHeight: '1.5', color: '#666', marginTop: '4px' }}>{check.description}</span>}
              </div>
            </li>
          ))}
          {categoryData.passed.map((check, idx) => (
            <li key={`passed-${idx}`} style={{ ...styles.listItem, borderLeft: `4px solid ${successColor}`, backgroundColor: '#f0fdf4' }}>
              <span style={{ color: successColor, fontWeight: 'bold', fontSize: '18px' }}>✓</span>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '14px', lineHeight: '1.5', fontWeight: 'bold' }}>{check.title || check}</span>
                {check.description && <span style={{ fontSize: '12px', lineHeight: '1.5', color: '#666', marginTop: '4px' }}>{check.description}</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div ref={ref} style={styles.page}>
      
      {/* 1. COVER PAGE */}
      <div style={styles.coverPage}>
        <div style={styles.coverTitle}>SEO Analysis Report</div>
        <div style={styles.coverUrl}>{data.url}</div>
        <div style={styles.coverDateTag}>Generated on {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
        
        {/* Background Graphics */}
        <div style={styles.coverGraphicLight}></div>
        <div style={styles.coverGraphic}></div>
        
        <div style={styles.brandFooter}>Powered by LeadOS</div>
      </div>

      <div className="html2pdf__page-break"></div>

      {/* 2. TABLE OF CONTENTS PAGE */}
      <div style={styles.tocPage}>
        <h2 style={styles.tocTitle}>Table of Contents</h2>
        
        <div style={styles.tocItem}>
          <span>Overview</span><div style={styles.tocDots}></div><span>3</span>
        </div>
        <div style={styles.tocItem}>
          <span>Gemini AI Insights</span><div style={styles.tocDots}></div><span>4</span>
        </div>
        <div style={styles.tocItem}>
          <span>On-Page SEO</span><div style={styles.tocDots}></div><span>5</span>
        </div>
        <div style={styles.tocItem}>
          <span>Technical SEO</span><div style={styles.tocDots}></div><span>6</span>
        </div>
        <div style={styles.tocItem}>
          <span>Social Tags</span><div style={styles.tocDots}></div><span>7</span>
        </div>
        <div style={styles.tocItem}>
          <span>Link Analysis</span><div style={styles.tocDots}></div><span>8</span>
        </div>
      </div>

      <div className="html2pdf__page-break"></div>

      {/* 3. REPORT CONTENT (Standard Padding) */}
      <div style={styles.standardPage}>
        {/* HEADER */}
        <div style={styles.header}>
          <div>
            <h1 style={{ fontSize: '24px', color: primaryColor, margin: '0 0 8px 0' }}>SEO Audit Report</h1>
            <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>Generated for: <strong>{data.url}</strong></p>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#888' }}>
            <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: primaryColor }}>LeadOS Business Solutions</p>
            <p style={{ margin: 0 }}>Date: {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        {/* OVERVIEW SCORE */}
        <div style={{ ...styles.section, textAlign: 'center', marginBottom: '60px' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '40px' }}>Overall Site Score</h2>
          <div style={styles.scoreCircle}>
            <span style={{ fontSize: '64px', fontWeight: 'bold', color: getScoreColor(data.overallScore), lineHeight: '1' }}>{data.overallScore}</span>
            <span style={{ fontSize: '16px', color: '#666', fontWeight: 'bold' }}>/ 100</span>
          </div>
          <p style={{ fontSize: '18px', fontWeight: 'bold', color: getScoreColor(data.overallScore) }}>{getScoreText(data.overallScore)}</p>
          <p style={{ fontSize: '14px', color: '#666', maxWidth: '600px', margin: '20px auto' }}>
            A score between 60 and 80 is very good. For best results, strive for 80 and above to dominate search rankings.
          </p>
        </div>

        {/* STATS ROW */}
        <div style={{ ...styles.section, display: 'flex', gap: '20px' }}>
          <div style={{ ...styles.box, flex: 1, textAlign: 'center', borderTop: `4px solid ${dangerColor}` }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: dangerColor }}>
              {data.categories.onPage.failed.length + data.categories.technical.failed.length + data.categories.social.failed.length}
            </div>
            <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '8px' }}>Critical Issues</div>
          </div>
          <div style={{ ...styles.box, flex: 1, textAlign: 'center', borderTop: `4px solid ${primaryColor}` }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: primaryColor }}>{data.aiContent.recommendations.length}</div>
            <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '8px' }}>AI Recommended</div>
          </div>
          <div style={{ ...styles.box, flex: 1, textAlign: 'center', borderTop: `4px solid ${successColor}` }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: successColor }}>
              {data.categories.onPage.passed.length + data.categories.technical.passed.length + data.categories.social.passed.length}
            </div>
            <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', fontWeight: 'bold', marginTop: '8px' }}>Good Results</div>
          </div>
        </div>

        <div className="html2pdf__page-break"></div>

        {/* AI ANALYSIS */}
        <div style={{ ...styles.section, marginTop: '40px' }}>
          <h2 style={{ fontSize: '20px', color: '#8b5cf6', marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>
            Gemini AI Content Insights
          </h2>
          <div style={{ ...styles.box, backgroundColor: '#f5f3ff', borderLeft: '4px solid #8b5cf6' }}>
            <ul style={{ ...styles.list, marginLeft: '20px', listStyleType: 'disc' }}>
              {data.aiContent.recommendations.map((rec, idx) => (
                <li key={idx} style={{ marginBottom: '12px', fontSize: '14px', lineHeight: '1.6', color: '#333' }}>{rec}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="html2pdf__page-break"></div>

        {/* TECHNICAL BREAKDOWNS */}
        {renderCheckList(data.categories.onPage, "On-Page SEO")}
        <div className="html2pdf__page-break"></div>
        {renderCheckList(data.categories.technical, "Technical SEO")}
        {renderCheckList(data.categories.social, "Social Tags")}

        <div className="html2pdf__page-break"></div>

        {/* LINK METRICS */}
        <div style={{ ...styles.section, pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '20px', color: primaryColor, marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>Link Analysis</h2>
          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ ...styles.box, flex: 1 }}>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>Internal Links</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: primaryColor }}>{data.links.internal}</div>
            </div>
            <div style={{ ...styles.box, flex: 1 }}>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>External Links</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: primaryColor }}>{data.links.external}</div>
            </div>
            <div style={{ ...styles.box, flex: 1 }}>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>Broken Links</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: data.links.broken > 0 ? dangerColor : successColor }}>{data.links.broken}</div>
            </div>
          </div>
        </div>

        {/* KEYWORDS */}
        <div style={{ ...styles.section, pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: '20px', color: primaryColor, marginBottom: '16px', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>Top Discovered Keywords</h2>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {data.keywords.map((kw, idx) => (
              <div key={idx} style={{ padding: '8px 16px', backgroundColor: '#e0f2fe', color: '#0369a1', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                {kw.word} ({kw.count})
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
});

export default SeoReportTemplate;
