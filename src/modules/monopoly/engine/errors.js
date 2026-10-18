// regelverstoß: die nachricht geht unverändert an den spieler

export class GameError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameError';
    this.status = 400;
  }
}
