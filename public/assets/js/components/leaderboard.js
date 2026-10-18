import { element, formatNumber } from '../core/dom.js';

export function renderLeaderboard(target, members) {
  target.replaceChildren();
  if (!members.length) {
    target.append(element('p', 'empty-message', 'Noch keine Einträge vorhanden.'));
    return;
  }
  members.forEach((member, index) => {
    const row = element('div', 'leaderboard-row');
    row.append(
      element('span', 'rank', String(index + 1).padStart(2, '0')),
      element('span', 'player-name', member.memberName),
      element('span', 'balance', `${formatNumber(member.balance)} Drachen`),
    );
    target.append(row);
  });
}
