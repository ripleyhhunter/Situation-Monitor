import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduler } from './scheduler.js';

// Mock node-cron
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn(() => ({
      stop: vi.fn(),
    })),
  },
}));

// Mock logger
vi.mock('../logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up any existing tasks
    scheduler.shutdown();
  });

  afterEach(() => {
    scheduler.shutdown();
  });

  describe('schedule', () => {
    it('should register a task with given name and cron expression', async () => {
      const cron = await import('node-cron');
      const mockHandler = vi.fn();

      scheduler.schedule('test-task', '*/5 * * * *', mockHandler, false);

      expect(cron.default.schedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function),
        expect.objectContaining({
          scheduled: true,
          timezone: 'America/New_York',
        })
      );
    });

    it('should cancel existing task with same name before registering new one', async () => {
      const mockHandler1 = vi.fn();
      const mockHandler2 = vi.fn();

      scheduler.schedule('duplicate-task', '*/5 * * * *', mockHandler1, false);
      scheduler.schedule('duplicate-task', '*/10 * * * *', mockHandler2, false);

      const status = scheduler.getStatus();
      const duplicateTasks = status.filter((t) => t.name === 'duplicate-task');
      expect(duplicateTasks.length).toBe(1);
    });
  });

  describe('cancel', () => {
    it('should return true when cancelling existing task', () => {
      scheduler.schedule('cancel-test', '*/5 * * * *', vi.fn(), false);

      const result = scheduler.cancel('cancel-test');

      expect(result).toBe(true);
    });

    it('should return false when cancelling non-existent task', () => {
      const result = scheduler.cancel('non-existent-task');

      expect(result).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return status of all scheduled tasks', () => {
      scheduler.schedule('task1', '*/1 * * * *', vi.fn(), false);
      scheduler.schedule('task2', '*/2 * * * *', vi.fn(), false);

      const status = scheduler.getStatus();

      expect(status.length).toBe(2);
      expect(status.map((t) => t.name)).toContain('task1');
      expect(status.map((t) => t.name)).toContain('task2');
    });
  });

  describe('shutdown', () => {
    it('should clear all scheduled tasks', () => {
      scheduler.schedule('shutdown-test1', '*/1 * * * *', vi.fn(), false);
      scheduler.schedule('shutdown-test2', '*/2 * * * *', vi.fn(), false);

      scheduler.shutdown();

      const status = scheduler.getStatus();
      expect(status.length).toBe(0);
    });
  });
});
