const schedule = require('node-schedule');

class Scheduler {
  constructor(config) {
    this.config = config;
    this.jobs = [];
  }

  scheduleUpdateTask(handler, intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;

    // Run immediately on start
    handler();

    // Schedule recurring task
    const job = setInterval(() => {
      handler();
    }, intervalMs);

    this.jobs.push({ type: 'interval', job });
    console.log(`Scheduled update task to run every ${intervalMinutes} minutes`);

    return job;
  }

  scheduleDailyTask(handler, timeString, timezone) {
    // Parse time string (format: "HH:MM")
    const [hours, minutes] = timeString.split(':').map(Number);

    try {
      const job = schedule.scheduleJob(
        { hour: hours, minute: minutes, tz: timezone },
        handler
      );

      this.jobs.push({ type: 'cron', job });
      console.log(`Scheduled daily task for ${timeString} (${timezone})`);

      return job;
    } catch (error) {
      console.error(`Failed to schedule daily task: ${error.message}`);
      return null;
    }
  }

  cancelAll() {
    this.jobs.forEach(({ type, job }) => {
      if (type === 'interval') {
        clearInterval(job);
      } else if (type === 'cron') {
        job.cancel();
      }
    });

    this.jobs = [];
    console.log('All scheduled tasks cancelled');
  }

  getJobCount() {
    return this.jobs.length;
  }
}

module.exports = Scheduler;
