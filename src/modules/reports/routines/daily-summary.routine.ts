import { Cron, Routine } from '../../../../lib';
import { ProductCatalog } from '@/catalog/tokens/product-catalog.token';
import { DailySummary } from '../tokens/daily-summary.token';

/**
 * The third way into an application: nobody calls a task, the clock does.
 * It reaches `catalog` through the same contract the endpoints use — the
 * schedule decides WHEN the work happens, never what it may reach.
 *
 * The token in `@Cron` is its identity: `app.task(DailySummary).stop()` pauses
 * it without touching this file.
 */
@Cron(DailySummary, '0 7 * * *')
export class DailySummaryRoutine extends Routine {
  async start(now: Date | 'manual' | 'init') {
    // Tasks reach contracts exactly like endpoints do.
    const catalog = this.get(ProductCatalog);
    console.log(`[${String(now)}] total stock: ${await catalog.totalStock()}`);
  }
}
