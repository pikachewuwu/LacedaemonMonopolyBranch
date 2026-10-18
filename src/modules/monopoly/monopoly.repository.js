export function makeMonopolyRepository(db) {
  return {
    async saveGame({ roomId, mapId, startedAt, endedAt, turns, winnerName, winnerMemberId, players }) {
      await db.run(
        `INSERT INTO monopoly_games (room_id, map_id, started_at, ended_at, turns, winner_name, winner_member_id, players_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [roomId, mapId, startedAt, endedAt, turns, winnerName, winnerMemberId, JSON.stringify(players)],
      );
    },
    async recent(limit = 10) {
      const rows = await db.all(
        `SELECT room_id, map_id, started_at, ended_at, turns, winner_name, players_json
         FROM monopoly_games ORDER BY ended_at DESC LIMIT ?`,
        [limit],
      );
      return rows.map(row => ({
        roomId: row.room_id,
        mapId: row.map_id,
        startedAt: Number(row.started_at),
        endedAt: Number(row.ended_at),
        turns: Number(row.turns),
        winnerName: row.winner_name,
        players: JSON.parse(row.players_json),
      }));
    },
  };
}
