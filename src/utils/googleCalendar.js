// Client helpers for the Google Calendar integration on the Week Plan page.
// Ported from Rally's Plans.jsx; talks to the /api/google-* serverless routes.
// Tokens are cached in localStorage (same keys/shape Rally uses).

const TOKEN_KEY = 'google-cal-token';
const EXPIRY_KEY = 'google-cal-expiry';
const REFRESH_KEY = 'google-cal-refresh';
export const SELECTED_KEY = 'google-cal-selected-multi';

export function hasGoogleToken() {
  return !!localStorage.getItem(TOKEN_KEY);
}

// Returns a non-expired access token, refreshing via /api/google-refresh when
// needed. Falls back to the stored (possibly stale) token, or null.
export async function getValidGoogleToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = Number(localStorage.getItem(EXPIRY_KEY) || 0);
  if (token && Date.now() < expiry - 60_000) return token;
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    try {
      const res = await fetch(`/api/google-refresh?refreshToken=${encodeURIComponent(refreshToken)}`);
      const data = await res.json();
      if (data.accessToken) {
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        localStorage.setItem(EXPIRY_KEY, String(Date.now() + (data.expiresIn || 3600) * 1000));
        return data.accessToken;
      }
    } catch { /* fall through to stored token */ }
  }
  return token || null;
}

// Persist the tokens posted back by the OAuth popup (google-auth-success message).
export function storeTokenFromPopup(msg) {
  localStorage.setItem(TOKEN_KEY, msg.accessToken);
  if (msg.refreshToken) localStorage.setItem(REFRESH_KEY, msg.refreshToken);
  localStorage.setItem(EXPIRY_KEY, String(Date.now() + (msg.expiresIn || 3600) * 1000));
}

export function disconnectGoogle() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

export function openGoogleAuthPopup() {
  window.open('/api/google-auth', 'google-auth', 'width=500,height=700,left=200,top=100');
}

// { calendars:[{id,name,color,primary}] } or { needsAuth:true }
export async function fetchGoogleCalendars() {
  const token = await getValidGoogleToken();
  if (!token) return { needsAuth: true };
  const res = await fetch(`/api/google-calendars?accessToken=${encodeURIComponent(token)}`);
  return res.json();
}

// { events:[{title,start,end,allDay,...}] } or { needsAuth:true }
export async function fetchGoogleEvents({ timeMin, timeMax, calendarId }) {
  const token = await getValidGoogleToken();
  if (!token) return { needsAuth: true };
  const url = `/api/google-calendar?accessToken=${encodeURIComponent(token)}`
    + `&timeMin=${encodeURIComponent(timeMin)}`
    + `&timeMax=${encodeURIComponent(timeMax)}`
    + `&calendarId=${encodeURIComponent(calendarId)}`;
  const res = await fetch(url);
  return res.json();
}

// Google all-day events use date-only strings ("2026-05-04"); new Date() would
// parse those as UTC midnight and roll back a day west of UTC. Parse components
// directly so the date stays put.
export function parseEventDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}
