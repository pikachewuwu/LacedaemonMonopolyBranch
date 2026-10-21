import { ValidationError } from '../catalog/catalog.validation.js';
import { malId } from './mal.service.js';

const statuses = new Set(['watching', 'plan_to_watch', 'completed', 'dropped', 'on_hold']);
function requireMember(member) {
  if (!member) throw Object.assign(new Error('Bitte melde dich zuerst mit Discord an.'), { status: 401 });
}

export function validateAnimeEntry(body, anime) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !statuses.has(body.status)) throw new ValidationError('Ungültiger Anime-Status.');
  if (body.autoComplete !== undefined && typeof body.autoComplete !== 'boolean') throw new ValidationError('Ungültige automatische Statusauswahl.');
  const selected = body.memberIds ?? [];
  if (!Array.isArray(selected) || selected.length > 50 || selected.some(id => !Number.isSafeInteger(id) || id < 1)) throw new ValidationError('Bitte wähle höchstens 50 gültige Mitglieder aus.');
  let status = body.status, watchedEpisodes = null, score = null;
  if (body.status !== 'plan_to_watch') {
    watchedEpisodes = body.status === 'completed' && body.watchedEpisodes == null ? anime?.episodes : body.watchedEpisodes;
    if (!Number.isInteger(watchedEpisodes) || watchedEpisodes < 0 || watchedEpisodes > 100000) {
      throw new ValidationError('Bitte gib eine gültige Anzahl gesehener Episoden ein.');
    }
    if (Number.isInteger(anime?.episodes) && anime.episodes > 0) {
      if (watchedEpisodes > anime.episodes) throw new ValidationError(`Dieser Anime hat ${anime.episodes} Episoden.`);
      if (status === 'completed' && watchedEpisodes < anime.episodes) status = 'watching';
      if (body.autoComplete !== false && watchedEpisodes === anime.episodes) status = 'completed';
    } else if (anime && status === 'completed' && watchedEpisodes === 0) {
      throw new ValidationError('Bitte gib eine gültige Anzahl gesehener Episoden ein.');
    }
  }
  if (status === 'completed' && body.score != null) {
    if (!Number.isInteger(body.score) || body.score < 1 || body.score > 10) throw new ValidationError('Bewertung: ganze Zahl zwischen 1 und 10.');
    score = body.score;
  }
  return { status, score, watchedEpisodes, memberIds: [...new Set(selected)] };
}

export function makeAnimeService(repository, source, legacyRepository) {
  return {
    search(query, page) { return source.search(query, page); },
    details(id) { return source.details(malId(id)); },
    async season() {
      const [feed, saved] = await Promise.all([source.season(), repository.list()]);
      const byMalId = new Map(saved.map(item => [item.malId, item]));
      return { ...feed, items: feed.items.map(anime => {
        const local = byMalId.get(anime.malId);
        return local ? { ...local, ...anime, id: local.id, creatorMemberId: local.creatorMemberId, createdAt: local.createdAt,
          ratings: local.ratings, averageScore: local.averageScore }
          : { ...anime, id: `mal:${anime.malId}`, ratings: [], averageScore: null };
      }) };
    },
    count() { return repository.count(); },
    async members(member) { requireMember(member); return repository.members(); },
    async list() {
      const [items, legacy] = await Promise.all([repository.list(), legacyRepository ? legacyRepository.list('anime') : []]);
      return [...items, ...legacy.map(item => ({ ...item, id: `legacy:${item.id}`, malId: null, legacy: true,
        synopsis: 'Bestehender Eintrag ohne MyAnimeList-Zuordnung.', imageUrl: null, genres: [], episodes: null, type: 'Unbekannt',
        averageScore: null, ratings: item.ratings.map(rating => ({ ...rating, score: rating.status === 'completed' ? rating.score : null,
          status: rating.status === 'planned' ? 'plan_to_watch' : rating.status === 'ongoing' ? 'watching' : 'completed', watchedEpisodes: null })) }))];
    },
    async addEntry(id, body, member) {
      requireMember(member);
      const animeId = malId(id);
      // Validate the request before making a provider request; episode totals are
      // checked again against provider data, never against client metadata.
      if (body?.status !== 'completed') validateAnimeEntry(body);
      else validateAnimeEntry({ ...body, watchedEpisodes: body.watchedEpisodes ?? 1 });
      if (body.memberIds?.length) {
        const available = new Set((await repository.members()).map(entry => entry.id));
        if (body.memberIds.some(id => !available.has(id))) throw new ValidationError('Mindestens ein ausgewähltes Mitglied existiert nicht mehr.');
      }
      const anime = await source.details(animeId);
      return repository.saveEntry(anime, { ...validateAnimeEntry(body, anime), memberId: member.id });
    },
    async deleteAnime(id, member) {
      requireMember(member);
      const animeId = malId(id);
      if (await repository.deleteOwned(animeId, member.id)) return { itemId: `mal:${animeId}` };
      if (!await repository.exists(animeId)) throw Object.assign(new Error('Dieser Anime wurde nicht gefunden.'), { status: 404 });
      throw Object.assign(new Error('Nur das Mitglied, das den Anime hinzugefügt hat, darf ihn löschen.'), { status: 403 });
    },
  };
}
