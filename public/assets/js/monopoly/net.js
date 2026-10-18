// verbindung zum monopoly-server. der browser merkt sich ein gast-token, discord läuft über das cookie

import { io } from '/socket.io/socket.io.esm.min.js';

const TOKEN_KEY = 'lcd-monopoly-guest';
const NAME_KEY = 'lcd-monopoly-name';

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* privates fenster: dann eben nur für diese sitzung */
  }
  return value ?? null;
}

let memoryToken = null;
export function guestToken() {
  let token = storage(TOKEN_KEY) ?? memoryToken;
  if (!token) {
    token = crypto.getRandomValues(new Uint8Array(24)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    memoryToken = token;
    storage(TOKEN_KEY, token);
  }
  return token;
}

export const savedName = () => storage(NAME_KEY) ?? '';
export const saveName = name => storage(NAME_KEY, name);

export function connect(name, handlers) {
  // standard-reihenfolge: erst http, dann websocket. klappt auch hinter proxys und tunneln
  const socket = io({ auth: { guestToken: guestToken(), name } });
  socket.on('hello', handlers.hello);
  socket.on('room:state', handlers.state);
  socket.on('connect', () => handlers.status?.('online'));
  socket.on('disconnect', () => handlers.status?.('offline'));
  socket.on('connect_error', error => handlers.status?.('error', error.message));
  return {
    socket,
    /** Anfrage mit antwort; wirft bei { error }. */
    ask(event, payload = {}) {
      return new Promise((resolve, reject) => {
        socket.timeout(10_000).emit(event, payload, (timeout, reply) => {
          if (timeout) return reject(new Error('The server did not answer'));
          if (reply?.error) return reject(new Error(reply.error));
          resolve(reply);
        });
      });
    },
    close() { socket.close(); },
  };
}

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
