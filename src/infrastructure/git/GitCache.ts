export class GitCache<T> {
  private readonly storage = new Map<string, { expiresAt: number; value: T }>();

  public constructor(private readonly ttlMs: number) {}

  public get(key: string): T | undefined {
    const item = this.storage.get(key);
    if (!item) {
      return undefined;
    }

    if (Date.now() > item.expiresAt) {
      this.storage.delete(key);
      return undefined;
    }

    return item.value;
  }

  public set(key: string, value: T): void {
    this.storage.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  public clear(): void {
    this.storage.clear();
  }
}
