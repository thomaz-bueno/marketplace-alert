import { schedule, validate, type ScheduledTask } from "node-cron";
import { config } from "../../config";
import { runCycle } from "./cycle";

let task: ScheduledTask | null = null;

/** Starts the periodic cycle. Invalid expressions are reported, not fatal. */
export function startScheduler(): void {
  if (task) return;

  if (!validate(config.cronSchedule)) {
    console.error(
      `[scheduler] NOT started: invalid CRON_SCHEDULE "${config.cronSchedule}"`,
    );
    return;
  }

  task = schedule(config.cronSchedule, () => {
    void runCycle({ trigger: "cron" }).catch((error: unknown) => {
      console.error("[scheduler] cron cycle failed:", error);
    });
  });

  console.log(`[scheduler] cron active: ${config.cronSchedule}`);
}

export function stopScheduler(): void {
  if (!task) return;
  task.stop();
  task = null;
  console.log("[scheduler] cron stopped");
}
