import React, { createContext, useState, useEffect, useContext } from 'react';
import { api } from '../services/api.js';

const ClientContext = createContext();

export const useClient = () => {
  return useContext(ClientContext);
};

export const ClientProvider = ({ children }) => {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [activeClient, setActiveClientState] = useState(() => {
    const saved = localStorage.getItem('activeClient');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  const setActiveClient = (client) => {
    setActiveClientState(client);
    if (client) {
      localStorage.setItem('activeClient', JSON.stringify(client));
    } else {
      localStorage.removeItem('activeClient');
    }
  };
  const [loading, setLoading] = useState(true);

  const fetchGlobalData = async () => {
    try {
      const [clientsData, plansData] = await Promise.all([
        api.get('/thedal/clients'),
        api.get('/thedal/plans')
      ]);
      
      if (plansData) setPlans(plansData);
      
      if (clientsData) {
        setClients(clientsData);
        
        // Magically keep the activeClient perfectly in sync with the database
        // If the user changes the business name or domain in Client Onboarding, 
        // the activeClient context will dynamically update itself without requiring a re-selection!
        setActiveClientState(prevActive => {
          if (prevActive && prevActive.id) {
            const freshActive = clientsData.find(c => c.id === prevActive.id);
            if (freshActive) {
              localStorage.setItem('activeClient', JSON.stringify(freshActive));
              return freshActive;
            }
          }
          return prevActive;
        });
      }
    } catch (err) {
      console.error('Failed to load global client data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGlobalData();
  }, []);

  const value = {
    clients,
    plans,
    activeClient,
    setActiveClient,
    loading,
    refreshGlobalData: fetchGlobalData
  };

  return (
    <ClientContext.Provider value={value}>
      {children}
    </ClientContext.Provider>
  );
};
