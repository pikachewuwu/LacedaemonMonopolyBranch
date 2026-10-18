import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReview, validCategory } from '../src/modules/catalog/catalog.validation.js';

test('gültige Review-Daten', () => {
  assert.deepEqual(validateReview({ title: ' Naruto ', memberName: ' Alex ', score: 9, status: 'completed' }), {
    title: 'Naruto', memberName: 'Alex', score: 9, status: 'completed',
  });
});

test('ungültige Scores werden abgelehnt', () => {
  assert.throws(() => validateReview({ title: 'Naruto', memberName: 'Alex', score: 20, status: 'completed' }), /Bewertung/);
});

test('unbekannte Kategorien werden abgelehnt', () => {
  assert.throws(() => validCategory('movies'), /Kategorie/);
});
