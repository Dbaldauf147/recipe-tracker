// Sends push notifications to Prep Day mobile devices via Expo's push service.
// The public endpoint needs no auth — Expo routes to APNs/FCM using the
// project's stored push credentials. Tokens are stored per-device on the user
// doc (`expoPushTokens`) by the mobile app's registerPushTokenAsync.
//
// Returns { sent, tickets } where tickets[i] corresponds to messages[i], so the
// caller can prune tokens that Expo reports as DeviceNotRegistered.

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function isExpoPushToken(token) {
  return typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

export async function sendExpoPush(messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(m => isExpoPushToken(m?.to));
  if (list.length === 0) return { sent: 0, tickets: [] };

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(list),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Expo push HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => ({}));
  return { sent: list.length, tickets: Array.isArray(json?.data) ? json.data : [] };
}

// Given the tokens passed to sendExpoPush (in order) and the returned tickets,
// return the tokens Expo says are dead and should be removed from the user doc.
export function deadTokensFrom(tokens, tickets) {
  const dead = [];
  tickets.forEach((t, i) => {
    if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered' && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}
