export function makeCatalogRepository(db) {
  return {
    async list(category) {
      const items = await db.all(
        'SELECT id, title, created_at FROM catalog_items WHERE category = ? ORDER BY title_key ASC',
        [category],
      );
      const reviews = await db.all(
        `SELECT r.id, r.item_id, r.member_name, r.score, r.status, r.updated_at
         FROM reviews r JOIN catalog_items i ON i.id = r.item_id
         WHERE i.category = ? ORDER BY r.member_key ASC`,
        [category],
      );
      const lookup = new Map(items.map(item => [String(item.id), { ...item, reviews: [] }]));
      for (const review of reviews) {
        const entry = lookup.get(String(review.item_id));
        if (entry) entry.reviews.push({
          id: Number(review.id),
          memberName: review.member_name,
          score: Number(review.score),
          status: review.status,
          updatedAt: review.updated_at,
        });
      }
      return [...lookup.values()].map(item => ({
        id: Number(item.id),
        title: item.title,
        createdAt: item.created_at,
        ratings: item.reviews,
        averageScore: item.reviews.length
          ? Math.round(item.reviews.reduce((sum, review) => sum + review.score, 0) / item.reviews.length * 10) / 10
          : null,
      }));
    },
    async saveReview(category, input) {
      const titleKey = input.title.toLocaleLowerCase('de-DE');
      const memberKey = input.memberName.toLocaleLowerCase('de-DE');
      await db.run(
        'INSERT INTO catalog_items (category, title, title_key) VALUES (?, ?, ?) ON CONFLICT(category, title_key) DO NOTHING',
        [category, input.title, titleKey],
      );
      const item = await db.get('SELECT id FROM catalog_items WHERE category = ? AND title_key = ?', [category, titleKey]);
      await db.run(
        `INSERT INTO reviews (item_id, member_name, member_key, score, status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(item_id, member_key)
         DO UPDATE SET member_name = excluded.member_name,
           score = excluded.score, status = excluded.status,
           updated_at = CURRENT_TIMESTAMP`,
        [item.id, input.memberName, memberKey, input.score, input.status],
      );
      return { itemId: Number(item.id) };
    },
    async counts() {
      const rows = await db.all('SELECT category, COUNT(*) AS total FROM catalog_items GROUP BY category');
      const counts = { anime: 0, games: 0 };
      for (const row of rows) counts[row.category] = Number(row.total);
      return counts;
    },
  };
}
