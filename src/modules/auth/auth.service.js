//Discord OAuth2 und sitzungen. das token im cookie ist zufällig, in der db liegt nur sein hash

import { createHash, randomBytes } from 'node:crypto';
import { parseCookies } from '../../middleware/cookies.js';
import { sanitizeDescription } from './profile-description.js';

export const SESSION_COOKIE = 'lcd_session';
export const STATE_COOKIE = 'lcd_oauth_state';
export const SESSION_DAYS = 30;
const DISCORD = 'https://discord.com/api';

const hash = token => createHash('sha256').update(token).digest('hex');

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function avatarUrl(discordUserId, avatar) {
  if (avatar) return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.png?size=128`;
  const index = Number((BigInt(discordUserId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/** Nur relative pfade auf der eigenen seite zulassen (kein open redirect). */
export function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

export function makeAuthService(repository, discord, { fetchImpl = fetch } = {}) {
  const enabled = Boolean(discord.clientId && discord.clientSecret);

  function publicMember(member) {
    if (!member) return null;
    return {
      id: member.id,
      discordUserId: member.discordUserId,
      name: member.displayName,
      username: member.username,
      avatarUrl: avatarUrl(member.discordUserId, member.avatar),
    };
  }

  return {
    enabled,

    async getProfile(memberId) {
      const description = await repository.getDescription(memberId);
      return { description: sanitizeDescription(description ?? 'Mitglied der Lacedaemon-Community.') };
    },

    async updateProfile(memberId, description) {
      if (typeof description !== 'string' || description.length > 500) {
        throw new AuthError('Die Beschreibung darf maximal 500 Zeichen enthalten.');
      }
      const text = sanitizeDescription(description.trim());
      if (text.length > 500) {
        throw new AuthError('Die Beschreibung darf inklusive HTML maximal 500 Zeichen enthalten.');
      }
      await repository.saveDescription(memberId, text);
      return { description: text };
    },

    authorizeUrl(state) {
      const params = new URLSearchParams({
        client_id: discord.clientId,
        redirect_uri: discord.redirectUri,
        response_type: 'code',
        scope: discord.guildId ? 'identify guilds' : 'identify',
        state,
        prompt: 'consent',
      });
      return `https://discord.com/oauth2/authorize?${params}`;
    },

    newState() {
      return randomBytes(18).toString('base64url');
    },

    /** Code gegen token tauschen, nutzer laden, mitglied speichern, sitzung anlegen. */
    async loginWithCode(code) {
      if (!enabled) throw new AuthError('Discord-Login ist nicht eingerichtet.', 503);
      const tokenResponse = await fetchImpl(`${DISCORD}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: discord.clientId,
          client_secret: discord.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: discord.redirectUri,
        }),
      });
      if (!tokenResponse.ok) throw new AuthError('Discord hat die Anmeldung abgelehnt.', 401);
      const { access_token: accessToken } = await tokenResponse.json();
      const headers = { Authorization: `Bearer ${accessToken}` };
      const userResponse = await fetchImpl(`${DISCORD}/users/@me`, { headers });
      if (!userResponse.ok) throw new AuthError('Discord-Profil konnte nicht geladen werden.', 502);
      const user = await userResponse.json();
      if (discord.guildId) {
        const guildsResponse = await fetchImpl(`${DISCORD}/users/@me/guilds`, { headers });
        const guilds = guildsResponse.ok ? await guildsResponse.json() : [];
        if (!guilds.some(g => g.id === discord.guildId)) throw new AuthError('Nur für Mitglieder des Lacedaemon-Servers.', 403);
      }
      const memberId = await repository.upsertMember({
        discordUserId: String(user.id),
        username: String(user.username).slice(0, 40),
        displayName: String(user.global_name || user.username).slice(0, 40),
        avatar: user.avatar ?? null,
      });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
      await repository.createSession(hash(token), memberId, expiresAt);
      return { token, expiresAt };
    },

    async memberFromToken(token) {
      if (!token) return null;
      const member = await repository.findSession(hash(token));
      if (!member) return null;
      if (member.expiresAt < Date.now()) {
        await repository.deleteSession(hash(token));
        return null;
      }
      return publicMember(member);
    },

    memberFromCookieHeader(header) {
      return this.memberFromToken(parseCookies(header)[SESSION_COOKIE]);
    },

    async logout(token) {
      if (token) await repository.deleteSession(hash(token));
    },
  };
}
