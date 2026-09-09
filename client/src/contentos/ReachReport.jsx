import { useState, useMemo } from 'react';

const PLATFORM_CONFIG = {
  instagram_post:  { label: 'Instagram Reel',    color: '#DD2A7B', reach: 3200 },
  instagram:       { label: 'Instagram',          color: '#DD2A7B', reach: 3200 },
  facebook_post:   { label: 'Facebook Post/Reel', color: '#1877F2', reach: 1800 },
  facebook:        { label: 'Facebook',           color: '#1877F2', reach: 1800 },
  youtube:         { label: 'YouTube',            color: '#FF0000', reach: 1200 },
  linkedin:        { label: 'LinkedIn',           color: '#0A66C2', reach: 600  },
  x_twitter:       { label: 'X (Twitter)',        color: '#000000', reach: 800  },
};

const BRAND_COLORS = ['#8B72F0','#00C4A0','#34C77B','#F04A5E','#D4A843','#1877F2','#DD2A7B','#FF6B35'];

function getBrandColor(name, index) {
  return BRAND_COLORS[index % BRAND_COLORS.length];
}

function formatReach(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function ReachReport({ items, selectedBrand, isSameBrand }) {
  const [period, setPeriod] = useState('30d');

  const cutoff = useMemo(() => {
    const d = new Date();
    if (period === '7d')  d.setDate(d.getDate() - 7);
    else if (period === '30d') d.setDate(d.getDate() - 30);
    else return null;
    return d;
  }, [period]);

  const publishedItems = useMemo(() => {
    return items.filter(item => {
      const s = (item.status || '').toUpperCase();
      if (s !== 'PUBLISHED' && s !== 'PARTIAL') return false;
      if (selectedBrand !== 'all' && !isSameBrand(item.brand_name, selectedBrand)) return false;
      if (cutoff) {
        const pub = new Date(item.published_at || item.approved_at || item.created_at || 0);
        if (pub < cutoff) return false;
      }
      return true;
    });
  }, [items, selectedBrand, isSameBrand, cutoff]);

  // Platform breakdown
  const platformStats = useMemo(() => {
    const counts = {};
    let totalReach = 0;
    publishedItems.forEach(item => {
      (item.platforms || []).forEach(p => {
        counts[p] = (counts[p] || 0) + 1;
        totalReach += PLATFORM_CONFIG[p]?.reach || 1000;
      });
    });
    return { counts, totalReach };
  }, [publishedItems]);

  // Brand breakdown
  const brandStats = useMemo(() => {
    const map = {};
    publishedItems.forEach(item => {
      const brand = item.brand_name || 'Unknown';
      if (!map[brand]) map[brand] = { posts: 0, reach: 0 };
      map[brand].posts += 1;
      map[brand].reach += (item.platforms || []).reduce((s, p) => s + (PLATFORM_CONFIG[p]?.reach || 1000), 0);
    });
    return Object.entries(map)
      .sort((a, b) => b[1].reach - a[1].reach)
      .map(([name, d], i) => ({ name, ...d, color: getBrandColor(name, i) }));
  }, [publishedItems]);

  // Top platform
  const topPlatform = useMemo(() => {
    const entries = Object.entries(platformStats.counts);
    if (!entries.length) return null;
    const [key] = entries.sort((a, b) => b[1] - a[1])[0];
    return PLATFORM_CONFIG[key] || null;
  }, [platformStats.counts]);

  // Platform rows for breakdown chart
  const platformRows = useMemo(() => {
    const total = Object.values(platformStats.counts).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(platformStats.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        label: PLATFORM_CONFIG[key]?.label || key,
        color: PLATFORM_CONFIG[key]?.color || '#888',
        percent: Math.round((count / total) * 100),
        count
      }));
  }, [platformStats.counts]);

  const totalPosts = publishedItems.length;
  const totalReach = platformStats.totalReach;
  const maxBrandReach = Math.max(...brandStats.map(b => b.reach), 1);

  const periodLabel = period === '7d' ? 'Last 7 Days' : period === '30d' ? 'Last 30 Days' : 'All Time';

  return (
    <div className="page on">

      {/* Period filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, padding: '0 4px' }}>
        {['7d', '30d', 'all'].map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: '5px 14px',
              borderRadius: 20,
              border: 'none',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              background: period === p ? 'var(--teal)' : 'var(--bg3)',
              color: period === p ? 'var(--bg)' : 'var(--t2)',
            }}
          >
            {p === 'all' ? 'All Time' : p === '7d' ? '7 Days' : '30 Days'}
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="sg">
        <div className="sc teal">
          <div className="sc-lbl">Est. Total Reach · {periodLabel}</div>
          <div className="sc-val teal">{formatReach(totalReach)}</div>
          <div className="sc-sub">{totalPosts} published post{totalPosts !== 1 ? 's' : ''}</div>
        </div>
        <div className="sc grn">
          <div className="sc-lbl">Posts Published</div>
          <div className="sc-val grn">{totalPosts}</div>
          <div className="sc-sub">{periodLabel.toLowerCase()}</div>
        </div>
        <div className="sc pur">
          <div className="sc-lbl">Top Format</div>
          <div className="sc-val" style={{ fontSize: 16, color: 'var(--pur)' }}>
            {topPlatform ? topPlatform.label : '—'}
          </div>
          <div className="sc-sub">
            {topPlatform && platformRows[0] ? `${platformRows[0].percent}% of posts` : 'no data yet'}
          </div>
        </div>
        <div className="sc gold">
          <div className="sc-lbl">Brands Active</div>
          <div className="sc-val gold">{brandStats.length}</div>
          <div className="sc-sub">with published content</div>
        </div>
      </div>

      {/* Brand reach breakdown */}
      <div className="panel">
        <div className="panel-h">Reach by Brand · {periodLabel}</div>
        <div className="panel-b" style={{ padding: 20 }}>
          {brandStats.length === 0 ? (
            <div className="empty" style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: 20 }}>
              No published posts found for this period
            </div>
          ) : (
            brandStats.map(b => (
              <div key={b.name} className="bar-row">
                <div className="bar-lbl">
                  <span className="ms-dot" style={{ background: b.color }} />
                  <span style={{ flex: 1 }}>{b.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>{b.posts} post{b.posts !== 1 ? 's' : ''}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(b.reach / maxBrandReach) * 100}%`, background: b.color }} />
                </div>
                <div className="bar-val">{formatReach(b.reach)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Platform reach breakdown */}
      <div className="panel">
        <div className="panel-h">Posts by Platform</div>
        <div className="panel-b" style={{ padding: 20 }}>
          {platformRows.length === 0 ? (
            <div className="empty" style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: 20 }}>
              No platform data yet
            </div>
          ) : (
            platformRows.map(p => (
              <div key={p.label} className="bar-row">
                <div className="bar-lbl">
                  <span className="ms-dot" style={{ background: p.color }} />
                  {p.label}
                  <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>{p.count} post{p.count !== 1 ? 's' : ''}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${p.percent}%`, background: p.color }} />
                </div>
                <div className="bar-val">{p.percent}%</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Reach estimation note */}
      <div style={{ fontSize: 10, color: 'var(--t3)', textAlign: 'center', paddingBottom: 16, lineHeight: 1.6 }}>
        Reach is estimated · IG Reel ~3.2K · Facebook ~1.8K · YouTube ~1.2K · LinkedIn ~600 · X ~800 per post
      </div>
    </div>
  );
}
