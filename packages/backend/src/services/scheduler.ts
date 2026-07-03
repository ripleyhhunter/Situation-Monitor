import cron from 'node-cron';
import logger from '../logger.js';

interface ScheduledTask {
  name: string;
  task: cron.ScheduledTask;
  lastRun?: Date;
  nextRun?: Date;
  running?: boolean;
}

class SchedulerService {
  private tasks: Map<string, ScheduledTask> = new Map();

  /**
   * Schedule a task to run at a cron expression
   * @param name Unique name for the task
   * @param cronExpression Cron expression (e.g., '* /5 * * * *' for every 5 minutes)
   * @param handler Function to execute
   * @param runImmediately Whether to run the task immediately on registration
   */
  schedule(
    name: string,
    cronExpression: string,
    handler: () => Promise<void>,
    runImmediately = true
  ): void {
    // Cancel existing task with same name
    this.cancel(name);

    const wrappedHandler = async () => {
      const taskInfo = this.tasks.get(name);

      // Overlap guard: node-cron fires on every tick regardless of whether
      // the previous run finished. Without this, a slow upstream (OpenSky,
      // PulsePoint) stacks concurrent runs — up to ~19 at the 5s aircraft
      // cadence — burning quota and resources.
      if (taskInfo?.running) {
        logger.debug(`Skipping scheduled task ${name} - previous run still in progress`);
        return;
      }

      if (taskInfo) {
        taskInfo.running = true;
        taskInfo.lastRun = new Date();
      }

      try {
        logger.debug(`Running scheduled task: ${name}`);
        await handler();
      } catch (error) {
        logger.error(`Scheduled task failed: ${name}`, { error });
      } finally {
        const info = this.tasks.get(name);
        if (info) {
          info.running = false;
        }
      }
    };

    const task = cron.schedule(cronExpression, wrappedHandler, {
      scheduled: true,
      timezone: 'America/New_York',
    });

    this.tasks.set(name, {
      name,
      task,
      lastRun: undefined,
    });

    logger.info(`Scheduled task registered: ${name}`, { cronExpression });

    // Run immediately if requested
    if (runImmediately) {
      wrappedHandler();
    }
  }

  /**
   * Schedule a task to run at fixed intervals (in milliseconds)
   */
  scheduleInterval(
    name: string,
    intervalMs: number,
    handler: () => Promise<void>,
    runImmediately = true
  ): void {
    // Convert milliseconds to cron expression approximation
    const seconds = Math.floor(intervalMs / 1000);

    let cronExpression: string;

    if (seconds < 60) {
      // Run every N seconds (cron doesn't support sub-minute, so use 1 minute minimum)
      cronExpression = '* * * * *'; // Every minute
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      cronExpression = `*/${minutes} * * * *`; // Every N minutes
    } else {
      const hours = Math.floor(seconds / 3600);
      cronExpression = `0 */${hours} * * *`; // Every N hours
    }

    this.schedule(name, cronExpression, handler, runImmediately);
  }

  /**
   * Cancel a scheduled task
   */
  cancel(name: string): boolean {
    const taskInfo = this.tasks.get(name);
    if (taskInfo) {
      taskInfo.task.stop();
      this.tasks.delete(name);
      logger.info(`Scheduled task cancelled: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get status of all scheduled tasks
   */
  getStatus(): Array<{ name: string; lastRun?: Date }> {
    return Array.from(this.tasks.values()).map((t) => ({
      name: t.name,
      lastRun: t.lastRun,
    }));
  }

  /**
   * Stop all scheduled tasks
   */
  shutdown(): void {
    this.tasks.forEach((taskInfo, name) => {
      taskInfo.task.stop();
      logger.debug(`Stopped task: ${name}`);
    });
    this.tasks.clear();
    logger.info('Scheduler shut down');
  }
}

export const scheduler = new SchedulerService();
export default scheduler;
