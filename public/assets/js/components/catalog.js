import { element } from '../core/dom.js';

const statusText = {
  anime: { planned: 'Geplant', ongoing: 'Wird geschaut', completed: 'Gesehen' },
  games: { planned: 'Merkliste', ongoing: 'Wird gespielt', completed: 'Gespielt' },
};

export function renderCatalog(target, items, category) {
  target.replaceChildren();
  if (!items.length) {
    target.append(element('p', 'empty-message', 'Noch keine Einträge. Füge unten den ersten Titel hinzu.'));
    return;
  }
  for (const item of items) {
    const card = element('article', 'catalog-card');
    const heading = element('div', 'catalog-card-heading');
    heading.append(element('h3', 'catalog-title', item.title));
    const score = item.averageScore === null ? 'Noch keine Bewertung' : `${item.averageScore.toLocaleString('de-DE')} / 10`;
    heading.append(element('span', 'score-chip', score));
    card.append(heading);
    const reviews = element('div', 'reviews');
    for (const review of item.ratings) {
      const row = element('div', 'review-row');
      row.append(
        element('strong', '', review.memberName),
        element('span', 'muted', statusText[category][review.status] ?? review.status),
        element('span', 'review-score', `${review.score}/10`),
      );
      reviews.append(row);
    }
    card.append(reviews);
    target.append(card);
  }
}
