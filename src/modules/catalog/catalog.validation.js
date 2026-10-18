export const categories = new Set(['anime', 'games']);
export const statuses = new Set(['planned', 'ongoing', 'completed']);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

export function validCategory(category) {
  if (!categories.has(category)) throw new ValidationError('Unbekannte Kategorie.');
  return category;
}

export function validateReview(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Ungültige Eingabe.');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const memberName = typeof body.memberName === 'string' ? body.memberName.trim() : '';
  const score = body.score;
  const status = body.status;
  if (title.length < 1 || title.length > 120) throw new ValidationError('Titel: 1–120 Zeichen erforderlich.');
  if (memberName.length < 2 || memberName.length > 40) throw new ValidationError('Name: 2–40 Zeichen erforderlich.');
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new ValidationError('Bewertung: ganze Zahl zwischen 1 und 10.');
  if (!statuses.has(status)) throw new ValidationError('Ungültiger Status.');
  return { title, memberName, score, status };
}
