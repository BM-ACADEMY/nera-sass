const loadFacebookSdk = appId => new Promise((resolve, reject) => {
  if (window.FB) return resolve(window.FB);
  window.fbAsyncInit = () => {
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v21.0' });
    resolve(window.FB);
  };
  const existing = document.getElementById('facebook-jssdk');
  if (existing) return undefined;
  const script = document.createElement('script');
  script.id = 'facebook-jssdk';
  script.src = 'https://connect.facebook.net/en_US/sdk.js';
  script.async = true;
  script.defer = true;
  script.onerror = () => reject(new Error('Unable to load Meta Embedded Signup'));
  document.body.appendChild(script);
  return undefined;
});

export const launchMetaEmbeddedSignup = async config => {
  const FB = await loadFacebookSdk(config.app_id);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error('Meta finished without returning the WhatsApp account details. Please retry the verification.')), 3 * 60 * 1000);
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (error) reject(error); else resolve(data);
    };
    const onMessage = event => {
      let eventHost = '';
      try {
        const eventUrl = new URL(event.origin);
        if (eventUrl.protocol !== 'https:') return;
        eventHost = eventUrl.hostname.toLowerCase();
      } catch { return; }
      if (eventHost !== 'facebook.com' && !eventHost.endsWith('.facebook.com')) return;
      let data = event.data;
      try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
        finish(null, data.data || {});
      } else if (data.event === 'CANCEL') {
        finish(new Error('Meta Embedded Signup was cancelled'));
      } else if (data.event === 'ERROR') {
        finish(new Error(data.data?.error_message || 'Meta could not complete WhatsApp verification'));
      }
    };
    window.addEventListener('message', onMessage);
    FB.login(response => {
      if (!response.authResponse) finish(new Error('Meta login or authorization was not completed'));
    }, {
      config_id: config.config_id,
      auth_type: 'rerequest',
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: '3' }
    });
  });
};
