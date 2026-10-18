export function makeAuthRepository(db) {
  return {
    async upsertMember({ discordUserId, username, displayName, avatar }) {
      await db.run(
        `INSERT INTO members (discord_user_id, username, display_name, avatar)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(discord_user_id)
         DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
           avatar = excluded.avatar, last_login_at = CURRENT_TIMESTAMP`,
        [discordUserId, username, displayName, avatar],
      );
      const row = await db.get('SELECT id FROM members WHERE discord_user_id = ?', [discordUserId]);
      return Number(row.id);
    },
    async createSession(tokenHash, memberId, expiresAt) {
      await db.run('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)', [tokenHash, memberId, expiresAt]);
    },
    async findSession(tokenHash) {
      const row = await db.get(
        `SELECT m.id, m.discord_user_id, m.username, m.display_name, m.avatar, s.expires_at
         FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token_hash = ?`,
        [tokenHash],
      );
      if (!row) return null;
      return {
        id: Number(row.id),
        discordUserId: row.discord_user_id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar,
        expiresAt: Number(row.expires_at),
      };
    },
    async deleteSession(tokenHash) {
      await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    },
    async deleteExpired(now) {
      await db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
    },
  };
}
