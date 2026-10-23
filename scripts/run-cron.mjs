#!/usr/bin/env node
import APP from '../src/worker.js';
import { createRuntime } from '../server/runtime.mjs';

const task = String(process.argv[2] || '').trim().toLowerCase();
if (!['reminders', 'backup'].includes(task)) {
  console.error('Usage: node scripts/run-cron.mjs <reminders|backup>');
  process.exitCode = 2;
} else {
  let runtime;
  try {
    runtime = createRuntime();
    const event = {
      cron: task === 'backup' ? '0 */3 * * *' : '30 5 * * *',
      scheduledTime: Date.now()
    };
    await APP.scheduled(event, runtime.env, {
      waitUntil(promise) { Promise.resolve(promise).catch((error) => console.error(error?.message || error)); }
    });
    console.log(`[cron] ${task} task completed at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`[cron] ${task} task failed:`, error?.message || error);
    process.exitCode = 1;
  } finally {
    try { runtime?.DB.close(); } catch (error) { console.error('[cron] SQLite close failed:', error?.message || error); }
  }
}
