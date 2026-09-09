import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';

export const useLeads = (filters = {}) => {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const fetchRequestIdRef = useRef(0);

  const limit = filters.limit || 20;
  const offset = filters.offset || 0;

  const fetchLeads = async () => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLeads({ ...filters, limit, offset });
      if (requestId !== fetchRequestIdRef.current) return;
      setLeads(data.leads || []);
      setTotal(data.total || 0);
      setHasMore((data.leads || []).length === limit);
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false);
    }
  };

  const loadMoreLeads = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const currentOffset = leads.length;
      const data = await api.getLeads({ ...filters, limit, offset: currentOffset });
      const newLeads = data.leads || [];
      if (newLeads.length > 0) {
        setLeads(prev => {
          // Prevent duplicates just in case
          const existingIds = new Set(prev.map(l => l.id));
          return [...prev, ...newLeads.filter(l => !existingIds.has(l.id))];
        });
      }
      setHasMore(newLeads.length === limit);
    } catch (err) {
      console.error('Failed to load more leads:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [filters.status, filters.brand, filters.source, filters.campaignName, filters.adName, filters.metaPageId, filters.search, filters.tagId, filters.limit, filters.offset]);

  return { leads, total, loading, loadingMore, hasMore, error, refetch: fetchLeads, loadMoreLeads };
};

export const useLead = (id) => {
  const [lead, setLead] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const fetchRequestIdRef = useRef(0);

  const limit = 100;

  const fetchLead = async () => {
    if (!id) return;
    // Switching contacts quickly starts a second fetch before the first
    // resolves; without this guard whichever response lands last wins,
    // so an older contact's data can silently overwrite the one just clicked.
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLead(id);
      const msgData = await api.getMessages(id, limit, 0);
      if (requestId !== fetchRequestIdRef.current) return;
      setLead(data.lead);
      setConversations(msgData.messages || []);
      setHasMore((msgData.messages || []).length === limit);
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false);
    }
  };

  const loadMoreMessages = async () => {
    if (!id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const offset = conversations.length;
      const data = await api.getMessages(id, limit, offset);
      const newMessages = data.messages || [];
      if (newMessages.length > 0) {
        // Prepend older messages
        setConversations(prev => [...newMessages, ...prev]);
      }
      setHasMore(newMessages.length === limit);
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setConversations([]);
    setHasMore(true);
    fetchLead();
  }, [id]);

  return { lead, conversations, loading, loadingMore, hasMore, error, refetch: fetchLead, loadMoreMessages };
};

export const useAllianceInbox = (filters = {}) => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const limit = filters.limit || 20;

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const data = await api.request(`/api/alliance-inbox/contacts?${new URLSearchParams({ limit, offset: 0, ...(filters.search && { search: filters.search }) })}`);
      setLeads(data.leads || []);
      setHasMore((data.leads || []).length === limit);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox();
  }, [filters.search, limit]);

  const loadMoreLeads = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.request(`/api/alliance-inbox/contacts?${new URLSearchParams({ limit, offset: leads.length, ...(filters.search && { search: filters.search }) })}`);
      const incoming = data.leads || [];
      setLeads((current) => [...current, ...incoming.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setHasMore(incoming.length === limit);
    } finally { setLoadingMore(false); }
  };

  return { leads, loading, loadingMore, hasMore, error, refetch: fetchInbox, loadMoreLeads };
};

export const useAllianceLead = (id) => {
  const [lead, setLead] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const fetchRequestIdRef = useRef(0);

  const fetchLead = async () => {
    if (!id) return;
    // Same stale-response race as useLead above — guard against an older
    // contact's response landing after a newer one and overwriting it.
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.request(`/api/alliance-inbox/contacts/${id}`);
      const messages = await api.request(`/api/alliance-inbox/contacts/${id}/messages?limit=100&offset=0`);
      if (requestId !== fetchRequestIdRef.current) return;
      setLead(data.lead);
      setConversations(messages.messages || []);
      setHasMore((messages.messages || []).length === 100);
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLead();
  }, [id]);

  const loadMoreMessages = async () => {
    if (!id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await api.request(`/api/alliance-inbox/contacts/${id}/messages?limit=100&offset=${conversations.length}`);
      setConversations((current) => [...(data.messages || []), ...current]);
      setHasMore((data.messages || []).length === 100);
    } finally { setLoadingMore(false); }
  };

  return { lead, conversations, loading, loadingMore, hasMore, error, refetch: fetchLead, loadMoreMessages };
};
