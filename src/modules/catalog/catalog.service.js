//Logik, wie mit Daten gearbeitet wereden soll !! Vom html trennen damit code wartbarer wird

import { validCategory, validateReview, ValidationError } from './catalog.validation.js';

export function makeCatalogService(repository, { games, anime } = {}) {
  return {
    list(category) {
      const type = validCategory(category);
      if (type === 'games' && games) return games.list();
      if (type === 'anime' && anime) return anime.list();
      return repository.list(type);
    },
    async addReview(category, body) {
      const type = validCategory(category);
      if (type === 'games') throw new ValidationError('Bitte füge Spiele über die Steam-Suche mit deiner Discord-Anmeldung hinzu.');
      if (type === 'anime' && anime) throw new ValidationError('Bitte füge Anime über die MyAnimeList-Suche mit deiner Discord-Anmeldung hinzu.');
      const input = validateReview(body);
      return repository.saveReview(type, input);
    },
    async counts() {
      const counts = await repository.counts();
      if (games) counts.games += await games.count();
      if (anime) counts.anime += await anime.count();
      return counts;
    },
  };
}
