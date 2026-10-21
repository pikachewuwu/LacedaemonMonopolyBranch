import { avatarUrl } from '../auth/auth.service.js';

export function makeAnimeRepository(db) {
  return {
    async list() {
      const [anime, reviews] = await Promise.all([
        db.all('SELECT mal_id, metadata_json, creator_member_id, created_at FROM mal_anime ORDER BY title ASC'),
        db.all(`SELECT e.*, m.display_name, m.discord_user_id, m.avatar FROM mal_anime_entries e
          JOIN members m ON m.id = e.member_id ORDER BY e.member_id ASC`),
      ]);
      const byAnime = new Map();
      for (const entry of reviews) {
        const id = Number(entry.mal_id);
        if (!byAnime.has(id)) byAnime.set(id, []);
        byAnime.get(id).push({ memberId: Number(entry.member_id), memberName: entry.display_name,
          avatarUrl: avatarUrl(entry.discord_user_id, entry.avatar), status: entry.status,
          watchedEpisodes: entry.watched_episodes == null ? null : Number(entry.watched_episodes),
          score: entry.score == null ? null : Number(entry.score), createdAt: entry.created_at, updatedAt: entry.updated_at });
      }
      return anime.map(row => {
        const ratings = byAnime.get(Number(row.mal_id)) ?? [];
        const scored = ratings.filter(entry => entry.score !== null);
        return { ...JSON.parse(row.metadata_json), id: `mal:${row.mal_id}`, malId: Number(row.mal_id),
          creatorMemberId: row.creator_member_id == null ? null : Number(row.creator_member_id), createdAt: row.created_at, ratings,
          averageScore: scored.length ? Math.round(scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length * 10) / 10 : null };
      });
    },
    async saveEntry(anime, { memberId, status, score, watchedEpisodes, memberIds = [] }) {
      await db.batch([
        { sql: `INSERT INTO mal_anime (mal_id, title, metadata_json, fetched_at, creator_member_id) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(mal_id) DO UPDATE SET title = excluded.title, metadata_json = excluded.metadata_json, fetched_at = excluded.fetched_at`,
        values: [anime.malId, anime.title, JSON.stringify(anime), Date.parse(anime.metadataUpdatedAt), memberId] },
        { sql: `INSERT INTO mal_anime_entries (mal_id, member_id, status, score, watched_episodes) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(mal_id, member_id) DO UPDATE SET status = excluded.status, score = excluded.score,
            watched_episodes = excluded.watched_episodes, updated_at = CURRENT_TIMESTAMP`,
        values: [anime.malId, memberId, status, score, watchedEpisodes] },
        ...memberIds.filter(id => id !== memberId).map(id => ({
          sql: `INSERT INTO mal_anime_entries (mal_id, member_id, status, score, watched_episodes)
            VALUES (?, ?, 'plan_to_watch', NULL, NULL) ON CONFLICT(mal_id, member_id) DO NOTHING`, values: [anime.malId, id],
        })),
      ]);
      return { itemId: `mal:${anime.malId}` };
    },
    async members() {
      const members = await db.all('SELECT id, display_name, discord_user_id, avatar FROM members ORDER BY display_name ASC, id ASC');
      return members.map(member => ({ id: Number(member.id), name: member.display_name, avatarUrl: avatarUrl(member.discord_user_id, member.avatar) }));
    },
    async deleteOwned(id, memberId) {
      const result = await db.run('DELETE FROM mal_anime WHERE mal_id = ? AND creator_member_id = ?', [id, memberId]);
      return result.changes > 0;
    },
    async exists(id) { return Boolean(await db.get('SELECT mal_id FROM mal_anime WHERE mal_id = ?', [id])); },
    async count() { return Number((await db.get('SELECT COUNT(*) AS total FROM mal_anime')).total); },
  };
}
