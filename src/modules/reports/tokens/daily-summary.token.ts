import { token } from '../../../../lib';

/**
 * The schedule, as something that can be turned on and off.
 *
 * A task token carries no type, because nothing is handed over: what it names
 * is a clock. Whoever wants to pause this one imports THIS and calls
 * `this.schedule(DailySummary).stop()` — never the class, which stays private to
 * the module like any other implementation.
 */
export const DailySummary = token('reports.daily-summary', 'schedule');
