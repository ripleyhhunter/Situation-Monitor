import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseFetcher } from './base.js';
import cache from '../services/cache.js';

// Mock the cache service
vi.mock('../services/cache.js', () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock logger to suppress output during tests
vi.mock('../logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Concrete implementation for testing
class TestFetcher extends BaseFetcher<{ id: string; value: number }> {
  public mockData: { id: string; value: number }[] = [];
  public shouldThrow = false;

  constructor() {
    super('test-fetcher', 60);
  }

  protected async fetchFromApi(): Promise<{ id: string; value: number }[]> {
    if (this.shouldThrow) {
      throw new Error('Simulated API error');
    }
    return this.mockData;
  }
}

describe('BaseFetcher', () => {
  let fetcher: TestFetcher;

  beforeEach(() => {
    fetcher = new TestFetcher();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetch', () => {
    it('should return cached data when available', async () => {
      const cachedData = [{ id: '1', value: 100 }];
      vi.mocked(cache.get).mockResolvedValue(cachedData);

      const result = await fetcher.fetch();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(cachedData);
      expect(cache.get).toHaveBeenCalledWith('fetcher:test-fetcher');
    });

    it('should fetch from API when cache is empty', async () => {
      vi.mocked(cache.get).mockResolvedValue(null);
      fetcher.mockData = [{ id: '2', value: 200 }];

      const result = await fetcher.fetch();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ id: '2', value: 200 }]);
      expect(cache.set).toHaveBeenCalledWith(
        'fetcher:test-fetcher',
        [{ id: '2', value: 200 }],
        60
      );
    });

    it('should bypass cache when forceRefresh is true', async () => {
      const cachedData = [{ id: '1', value: 100 }];
      vi.mocked(cache.get).mockResolvedValue(cachedData);
      fetcher.mockData = [{ id: '3', value: 300 }];

      const result = await fetcher.fetch(true);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([{ id: '3', value: 300 }]);
      // Cache.get should not have been called for data retrieval
      expect(cache.set).toHaveBeenCalled();
    });

    it('should return stale cache data on API error', async () => {
      const staleData = [{ id: '4', value: 400 }];
      vi.mocked(cache.get)
        .mockResolvedValueOnce(null) // First call - no cache
        .mockResolvedValueOnce(staleData); // Second call - stale cache fallback

      fetcher.shouldThrow = true;

      const result = await fetcher.fetch();

      expect(result.success).toBe(false);
      expect(result.data).toEqual(staleData);
      expect(result.error).toBe('Simulated API error');
    });

    it('should return error when API fails and no cache exists', async () => {
      vi.mocked(cache.get).mockResolvedValue(null);
      fetcher.shouldThrow = true;

      const result = await fetcher.fetch();

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Simulated API error');
    });

    it('should include timestamp in result', async () => {
      vi.mocked(cache.get).mockResolvedValue(null);
      fetcher.mockData = [];

      const before = new Date().toISOString();
      const result = await fetcher.fetch();
      const after = new Date().toISOString();

      expect(result.timestamp).toBeDefined();
      expect(result.timestamp >= before).toBe(true);
      expect(result.timestamp <= after).toBe(true);
    });
  });
});
