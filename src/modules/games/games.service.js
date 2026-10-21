import { ValidationError } from '../catalog/catalog.validation.js';
import { steamAppId } from './steam.service.js';

const statuses = new Set(['planned', 'ongoing', 'paused', 'completed']);
const priorities = new Set(['high', 'medium', 'low']);

export function validateGameReview(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Ungültige Eingabe.');
  if (!statuses.has(body.status)) throw new ValidationError('Ungültiger Status.');
  const scored = ['paused', 'completed'].includes(body.status);
  if (scored && (!Number.isInteger(body.score) || body.score < 1 || body.score > 10)) {
    throw new ValidationError('Bewertung: ganze Zahl zwischen 1 und 10.');
  }
  const priority = body.status === 'planned' ? body.priority ?? 'medium' : null;
  if (body.status === 'planned' && !priorities.has(priority)) throw new ValidationError('Ungültige Priorität.');
  const selected = body.memberIds ?? [];
  if (!Array.isArray(selected) || selected.length > 50 || selected.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new ValidationError('Bitte wähle höchstens 50 gültige Mitglieder aus.');
  }
  return { status: body.status, score: scored ? body.score : null, priority, memberIds: [...new Set(selected)] };
}

export function makeGamesService(repository, steam, legacyRepository) {
  return {
    search(query, page) { return steam.search(query, page); },
    details(id) { return steam.details(steamAppId(id)); },
    count() { return repository.count(); },
    async members(member) {
      if (!member) throw Object.assign(new Error('Bitte melde dich zuerst mit Discord an.'), { status: 401 });
      return repository.members();
    },
    async list() {
      const [games, legacy] = await Promise.all([repository.list(), legacyRepository ? legacyRepository.list('games') : []]);
      return [...games, ...legacy.map(item => {
        const ratings = item.ratings.map(rating => ({ ...rating,
          score: ['paused', 'completed'].includes(rating.status) ? rating.score : null,
          priority: rating.status === 'planned' ? 'medium' : null }));
        const scored = ratings.filter(rating => rating.score !== null);
        return { ...item, ratings,
          averageScore: scored.length ? Math.round(scored.reduce((sum, rating) => sum + rating.score, 0) / scored.length * 10) / 10 : null,
          id: `legacy:${item.id}`, steamAppId: null, legacy: true,
        shortDescription: 'Älterer Eintrag ohne Steam-Zuordnung.', headerImage: null, genres: [], price: null,
        players: { label: 'Spielerzahl nicht angegeben' } };
      })];
    },
    async addReview(id, body, member) {
      if (!member) throw Object.assign(new Error('Bitte melde dich zuerst mit Discord an.'), { status: 401 });
      const appId = steamAppId(id);
      const input = validateGameReview(body);
      if (input.memberIds.length) {
        const existing = new Set((await repository.members()).map(member => member.id));
        if (input.memberIds.some(id => !existing.has(id))) throw new ValidationError('Mindestens ein ausgewähltes Mitglied existiert nicht mehr.');
      }
      const game = await steam.details(appId);
      return repository.saveReview(game, { ...input, memberId: member.id });
    },
    async deleteGame(id, member) {
      if (!member) throw Object.assign(new Error('Bitte melde dich zuerst mit Discord an.'), { status: 401 });
      const appId = steamAppId(id);
      if (await repository.deleteOwned(appId, member.id)) return { itemId: `steam:${appId}` };
      if (!await repository.exists(appId)) throw Object.assign(new Error('Das Spiel wurde nicht gefunden.'), { status: 404 });
      throw Object.assign(new Error('Nur das Mitglied, das das Spiel hinzugefügt hat, darf es löschen.'), { status: 403 });
    },
  };
}
