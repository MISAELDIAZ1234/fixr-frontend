/**
 * ─────────────────────────────────────────────────────────────
 *  FIXR CLIENT SDK  v1.0
 *  Drop this <script> tag into ANY Fixr HTML page.
 *  Handles: Auth · Jobs · AI · Payments · Real-time · Geo
 *
 *  Usage:
 *    <script src="https://cdn.fixr.com/sdk.js"></script>
 *    const fixr = new Fixr({ env: 'production' });
 * ─────────────────────────────────────────────────────────────
 */

const FIXR_CONFIG = {
  production: {
    api:       'https://api.fixr.com/api/v1',
    ws:        'wss://api.fixr.com',
    supabase:  'https://YOUR_PROJECT.supabase.co',
    supabaseKey: 'YOUR_ANON_KEY',
    stripe:    'pk_live_YOUR_KEY',
  },
  staging: {
    api:       'https://staging-api.fixr.com/api/v1',
    ws:        'wss://staging-api.fixr.com',
    supabase:  'https://YOUR_PROJECT.supabase.co',
    supabaseKey: 'YOUR_ANON_KEY',
    stripe:    'pk_test_YOUR_KEY',
  },
  local: {
    api:       'http://localhost:3001/api/v1',
    ws:        'ws://localhost:3001',
    supabase:  'https://YOUR_PROJECT.supabase.co',
    supabaseKey: 'YOUR_ANON_KEY',
    stripe:    'pk_test_YOUR_KEY',
  }
};

class FixrSDK {
  constructor({ env = 'production' } = {}) {
    this.config = FIXR_CONFIG[env] || FIXR_CONFIG.production;
    this.token = localStorage.getItem('fixr_token');
    this.user  = JSON.parse(localStorage.getItem('fixr_user') || 'null');
    this._socket = null;
    this._listeners = {};
  }

  // ════════════════════════════════════════════════
  //  CORE HTTP
  // ════════════════════════════════════════════════

  async _req(method, path, body, opts = {}) {
    const url = this.config.api + path;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...opts
    });

    if (res.status === 401) {
      this._logout();
      throw new Error('Session expired. Please login again.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Error ${res.status}`);
    return data;
  }

  get  = (path)       => this._req('GET',    path);
  post = (path, body) => this._req('POST',   path, body);
  patch= (path, body) => this._req('PATCH',  path, body);
  del  = (path)       => this._req('DELETE', path);

  // ════════════════════════════════════════════════
  //  AUTH
  // ════════════════════════════════════════════════

  auth = {
    register: async (data) => {
      const res = await this.post('/auth/register', data);
      this._saveSession(res);
      return res;
    },

    login: async (email, password) => {
      const res = await this.post('/auth/login', { email, password });
      this._saveSession(res);
      return res;
    },

    loginWithGoogle: async () => {
      // Open Supabase OAuth popup
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
      const sb = createClient(this.config.supabase, this.config.supabaseKey);
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/auth/callback' }
      });
      if (error) throw error;
    },

    oauthCallback: async (supabaseToken) => {
      const res = await this.post('/auth/oauth', { token: supabaseToken });
      this._saveSession(res);
      return res;
    },

    sendCode: (phone) => this.post('/auth/phone/send', { phone }),
    verifyCode: (phone, code) => this.post('/auth/phone/verify', { phone, code }),

    logout: () => this._logout(),
    isLoggedIn: () => !!this.token,
    getUser: () => this.user,
  };

  _saveSession({ accessToken, user }) {
    this.token = accessToken;
    this.user  = user;
    localStorage.setItem('fixr_token', accessToken);
    localStorage.setItem('fixr_user', JSON.stringify(user));
    this._emit('auth:login', user);
  }

  _logout() {
    this.token = null;
    this.user  = null;
    localStorage.removeItem('fixr_token');
    localStorage.removeItem('fixr_user');
    this._emit('auth:logout');
  }

  // ════════════════════════════════════════════════
  //  USERS / PROFILE
  // ════════════════════════════════════════════════

  users = {
    me:         ()     => this.get('/users/me'),
    update:     (data) => this.patch('/users/me', data),
    stats:      ()     => this.get('/users/me/stats'),
    credits:    ()     => this.get('/users/me/credits'),

    uploadAvatar: async (file) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${this.config.api}/users/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form
      });
      return res.json();
    }
  };

  // ════════════════════════════════════════════════
  //  PROPERTIES
  // ════════════════════════════════════════════════

  properties = {
    list:    ()     => this.get('/properties'),
    create:  (data) => this.post('/properties', data),
    get:     (id)   => this.get(`/properties/${id}`),
    update:  (id, data) => this.patch(`/properties/${id}`, data),
    delete:  (id)   => this.del(`/properties/${id}`),
    geocode: (id)   => this.post(`/properties/${id}/geocode`),
  };

  // ════════════════════════════════════════════════
  //  JOBS
  // ════════════════════════════════════════════════

  jobs = {
    list:     (filters = {}) => this.get('/jobs?' + new URLSearchParams(filters)),
    create:   (data)         => this.post('/jobs', data),
    get:      (id)           => this.get(`/jobs/${id}`),
    update:   (id, data)     => this.patch(`/jobs/${id}`, data),
    accept:   (id)           => this.post(`/jobs/${id}/accept`),
    start:    (id)           => this.post(`/jobs/${id}/start`),
    complete: (id, data)     => this.post(`/jobs/${id}/complete`, data),
    cancel:   (id, reason)   => this.post(`/jobs/${id}/cancel`, { reason }),

    messages: {
      list: (jobId)        => this.get(`/jobs/${jobId}/messages`),
      send: (jobId, text)  => this.post(`/jobs/${jobId}/messages`, { content: text }),
    },

    updateLocation: (jobId, lat, lng) =>
      this.post(`/jobs/${jobId}/location`, { lat, lng }),

    uploadPhotos: async (jobId, files, type = 'before') => {
      const form = new FormData();
      files.forEach(f => form.append('photos', f));
      form.append('type', type);
      const res = await fetch(`${this.config.api}/jobs/${jobId}/photos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form
      });
      return res.json();
    },
  };

  // ════════════════════════════════════════════════
  //  AI
  // ════════════════════════════════════════════════

  ai = {
    // Full diagnosis with optional image
    diagnose: (data) => this.post('/ai/diagnose', data),

    // Regular chat
    chat: (messages, opts = {}) =>
      this.post('/ai/chat', { messages, ...opts }),

    // Streaming chat — returns async generator
    stream: async function*(messages, opts = {}) {
      const res = await fetch(`${this.config.api}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ messages, ...opts }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split('\n').filter(l => l.startsWith('data:'));
        for (const line of lines) {
          const chunk = line.slice(5).trim();
          if (chunk === '[DONE]') return;
          try { yield JSON.parse(chunk).text || ''; } catch {}
        }
      }
    }.bind(this),

    // Photo analysis
    analyzePhoto: async (imageFile) => {
      const form = new FormData();
      form.append('image', imageFile);
      const res = await fetch(`${this.config.api}/ai/analyze-photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form
      });
      return res.json();
    },

    maintenance: (propertyId) => this.get(`/ai/maintenance/${propertyId}`),
    history:     ()           => this.get('/ai/history'),
  };

  // ════════════════════════════════════════════════
  //  TECHNICIANS
  // ════════════════════════════════════════════════

  technicians = {
    search: (filters = {}) => this.get('/technicians?' + new URLSearchParams(filters)),

    nearby: (lat, lng, radius = 25, category) =>
      this.get(`/geo/nearby-techs?lat=${lat}&lng=${lng}&radius=${radius}${category ? `&category=${category}` : ''}`),

    get:            (id)   => this.get(`/technicians/${id}`),
    createProfile:  (data) => this.post('/technicians/profile', data),
    updateProfile:  (data) => this.patch('/technicians/profile', data),
    updateLocation: (lat, lng) => this.patch('/technicians/location', { lat, lng }),
    setStatus:      (status)   => this.patch('/technicians/status', { status }),
    earnings:       ()         => this.get('/technicians/earnings'),
  };

  // ════════════════════════════════════════════════
  //  PAYMENTS (Stripe)
  // ════════════════════════════════════════════════

  payments = {
    // Create payment intent and launch Stripe Elements
    payForJob: async (jobId, cardElement, stripeInstance) => {
      const { clientSecret, amount } = await this.post('/payments/intent', { jobId });
      const result = await stripeInstance.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement }
      });
      if (result.error) throw new Error(result.error.message);
      return { success: true, amount };
    },

    addTip: async (jobId, tipAmount, cardElement, stripeInstance) => {
      const { clientSecret } = await this.post('/payments/tip', { jobId, tipAmount });
      const result = await stripeInstance.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement }
      });
      if (result.error) throw new Error(result.error.message);
      return { success: true };
    },

    subscribe: (plan) => this.post('/payments/subscribe', { plan }),
    cancelSubscription: () => this.del('/payments/subscribe'),
    history: (limit = 20) => this.get(`/payments/history?limit=${limit}`),

    // Stripe Connect for technicians
    setupPayouts: () => this.post('/payments/stripe-connect'),

    // Load Stripe.js
    loadStripe: () => new Promise((resolve) => {
      if (window.Stripe) return resolve(window.Stripe(FIXR_CONFIG.production.stripe));
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.onload = () => resolve(window.Stripe(FIXR_CONFIG.production.stripe));
      document.head.appendChild(s);
    })
  };

  // ════════════════════════════════════════════════
  //  MAINTENANCE
  // ════════════════════════════════════════════════

  maintenance = {
    list:        ()       => this.get('/maintenance'),
    complete:    (id)     => this.patch(`/maintenance/${id}/complete`),
    snooze:      (id, days) => this.patch(`/maintenance/${id}/snooze`, { days }),
    predictions: (propertyId) => this.get(`/ai/maintenance/${propertyId}`),
  };

  // ════════════════════════════════════════════════
  //  REVIEWS
  // ════════════════════════════════════════════════

  reviews = {
    submit:    (data) => this.post('/reviews', data),
    forTech:   (techId) => this.get(`/reviews/technician/${techId}`),
    respond:   (id, text) => this.patch(`/reviews/${id}/respond`, { response: text }),
  };

  // ════════════════════════════════════════════════
  //  NOTIFICATIONS
  // ════════════════════════════════════════════════

  notifications = {
    list:      () => this.get('/notifications'),
    markRead:  (id) => this.patch(`/notifications/${id}/read`),
    markAllRead: () => this.patch('/notifications/read-all'),
    registerPushToken: (token, platform) =>
      this.post('/notifications/push-token', { token, platform }),
  };

  // ════════════════════════════════════════════════
  //  REFERRALS
  // ════════════════════════════════════════════════

  referrals = {
    myCode:  () => this.get('/referrals/my-code'),
    apply:   (code) => this.post('/referrals/apply', { code }),
    stats:   () => this.get('/referrals/stats'),
  };

  // ════════════════════════════════════════════════
  //  GEO
  // ════════════════════════════════════════════════

  geo = {
    check:    (zipCode) => this.get(`/geo/check/${zipCode}`),
    states:   ()        => this.get('/geo/states'),
    geocode:  (address) => this.post('/geo/geocode', { address }),

    // Get user's current position
    getPosition: () => new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        reject,
        { enableHighAccuracy: true, timeout: 8000 }
      )
    ),
  };

  // ════════════════════════════════════════════════
  //  REAL-TIME (Socket.io)
  // ════════════════════════════════════════════════

  realtime = {
    connect: async () => {
      const { io } = await import('https://cdn.socket.io/4.7.5/socket.io.esm.min.js');
      this._socket = io(this.config.ws + '/jobs', {
        auth: { token: this.token }
      });
      this._socket.on('connect', () => this._emit('realtime:connected'));
      this._socket.on('disconnect', () => this._emit('realtime:disconnected'));
      return this._socket;
    },

    joinJob: (jobId) => {
      this._socket?.emit('join_job', { jobId });
    },

    sendLocation: (jobId, lat, lng) => {
      this._socket?.emit('tech_location', { jobId, lat, lng });
    },

    sendMessage: (jobId, message) => {
      this._socket?.emit('send_message', { jobId, message, senderId: this.user?.id });
    },

    on: (event, cb) => {
      this._socket?.on(event, cb);
    },

    disconnect: () => {
      this._socket?.disconnect();
      this._socket = null;
    }
  };

  // ════════════════════════════════════════════════
  //  EVENT EMITTER (internal)
  // ════════════════════════════════════════════════

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    this._listeners[event] = (this._listeners[event] || []).filter(l => l !== cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => cb(data));
  }

  // ════════════════════════════════════════════════
  //  UTILITIES
  // ════════════════════════════════════════════════

  utils = {
    formatCents: (cents) => '$' + (cents / 100).toFixed(2),
    formatPhone: (phone) => phone.replace(/(\d{1})(\d{3})(\d{3})(\d{4})/, '+$1 ($2) $3-$4'),
    formatAddress: (city, state, zip) => `${city}, ${state} ${zip}`,
    urgencyColor: (u) => ({ LOW:'#00e5a0', MEDIUM:'#ffc53d', HIGH:'#ff7a45', CRITICAL:'#ff4466', EMERGENCY:'#ff0033' })[u] || '#888',
    jobStatusLabel: (s) => ({ PENDING:'Pending', MATCHED:'Finding Technician', ACCEPTED:'Confirmed', EN_ROUTE:'Tech En Route', IN_PROGRESS:'In Progress', COMPLETED:'Completed', CANCELLED:'Cancelled' })[s] || s,
  };
}

// Auto-initialize
window.Fixr = FixrSDK;
window.fixr = new FixrSDK({ env: window.FIXR_ENV || 'production' });

// ─────────────────────────────────────────────────────────────
//  HOW TO USE IN ONBOARDING HTML
// ─────────────────────────────────────────────────────────────
/*

// 1. Add to <head>:
<script src="https://cdn.fixr.com/sdk.js"></script>

// 2. Register user (Screen 2 → button click):
async function handleRegister() {
  try {
    const result = await fixr.auth.register({
      email: document.getElementById('emailInput').value,
      password: document.getElementById('pwInput').value,
      firstName: document.getElementById('firstName').value,
      lastName: document.getElementById('lastName').value,
      role: selectedRoleVal.toUpperCase(),
    });
    console.log('Registered:', result.user);
    next(); // go to next screen
  } catch (err) {
    showError(err.message);
  }
}

// 3. Save property (Screen 4):
async function saveProperty() {
  const pos = await fixr.geo.getPosition();
  await fixr.properties.create({
    homeType: selectedHomeType.toLowerCase().replace(' ', '_'),
    address: document.getElementById('addressInput').value,
    lat: pos.lat,
    lng: pos.lng,
    yearBuilt: parseInt(document.getElementById('yearBuilt').value),
    sqFootage: parseInt(document.getElementById('sqft').value),
    systems: getSelectedTags(),
  });
}

// 4. Apply referral code (Screen 7):
async function applyReferral() {
  const code = document.getElementById('refCode').value;
  if (code) await fixr.referrals.apply(code);
}

// 5. Subscribe (Screen 8):
async function handlePlan() {
  if (selectedPlanVal !== 'free') {
    await fixr.payments.subscribe(selectedPlanVal.toUpperCase());
  }
  // Redirect to dashboard
  window.location.href = '/dashboard';
}

// 6. Dashboard — load real data:
async function loadDashboard() {
  const [stats, jobs, maintenance] = await Promise.all([
    fixr.users.stats(),
    fixr.jobs.list({ limit: 5 }),
    fixr.maintenance.list(),
  ]);
  renderStats(stats);
  renderJobs(jobs);
  renderMaintenance(maintenance);
}

// 7. AI Diagnosis — send message:
async function sendToAI(userMessage, imageFile) {
  // Option A: Full structured diagnosis
  const diag = await fixr.ai.diagnose({
    description: userMessage,
    imageUrls: imageFile ? [await uploadImage(imageFile)] : [],
    category: selectedCategory,
  });

  // Option B: Streaming chat
  for await (const chunk of fixr.ai.stream([
    { role: 'user', content: userMessage }
  ])) {
    appendToChat(chunk); // append word by word
  }
}

// 8. Book a technician:
async function bookTech(techId, jobData) {
  // Create job
  const job = await fixr.jobs.create({
    title: jobData.title,
    description: jobData.description,
    category: selectedCategory,
    urgency: 'MEDIUM',
    address: userProperty.address,
    lat: userProperty.lat,
    lng: userProperty.lng,
    propertyId: userProperty.id,
  });

  // Pay deposit with Stripe
  const stripe = await fixr.payments.loadStripe();
  const elements = stripe.elements();
  const card = elements.create('card', { style: stripeStyle });
  card.mount('#card-element');

  await fixr.payments.payForJob(job.id, card, stripe);
}

// 9. Real-time tracking:
async function trackJob(jobId) {
  await fixr.realtime.connect();
  fixr.realtime.joinJob(jobId);
  fixr.realtime.on('location_update', ({ lat, lng }) => {
    updateMapMarker(lat, lng);
  });
  fixr.realtime.on('job_accepted', ({ job }) => {
    showTechInfo(job.technician);
  });
}

*/
