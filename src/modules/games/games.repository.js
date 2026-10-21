import { avatarUrl } from '../auth/auth.service.js';

function isoTimestamp(value) {
  const input = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function makeGamesRepository(db) {
  return {
    async list() {
      const [games, reviews] = await Promise.all([
        db.all(`SELECT g.app_id, g.metadata_json, e.creator_member_id, e.created_at
          FROM steam_games g LEFT JOIN steam_game_entries e ON e.steam_app_id = g.app_id ORDER BY g.title ASC`),
        db.all(`SELECT r.steam_app_id, r.member_id, r.score, r.status, r.priority, r.updated_at,
          m.discord_user_id, m.display_name, m.avatar FROM steam_game_reviews r
          JOIN members m ON m.id = r.member_id ORDER BY r.updated_at DESC, r.member_id ASC`),
      ]);
      const byGame = new Map();
      for (const review of reviews) {
        const key = Number(review.steam_app_id);
        if (!byGame.has(key)) byGame.set(key, []);
        byGame.get(key).push({ id: `${key}:${review.member_id}`, memberId: Number(review.member_id),
          memberName: review.display_name, avatarUrl: avatarUrl(review.discord_user_id, review.avatar),
          score: review.score == null ? null : Number(review.score), status: review.status,
          priority: review.priority, updatedAt: review.updated_at });
      }
      return games.map(game => {
        const ratings = byGame.get(Number(game.app_id)) ?? [];
        const scored = ratings.filter(rating => ['paused', 'completed'].includes(rating.status) && rating.score !== null);
        return { ...JSON.parse(game.metadata_json), id: `steam:${game.app_id}`, steamAppId: Number(game.app_id),
          creatorMemberId: game.creator_member_id == null ? null : Number(game.creator_member_id),
          createdAt: game.created_at == null ? null : isoTimestamp(game.created_at), ratings,
          averageScore: scored.length ? Math.round(scored.reduce((sum, rating) => sum + rating.score, 0) / scored.length * 10) / 10 : null };
      });
    },
    async saveReview(game, { memberId, score, status, priority = 'medium', memberIds = [] }) {
      const storedScore = ['paused', 'completed'].includes(status) ? score : null;
      const storedPriority = status === 'planned' ? priority : null;
      await db.batch([
        { sql: `INSERT INTO steam_games (app_id, title, metadata_json, fetched_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(app_id) DO UPDATE SET title = excluded.title, metadata_json = excluded.metadata_json, fetched_at = excluded.fetched_at`,
        values: [game.steamAppId, game.title, JSON.stringify(game), Date.parse(game.metadataUpdatedAt)] },
        { sql: `INSERT INTO steam_game_entries (steam_app_id, creator_member_id) VALUES (?, ?)
          ON CONFLICT(steam_app_id) DO NOTHING`, values: [game.steamAppId, memberId] },
        { sql: `INSERT INTO steam_game_reviews (steam_app_id, member_id, score, status, priority) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(steam_app_id, member_id) DO UPDATE SET score = excluded.score, status = excluded.status,
            priority = excluded.priority, updated_at = CURRENT_TIMESTAMP`,
        values: [game.steamAppId, memberId, storedScore, status, storedPriority] },
        ...memberIds.filter(id => id !== memberId).map(id => ({
          sql: `INSERT INTO steam_game_reviews (steam_app_id, member_id, score, status, priority)
            VALUES (?, ?, NULL, 'planned', 'medium') ON CONFLICT(steam_app_id, member_id) DO NOTHING`,
          values: [game.steamAppId, id],
        })),
      ]);
      return { itemId: `steam:${game.steamAppId}` };
    },
    async members() {
      const members = await db.all('SELECT id, display_name, discord_user_id, avatar FROM members ORDER BY display_name ASC, id ASC');
      return members.map(member => ({ id: Number(member.id), name: member.display_name,
        avatarUrl: avatarUrl(member.discord_user_id, member.avatar) }));
    },
    async deleteOwned(appId, memberId) {
      // Check ownership in the DELETE itself so a stale pre-check cannot delete
      // a newly recreated entry belonging to a different member.
      const result = await db.run(`DELETE FROM steam_games WHERE app_id = ? AND EXISTS (
        SELECT 1 FROM steam_game_entries e WHERE e.steam_app_id = steam_games.app_id AND e.creator_member_id = ?
      )`, [appId, memberId]);
      return result.changes > 0;
    },
    async exists(appId) {
      return Boolean(await db.get('SELECT app_id FROM steam_games WHERE app_id = ?', [appId]));
    },
    async count() {
      const row = await db.get('SELECT COUNT(*) AS total FROM steam_games');
      return Number(row.total);
    },
  };
}
