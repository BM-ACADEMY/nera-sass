import React, { useState, useEffect, useRef } from 'react';
import { C } from '../../constants/theme.js';
import { Target, TrendingUp, AlertTriangle, TrendingDown, Users, Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function RivalFamilies() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  // Live search states
  const [searchCategory, setSearchCategory] = useState('');
  const [searchLocation, setSearchLocation] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [liveCompetitors, setLiveCompetitors] = useState([]);
  const [ourRank, setOurRank] = useState('Pending');
  const [ourReviews, setOurReviews] = useState(120);
  const [ourRating, setOurRating] = useState(4.6);

  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const locationInputRef = useRef(null);
  const locationAutocompleteRef = useRef(null);

  // Load Google Maps Script
  useEffect(() => {
    const scriptId = 'google-maps-places-script';

    const checkAndSetLoaded = () => {
      if (window.google && window.google.maps && window.google.maps.places) {
        setGoogleScriptLoaded(true);
        return true;
      }
      return false;
    };

    if (checkAndSetLoaded()) {
      return;
    }

    const existingScript = document.getElementById(scriptId);
    if (existingScript) {
      const handleLoad = () => setGoogleScriptLoaded(true);
      existingScript.addEventListener('load', handleLoad);
      const interval = setInterval(() => {
        if (checkAndSetLoaded()) {
          clearInterval(interval);
        }
      }, 500);
      return () => {
        existingScript.removeEventListener('load', handleLoad);
        clearInterval(interval);
      };
    }

    const fetchAndLoadScript = async () => {
      try {
        const token = localStorage.getItem('leados_token');
        const res = await fetch(`${API_URL}/api/mafiya/clients/config/maps-key`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch maps API key');
        const data = await res.json();
        
        if (data.apiKey) {
          if (document.getElementById(scriptId)) {
            if (!checkAndSetLoaded()) {
              document.getElementById(scriptId).addEventListener('load', () => setGoogleScriptLoaded(true));
            }
            return;
          }
          const script = document.createElement('script');
          script.id = scriptId;
          script.src = `https://maps.googleapis.com/maps/api/js?key=${data.apiKey}&libraries=places&v=weekly&loading=async`;
          script.async = true;
          script.defer = true;
          script.onload = () => setGoogleScriptLoaded(true);
          document.head.appendChild(script);
        } else {
          console.error('Maps API key not found in backend response');
        }
      } catch (err) {
        console.error('Failed to load Google Maps script from backend key:', err);
      }
    };

    fetchAndLoadScript();
  }, []);

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const token = localStorage.getItem('leados_token');
        const res = await fetch(`${API_URL}/api/mafiya/clients`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch clients');
        const data = await res.json();
        setClients(data);
        if (data.length > 0) {
          setSelectedClient(data[0].id);
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to load clients');
      } finally {
        setIsLoadingClients(false);
      }
    };
    fetchClients();
  }, []);

  const performTextSearch = async (query) => {
    // Try modern Place.searchByText first (v2)
    if (window.google?.maps?.places?.Place?.searchByText) {
      try {
        const { Place } = window.google.maps.places;
        const { places } = await Place.searchByText({
          textQuery: query,
          fields: ['id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount'],
        });
        
        if (places && places.length > 0) {
          return places.map(p => ({
            place_id: p.id,
            name: p.displayName || '',
            formatted_address: p.formattedAddress || '',
            rating: p.rating || 0,
            user_ratings_total: p.userRatingCount || 0
          }));
        }
      } catch (err) {
        console.warn('Modern Place.searchByText failed, falling back to legacy PlacesService:', err);
      }
    }

    // Fallback to legacy PlacesService
    return new Promise((resolve) => {
      const service = new window.google.maps.places.PlacesService(document.createElement('div'));
      service.textSearch({ query }, (results, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
          resolve(results);
        } else {
          resolve([]);
        }
      });
    });
  };

  // Detect and search competitors based on client details
  const detectAndSearchCompetitors = async (client) => {
    if (!client) return;
    const category = client.custom_category || client.business_category || 'Business';
    setSearchCategory(category);
    setSearchLocation('');
    setLiveCompetitors([]);
    setOurRank('Pending');
    setIsDetectingLocation(true);

    if (window.google && window.google.maps && window.google.maps.places) {
      try {
        const results = await performTextSearch(client.business_name);
        setIsDetectingLocation(false);
        let detectedCity = '';
        if (results && results.length > 0) {
          const place = results[0];
          const address = place.formatted_address || '';
          const parts = address ? address.split(',') : [];
          if (parts.length > 2) {
            detectedCity = parts[parts.length - 2].trim().split(' ')[0];
          }
        }
        
        const finalCity = detectedCity || '';
        setSearchLocation(finalCity);

        if (finalCity) {
          executeLiveSearch(category, finalCity);
        }
      } catch (err) {
        console.error(err);
        setIsDetectingLocation(false);
      }
    } else {
      setIsDetectingLocation(false);
    }
  };

  const executeLiveSearch = async (category, location) => {
    if (!category || !location || !window.google || !window.google.maps || !window.google.maps.places) return;
    
    setIsSearching(true);
    const query = `${category} in ${location}`;
    
    try {
      const token = localStorage.getItem('leados_token');
      const scanRes = await fetch(`${API_URL}/api/mafiya/rivals/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ client_id: parseInt(selectedClient) })
      });

      if (!scanRes.ok) {
        const errData = await scanRes.json();
        throw new Error(errData.message || errData.error || 'Failed to check scan limits');
      }

      const results = await performTextSearch(query);
      setIsSearching(false);
      if (results && results.length > 0) {
        const client = clients.find(c => c.id === parseInt(selectedClient));
        let clientIndex = -1;
        
        if (client) {
          clientIndex = results.findIndex(r => r.name.toLowerCase().includes(client.business_name.toLowerCase()) || client.business_name.toLowerCase().includes(r.name.toLowerCase()));
        }
        
        if (clientIndex !== -1) {
          setOurRank(clientIndex + 1);
          setOurReviews(results[clientIndex].user_ratings_total || 120);
          setOurRating(results[clientIndex].rating || 4.6);
        } else {
          setOurRank('Not in Top 20');
          setOurReviews(120);
          setOurRating(4.6);
        }

        // Filter out our own business from competitor list
        const filtered = client 
          ? results.filter(r => r.name.toLowerCase() !== client.business_name.toLowerCase())
          : results;
          
        setLiveCompetitors(filtered);
      } else {
        toast.error('No competitors found for this query');
        setLiveCompetitors([]);
        setOurRank('Not Found');
      }
    } catch (err) {
      console.error(err);
      setIsSearching(false);
      toast.error(err.message || 'Error searching competitors');
    }
  };

  // Trigger search on client select
  useEffect(() => {
    if (!selectedClient) return;
    const client = clients.find(c => c.id === parseInt(selectedClient));
    if (client) {
      detectAndSearchCompetitors(client);
    }
  }, [selectedClient, clients, googleScriptLoaded]);

  // Google Maps Autocomplete for location input
  useEffect(() => {
    if (googleScriptLoaded && window.google && window.google.maps && window.google.maps.places && locationInputRef.current) {
      locationAutocompleteRef.current = new window.google.maps.places.Autocomplete(locationInputRef.current, {
        types: ['(regions)'],
      });

      const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          executeLiveSearch(searchCategory, e.target.value);
        }
      };
      locationInputRef.current.addEventListener('keydown', handleKeyDown);

      const listener = locationAutocompleteRef.current.addListener('place_changed', () => {
        const place = locationAutocompleteRef.current.getPlace();
        if (!place) return;
        
        let cityName = '';
        for (const component of place.address_components || []) {
          if (component.types.includes('locality') || component.types.includes('administrative_area_level_2')) {
            cityName = component.long_name;
            break;
          }
        }
        if (!cityName) {
          cityName = place.name || place.formatted_address || '';
        }
        
        setSearchLocation(cityName);
        if (cityName) {
          executeLiveSearch(searchCategory, cityName);
        }
      });

      return () => {
        if (locationAutocompleteRef.current && listener) {
          window.google.maps.event.removeListener(listener);
        }
        if (locationInputRef.current) {
          locationInputRef.current.removeEventListener('keydown', handleKeyDown);
        }
      };
    }
  }, [googleScriptLoaded, searchCategory]);

  const handleManualSearch = (e) => {
    e.preventDefault();
    executeLiveSearch(searchCategory, searchLocation);
  };

  // Calculate metrics based on live competitors
  const total = liveCompetitors.length;
  const winning = typeof ourRank === 'number' 
    ? liveCompetitors.filter((_, idx) => ourRank < (idx + 1)).length 
    : 0;
  const losing = ourRank === 'Not in Top 20'
    ? total
    : typeof ourRank === 'number'
      ? liveCompetitors.filter((_, idx) => ourRank > (idx + 1)).length
      : 0;
  const watchClosely = total - winning - losing;
  const healthScore = total > 0 ? Math.round((winning / total) * 100) : 0;

  const inputStyle = { background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, color: '#fff', padding: '12px 14px', outline: 'none', fontSize: 13, width: '100%' };

  if (isLoadingClients) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <Loader2 size={42} className="spin" style={{ color: C.accent }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: 'rgba(0,0,0,0.1)' }}>
      {/* ═══ Header ═══ */}
      <div className="rivals-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, background: 'linear-gradient(135deg, #ef4444, #b91c1c)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Target size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>Rival Families</h1>
            <p style={{ margin: 0, color: C.muted, fontSize: 12, marginTop: 2 }}>Track & compare your local SEO performance</p>
          </div>
        </div>

        <form onSubmit={handleManualSearch} className="rivals-form">
          {isDetectingLocation && (
            <div style={{ color: '#3b82f6', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
              <Loader2 size={14} className="spin" /> Detecting location...
            </div>
          )}
          
          <select
            value={selectedClient}
            onChange={e => setSelectedClient(e.target.value)}
            style={{ ...inputStyle, width: 220, padding: '10px 14px', background: C.surface }}
            className="rivals-input"
          >
            {clients.length === 0 && <option value="">No clients available</option>}
            {clients.map(c => <option key={c.id} value={c.id}>{c.display_name || c.business_name}</option>)}
          </select>

          <input
            value={searchCategory}
            onChange={e => setSearchCategory(e.target.value)}
            placeholder="Category / Keyword"
            style={{ ...inputStyle, width: 180, padding: '10px 14px', background: C.surface }}
            className="rivals-input"
          />

          <input
            ref={locationInputRef}
            value={searchLocation}
            onChange={e => setSearchLocation(e.target.value)}
            placeholder="Location / City"
            style={{ ...inputStyle, width: 180, padding: '10px 14px', background: C.surface }}
            className="rivals-input"
          />

          <button
            type="submit"
            disabled={isSearching || !searchCategory || !searchLocation}
            style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', border: 'none', padding: '10px 20px', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700, cursor: (isSearching || !searchCategory || !searchLocation) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            className="rivals-btn"
          >
            {isSearching ? <Loader2 size={16} className="spin" /> : <Search size={16} />} Search
          </button>
        </form>
      </div>

      {!selectedClient ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: C.surface, borderRadius: 16, border: `1px solid ${C.border}` }}>
          <Users size={48} color={C.muted} style={{ marginBottom: 16 }} />
          <h3 style={{ fontSize: 18, margin: '0 0 8px 0' }}>No Client Selected</h3>
          <p style={{ color: C.muted, fontSize: 14, margin: 0 }}>Please select or onboard a client to view competitors.</p>
        </div>
      ) : (
        <>
          {/* ═══ Dashboard Summary ═══ */}
          <div className="rivals-dashboard">
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
              <span style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', fontWeight: 700 }}>Competitors Found</span>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, color: '#fff' }}>{total}</div>
            </div>
            <div style={{ background: 'linear-gradient(to right bottom, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02))', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={16} color="#10b981" />
                <span style={{ fontSize: 12, color: '#10b981', textTransform: 'uppercase', fontWeight: 700 }}>Winning</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, color: '#10b981' }}>{winning}</div>
            </div>
            <div style={{ background: 'linear-gradient(to right bottom, rgba(245, 158, 11, 0.1), rgba(245, 158, 11, 0.02))', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color="#f59e0b" />
                <span style={{ fontSize: 12, color: '#f59e0b', textTransform: 'uppercase', fontWeight: 700 }}>Watch Closely</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, color: '#f59e0b' }}>{watchClosely}</div>
            </div>
            <div style={{ background: 'linear-gradient(to right bottom, rgba(239, 68, 68, 0.1), rgba(239, 68, 68, 0.02))', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 14, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingDown size={16} color="#ef4444" />
                <span style={{ fontSize: 12, color: '#ef4444', textTransform: 'uppercase', fontWeight: 700 }}>Losing</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, color: '#ef4444' }}>{losing}</div>
            </div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
              <span style={{ fontSize: 12, color: C.muted, textTransform: 'uppercase', fontWeight: 700 }}>Market Position</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: healthScore >= 50 ? '#10b981' : '#f59e0b' }}>{healthScore}%</div>
                <span style={{ fontSize: 12, color: C.muted }}>Beaten</span>
              </div>
              <div style={{ fontSize: 12, color: healthScore >= 50 ? '#10b981' : '#f59e0b', marginTop: 4, fontWeight: 600 }}>
                {healthScore >= 80 ? '★★★★★ Strong' : healthScore >= 50 ? '★★★☆☆ Average' : '★☆☆☆☆ Weak'}
              </div>
            </div>
          </div>

          {/* ═══ Table ═══ */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflowX: 'auto' }}>
            {isSearching ? (
              <div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" size={32} color={C.muted} style={{ margin: '0 auto' }}/></div>
            ) : liveCompetitors.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <Target size={42} color={C.border} style={{ margin: '0 auto 16px' }} />
                <p style={{ color: C.muted }}>No competitor search results loaded.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Competitor</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Their Rank</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Our Rank</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Their Reviews</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Their Rating</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ padding: '16px 20px', color: C.muted, fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap', textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {liveCompetitors.map((competitor, idx) => {
                    const competitorRank = idx + 1;
                    const competitorReviews = competitor.user_ratings_total || 0;
                    const competitorRating = competitor.rating || '0.0';

                    let statusLabel = 'Watch closely';
                    let statusColor = '#f59e0b';
                    let statusBg = 'rgba(245, 158, 11, 0.08)';
                    let statusBorder = '1px solid rgba(245, 158, 11, 0.25)';
                    let subtitle = `${competitor.formatted_address || searchLocation}`;
                    let subtitleColor = C.muted;

                    if (typeof ourRank === 'number') {
                      if (ourRank < competitorRank) {
                        statusLabel = 'We\'re winning';
                        statusColor = '#10b981';
                        statusBg = 'rgba(16, 185, 129, 0.08)';
                        statusBorder = '1px solid rgba(16, 185, 129, 0.25)';
                        subtitle = 'Main competitor — we\'re winning';
                        subtitleColor = '#10b981';
                      } else if (ourRank > competitorRank) {
                        statusLabel = 'We\'re losing';
                        statusColor = '#ef4444';
                        statusBg = 'rgba(239, 68, 68, 0.08)';
                        statusBorder = '1px solid rgba(239, 68, 68, 0.25)';
                        subtitle = '⚠️ Main competitor — losing ground';
                        subtitleColor = '#ef4444';
                      }
                    } else if (ourRank === 'Not in Top 20') {
                      statusLabel = 'We\'re losing';
                      statusColor = '#ef4444';
                      statusBg = 'rgba(239, 68, 68, 0.08)';
                      statusBorder = '1px solid rgba(239, 68, 68, 0.25)';
                      subtitle = '⚠️ Main competitor — losing ground';
                      subtitleColor = '#ef4444';
                    }

                    // Rank helper style
                    const getRankBadgeStyle = (rank) => {
                      if (rank <= 3) return { bg: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981' };
                      if (rank <= 5) return { bg: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b' };
                      return { bg: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' };
                    };

                    const theirBadge = getRankBadgeStyle(competitorRank);
                    const competitorUrl = `https://www.google.com/maps/place/?q=place_id:${competitor.place_id}`;

                    return (
                      <tr key={competitor.place_id} style={{ borderBottom: `1px solid ${C.border}`, background: 'transparent', transition: 'background 0.2s' }}>
                        <td style={{ padding: '16px 20px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', maxWidth: 300 }}>
                          <a href={competitorUrl} target="_blank" rel="noreferrer" style={{ color: '#fff', textDecoration: 'none', display: 'block', fontSize: 14, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 280 }} title={competitor.name}>{competitor.name}</a>
                          <span style={{ fontSize: 11, color: subtitleColor, marginTop: 4, display: 'block', fontWeight: 500, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 280 }} title={subtitle}>{subtitle}</span>
                        </td>
                        <td style={{ padding: '16px 20px', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 6, background: theirBadge.bg, border: theirBadge.border, color: theirBadge.color, fontWeight: 700, fontSize: 12 }}>
                            #{competitorRank}
                          </span>
                        </td>
                        <td style={{ padding: '16px 20px', whiteSpace: 'nowrap' }}>
                          {typeof ourRank === 'number' ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fbbf24', fontWeight: 700, fontSize: 12 }}>
                              🏆 #{ourRank}
                            </span>
                          ) : (
                            <span style={{ color: C.muted, fontWeight: 600 }}>{ourRank}</span>
                          )}
                        </td>
                        <td style={{ padding: '16px 20px', whiteSpace: 'nowrap', color: '#fff', fontWeight: 600 }}>
                          {competitorReviews}
                        </td>
                        <td style={{ padding: '16px 20px', whiteSpace: 'nowrap', color: '#fff', fontWeight: 600 }}>
                          {competitorRating}★
                        </td>
                        <td style={{ padding: '16px 20px', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: statusColor, background: statusBg, border: statusBorder }}>
                            {statusLabel}
                          </span>
                        </td>
                        <td style={{ padding: '16px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <a href={competitorUrl} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>View on Maps</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .rivals-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          gap: 16px;
        }
        .rivals-form {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .rivals-dashboard {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        
        @media (max-width: 1200px) {
          .rivals-header {
            flex-direction: column;
            align-items: flex-start;
          }
          .rivals-form {
            width: 100%;
          }
          .rivals-dashboard {
            grid-template-columns: repeat(3, 1fr);
          }
        }
        
        @media (max-width: 768px) {
          .rivals-dashboard {
            grid-template-columns: repeat(2, 1fr);
          }
          .rivals-form {
            flex-direction: column;
            align-items: stretch;
          }
          .rivals-input {
            width: 100% !important;
          }
          .rivals-btn {
            width: 100% !important;
            justify-content: center;
          }
        }
        
        @media (max-width: 480px) {
          .rivals-dashboard {
            grid-template-columns: 1fr;
          }
        }

        .pac-container {
          background-color: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
          color: #e2e8f0;
          z-index: 10000 !important;
        }
        .pac-item {
          padding: 8px 12px;
          border-top: 1px solid #1e293b;
          color: #94a3b8;
          cursor: pointer;
        }
        .pac-item:hover, .pac-item-selected {
          background-color: #1e293b;
        }
        .pac-item-query {
          font-size: 14px;
          color: #e2e8f0;
        }
        .pac-logo:after {
          display: none;
        }
      `}</style>
    </div>
  );
}
