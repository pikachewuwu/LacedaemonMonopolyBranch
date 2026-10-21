const names = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function rankMembers(members) {
  const sorted = members.map(member => ({ ...member })).sort((a, b) => b.balance - a.balance || names.compare(a.memberName, b.memberName));
  let rank = 0;
  return sorted.map((member, index) => {
    if (index === 0 || member.balance !== sorted[index - 1].balance) rank = index + 1;
    return { ...member, rank };
  });
}

export function selectMembers(members, { search = '', min = 0, max = Infinity, ranks = Infinity, sort = 'balance-desc', limit = Infinity } = {}) {
  const query = search.trim().toLocaleLowerCase('de');
  const selected = members.filter(member => member.memberName.toLocaleLowerCase('de').includes(query) &&
    member.balance >= min && member.balance <= max && member.rank <= ranks);
  const comparators = {
    'balance-desc': (a, b) => b.balance - a.balance || names.compare(a.memberName, b.memberName),
    'balance-asc': (a, b) => a.balance - b.balance || names.compare(a.memberName, b.memberName),
    'name-asc': (a, b) => names.compare(a.memberName, b.memberName),
    'name-desc': (a, b) => names.compare(b.memberName, a.memberName),
  };
  return selected.sort(comparators[sort] ?? comparators['balance-desc']).slice(0, limit);
}

export function summarizeMembers(members) {
  const total = members.reduce((sum, member) => sum + member.balance, 0);
  return { count: members.length, total, average: members.length ? total / members.length : 0 };
}

export function circleEntries(members, limit = 9) {
  const entries = members.slice(0, limit).map(member => ({ name: member.memberName, balance: member.balance }));
  if (members.length > limit) {
    entries.push({ name: `Weitere ${members.length - limit} Mitglieder`, balance: summarizeMembers(members.slice(limit)).total });
  }
  return entries;
}
