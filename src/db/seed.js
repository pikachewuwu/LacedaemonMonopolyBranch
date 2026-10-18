//füllt test DB mit test Daten

const exampleBalances = [
  ['Felix', 12412364],
  ['Patrick', 12162677],
  ['Sophia', 9103328],
  ['Ari', 1510229],
  ['Julian', 957490],
];

export async function seedDemoData(db) {
  const result = await db.get('SELECT COUNT(*) AS total FROM economy_balances');
  if (Number(result.total) > 0) return;
  for (const [name, balance] of exampleBalances) {
    await db.run(
      'INSERT INTO economy_balances (member_name, balance, is_demo) VALUES (?, ?, ?)',
      [name, balance, db.dialect === 'postgres' ? true : 1],
    );
  }
}
