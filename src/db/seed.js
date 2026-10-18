//füllt test DB mit test Daten

const exampleBalances = [
  ['Demo-Mitglied 1', 12412364],
  ['Demo-Mitglied 2', 12162677],
  ['Demo-Mitglied 3', 9103328],
  ['Demo-Mitglied 4', 1510229],
  ['Demo-Mitglied 5', 957490],
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
