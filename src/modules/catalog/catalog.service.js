//Logik, wie mit Daten gearbeitet wereden soll !! Vom html trennen damit code wartbarer wird

import { validCategory, validateReview } from './catalog.validation.js';

export function makeCatalogService(repository) {
  return {
    list(category) { return repository.list(validCategory(category)); },
    async addReview(category, body) {
      const type = validCategory(category);
      const input = validateReview(body);
      return repository.saveReview(type, input);
    },
    counts() { return repository.counts(); },
  };
}
