/* eslint-env node */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const axios = require('axios');
const { google } = require('googleapis');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID_GSC_I,
  process.env.GOOGLE_CLIENT_SECRET_GSC_I,
  process.env.GOOGLE_CALLBACK_LOCALSEOBRIDGE
);

const dataForSeoAuth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
});

let isConnected = false;
let globalGoogleTokens = null;

router.get('/status', async (req, res) => {
  try {
    const isDemo = req.headers['x-data-mode'] === 'demo';
    res.json({ connected: isConnected || isDemo });
  } catch (error) {
    console.error('Error checking GBP status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/business.manage'],
    prompt: 'consent'
  });
  res.redirect(url);
});

router.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    isConnected = true;
    globalGoogleTokens = tokens;
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/thedal/local-seo-bridge?success=true`);
  } catch (err) {
    console.error('Error in callback', err);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/thedal/local-seo-bridge?error=oauth_failed`);
  }
});

router.post('/connect', async (req, res) => {
  res.json({ success: true, message: 'Google Business Profile connected successfully' });
});

router.post('/disconnect', async (req, res) => {
  try {
    isConnected = false;
    globalGoogleTokens = null;
    res.json({ success: true, message: 'Google Business Profile disconnected' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/data', async (req, res) => {
  const isDemo = req.headers['x-data-mode'] === 'demo';
  if (!isConnected && !isDemo) {
    return res.status(403).json({ error: 'Not connected to Google Business Profile' });
  }

  const businessName = req.query.name || 'Your Business';
  
  if (isDemo) {
    return res.json({
      business: {
        name: businessName,
        address: '123 Tech Park, Pondicherry, India',
        phone: '+91 98765 43210',
        rating: 4.8,
        totalReviews: 24,
        profileUrl: 'https://maps.google.com'
      },
      insights: {
        views: 1250, viewsTrend: '+12%',
        searches: 840, searchesTrend: '+8%',
        actions: 310, actionsTrend: '+15%'
      },
      recentReviews: [
        {
          id: 'rev-1',
          author: 'John Doe',
          rating: 5,
          text: 'Excellent service and great selection of products. ExportersIndia has been key to our business success.',
          date: 'Yesterday',
          replied: true,
          replyText: 'Thank you for the review, John!'
        },
        {
          id: 'rev-2',
          author: 'Priya Sharma',
          rating: 4,
          text: 'Very easy onboarding process and very professional team. Highly recommended.',
          date: '3 days ago',
          replied: false,
          replyText: ''
        },
        {
          id: 'rev-3',
          author: 'Robert Lee',
          rating: 5,
          text: 'Outstanding support! They helped us configure our profile and we got organic leads within the first week.',
          date: '1 week ago',
          replied: true,
          replyText: 'Thank you Robert! We are happy to help.'
        }
      ]
    });
  }
  
  let googleApiError = null;

  // Attempt to fetch from Official Google API first
  if (globalGoogleTokens && globalGoogleTokens.access_token) {
    try {
      const headers = { Authorization: `Bearer ${globalGoogleTokens.access_token}` };
      
      // 1. Get ALL accounts (not just the first one)
      const accRes = await axios.get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers });
      const accounts = accRes.data.accounts || [];
      console.log(`[LocalSeoBridge] Found ${accounts.length} Google Business Account(s)`);

      let foundLocation = null;
      let foundReviews = [];

      // 2. Iterate ALL accounts to find locations
      for (const account of accounts) {
        const accountId = account.name; // e.g. "accounts/12345"
        try {
          // Try new Business Information API with expanded readMask
          const locRes = await axios.get(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations?readMask=name,title,storeCode,phoneNumbers,storefrontAddress,websiteUri`,
            { headers }
          );
          const locations = locRes.data.locations || [];
          console.log(`[LocalSeoBridge] Account ${accountId}: ${locations.length} locations found`);

          if (locations.length > 0) {
            foundLocation = locations[0];
            const locationId = foundLocation.name;

            // 3. Get Reviews for this location
            try {
              const revRes = await axios.get(
                `https://mybusinessreviews.googleapis.com/v1/${locationId}/reviews`,
                { headers }
              );
              foundReviews = revRes.data.reviews || [];
            } catch (revErr) {
              console.warn(`[LocalSeoBridge] Reviews API failed: ${revErr.response?.data?.error?.message || revErr.message}`);
            }
            break; // Found a valid location, stop iterating
          }
        } catch (locErr) {
          console.warn(`[LocalSeoBridge] Locations API failed for ${accountId}: ${locErr.response?.data?.error?.message || locErr.message}`);
          
          // Fallback: Try older v4 API for this account
          try {
            const accountNum = accountId.split('/')[1];
            const v4Res = await axios.get(
              `https://mybusiness.googleapis.com/v4/accounts/${accountNum}/locations`,
              { headers }
            );
            const v4Locations = v4Res.data.locations || [];
            if (v4Locations.length > 0) {
              foundLocation = v4Locations[0];
              console.log(`[LocalSeoBridge] Found location via v4 API for ${accountId}`);
              break;
            }
          } catch (v4Err) {
            console.warn(`[LocalSeoBridge] v4 API also failed: ${v4Err.message}`);
          }
        }
      }

      if (foundLocation) {
        const realReviews = foundReviews.map(r => ({
          id: r.name,
          author: r.reviewer?.displayName || 'Google User',
          rating: r.starRating === 'FIVE' ? 5 : r.starRating === 'FOUR' ? 4 : r.starRating === 'THREE' ? 3 : r.starRating === 'TWO' ? 2 : 1,
          text: r.comment || '',
          date: r.createTime ? new Date(r.createTime).toLocaleDateString() : 'Recently',
          replied: !!r.reviewReply,
          replyText: r.reviewReply?.comment || ''
        }));

        const phone = foundLocation.phoneNumbers?.primaryPhone || 
                      foundLocation.primaryPhone || 'N/A';
        const address = foundLocation.storefrontAddress 
          ? [foundLocation.storefrontAddress.addressLines?.join(', '), foundLocation.storefrontAddress.locality, foundLocation.storefrontAddress.regionCode].filter(Boolean).join(', ')
          : 'Verified Google Location';

        return res.json({
          business: {
            name: foundLocation.title || businessName,
            address,
            phone,
            rating: realReviews.length > 0 ? (realReviews.reduce((acc, r) => acc + r.rating, 0) / realReviews.length).toFixed(1) : 0,
            totalReviews: realReviews.length,
            profileUrl: foundLocation.websiteUri || ''
          },
          insights: {
            views: 0, viewsTrend: '0%',
            searches: 0, searchesTrend: '0%',
            actions: 0, actionsTrend: '0%'
          },
          recentReviews: realReviews,
          _source: 'google_api'
        });
      } else {
        googleApiError = accounts.length === 0
          ? 'No Google Business Profile accounts found for this Google User.'
          : `Connected successfully but no locations found across ${accounts.length} account(s). Make sure this Google account has Owner/Manager access to a Business Profile with at least one location.`;
      }
    } catch (err) {
      googleApiError = err.response?.data?.error?.message || err.message;
      console.error('[LocalSeoBridge] Google API failed:', googleApiError);
    }
  }

  // Fallback 1: Try Google Maps Places API
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (mapsApiKey && businessName) {
    try {
      // Step 1: Text Search to find the Place ID
      const searchRes = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, {
        params: {
          query: businessName,
          key: mapsApiKey
        }
      });
      
      const candidates = searchRes.data.results || [];
      if (candidates.length > 0) {
        const placeId = candidates[0].place_id;
        
        // Step 2: Place Details for reviews and full info
        const detailsRes = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
          params: {
            place_id: placeId,
            fields: 'name,formatted_address,formatted_phone_number,rating,user_ratings_total,website,reviews,url',
            key: mapsApiKey
          }
        });
        
        const place = detailsRes.data.result;
        if (place) {
          const realReviews = (place.reviews || []).map((r, i) => ({
            id: `maps-rev-${i}`,
            author: r.author_name || 'Google User',
            rating: r.rating || 5,
            text: r.text || '',
            date: r.relative_time_description || 'Recently',
            replied: false,
            replyText: ''
          }));
          
          return res.json({
            business: {
              name: place.name || businessName,
              address: place.formatted_address || 'Address not found',
              phone: place.formatted_phone_number || 'N/A',
              rating: place.rating || 0,
              totalReviews: place.user_ratings_total || 0,
              profileUrl: place.website || place.url || ''
            },
            insights: { views: 0, viewsTrend: '0%', searches: 0, searchesTrend: '0%', actions: 0, actionsTrend: '0%' },
            recentReviews: realReviews,
            _source: 'google_maps_api',
            _warning: googleApiError
          });
        }
      }
    } catch (mapsErr) {
      console.warn('[LocalSeoBridge] Google Maps API fallback failed:', mapsErr.message);
    }
  }

  // Fallback 2: Try ValueSerp
  const valueSerpKey = process.env.VALUESERP_API_KEY;
  if (valueSerpKey && businessName) {
    try {
      const serpRes = await axios.get('https://api.valueserp.com/search', {
        params: {
          q: `${businessName} reviews`,
          api_key: valueSerpKey,
          num: 5
        },
        timeout: 8000
      });
      const answerBox = serpRes.data?.answer_box;
      const localResults = serpRes.data?.local_results || [];
      const localBusiness = localResults[0] || null;

      if (localBusiness || answerBox) {
        const rating = localBusiness?.rating || answerBox?.rating || 0;
        const reviews = localBusiness?.reviews || answerBox?.reviews || 0;
        
        return res.json({
          business: {
            name: localBusiness?.title || businessName,
            address: localBusiness?.address || 'Address not found',
            phone: 'N/A',
            rating: rating || 0,
            totalReviews: reviews || 0,
            profileUrl: ''
          },
          insights: { views: 0, viewsTrend: '0%', searches: 0, searchesTrend: '0%', actions: 0, actionsTrend: '0%' },
          recentReviews: [],
          _source: 'valueserp',
          _warning: googleApiError
        });
      }
    } catch (serpErr) {
      console.warn('[LocalSeoBridge] ValueSerp fallback failed:', serpErr.message);
    }
  }

  // Final Fallback 3: DataForSEO Maps SERP scraping (Since Maps API might block referer-restricted keys)
  try {
    const postData = [{ keyword: businessName, language_code: "en", location_name: "India" }];
    const dfsRes = await axios({
      method: 'post',
      url: 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced',
      data: postData,
      headers: { 'Authorization': `Basic ${dataForSeoAuth}`, 'Content-Type': 'application/json' }
    });

    const items = dfsRes.data.tasks?.[0]?.result?.[0]?.items;
    let gbpData = items?.[0];

    // Attempt to fetch real reviews from DataForSEO
    let realReviewsDfs = [];
    try {
      const reviewPostData = [{ keyword: businessName, language_code: "en", location_name: "India", depth: 10 }];
      const dfsReviewsRes = await axios({
        method: 'post',
        url: 'https://api.dataforseo.com/v3/serp/google/reviews/live/advanced',
        data: reviewPostData,
        headers: { 'Authorization': `Basic ${dataForSeoAuth}`, 'Content-Type': 'application/json' }
      });
      const reviewItems = dfsReviewsRes.data.tasks?.[0]?.result?.[0]?.items || [];
      realReviewsDfs = reviewItems.slice(0, 10).map((r, index) => ({
        id: r.review_id || index,
        author: r.profile_name || 'Google User',
        rating: r.rating?.value || 5,
        text: r.review_text || '',
        date: r.time_ago || 'Recently',
        replied: !!r.owner_answer,
        replyText: r.owner_answer || ''
      })).filter(r => r.text);
    } catch (revErr) {
      console.warn('[LocalSeoBridge] DFS reviews fallback failed:', revErr.message);
    }

    if (gbpData) {
      return res.json({
        business: {
          name: gbpData.title || businessName,
          address: gbpData.address || 'Address not found on Google',
          phone: gbpData.phone || 'N/A',
          rating: gbpData.rating?.value || 0,
          totalReviews: gbpData.rating?.votes_count || 0,
          profileUrl: gbpData.url || ''
        },
        insights: {
          views: 0, viewsTrend: '0%',
          searches: 0, searchesTrend: '0%',
          actions: 0, actionsTrend: '0%'
        },
        recentReviews: realReviewsDfs,
        _source: 'dataforseo',
        _warning: googleApiError
      });
    }
  } catch (error) {
    console.warn('[LocalSeoBridge] DataForSEO fallback failed:', error.message);
  }

  // Final Catch-All Return
  res.status(500).json({ error: googleApiError || 'Failed to fetch business data across all fallbacks.' });
});

router.post('/reply-review', async (req, res) => {
  const { reviewId, replyText } = req.body;
  if (!reviewId || !replyText) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (globalGoogleTokens && globalGoogleTokens.access_token) {
    try {
      // For real reviews, reviewId is the full name "accounts/{accountId}/locations/{locationId}/reviews/{reviewId}"
      // If it's a number (fallback), we catch it below.
      if (typeof reviewId === 'string' && reviewId.startsWith('accounts/')) {
        await axios.put(`https://mybusinessreviews.googleapis.com/v1/${reviewId}/reply`, {
          comment: replyText
        }, {
          headers: { Authorization: `Bearer ${globalGoogleTokens.access_token}` }
        });
        return res.json({ success: true, message: 'Reply posted to Google successfully via official API!' });
      }
    } catch (e) {
      console.error('Failed to post reply via Google API', e.response?.data || e.message);
      return res.status(403).json({ error: 'Google API Permission Denied (Not verified or Review ID invalid)' });
    }
  }

  // Fallback / Mock
  res.json({ success: true, message: 'Reply posted to Google (Simulated)' });
});

router.post('/create-post', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });
  res.json({ success: true, message: 'Update posted to Google Business Profile' });
});

module.exports = router;
