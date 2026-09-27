export class StorageError extends Error {
  constructor() {
    super('Storage unavailable');
    this.name = 'StorageError';
  }
}
