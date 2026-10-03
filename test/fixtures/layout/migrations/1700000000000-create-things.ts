import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from '../../../../lib';

export class CreateThings1700000000000 implements Migration {
  public async up(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw('create table if not exists layout_things (id int)'),
    );
  }

  public async down(db: Transaction): Promise<void> {
    await db.execute(sql.raw('drop table if exists layout_things'));
  }
}
