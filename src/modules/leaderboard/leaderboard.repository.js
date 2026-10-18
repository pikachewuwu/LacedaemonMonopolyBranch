export function makeLeaderboardRepository(db) {
  return {
    async list() {
      const rows = await db.all(
        'SELECT member_name, balance, is_demo, updated_at FROM economy_balances ORDER BY balance DESC, member_name ASC',
      );
      return rows.map(row => ({
        memberName: row.member_name,
        balance: Number(row.balance),
        isDemo: Boolean(row.is_demo),
        updatedAt: row.updated_at,
      }));
    },
  };
}
