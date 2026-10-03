import { sql } from 'drizzle-orm';
import type { Migration, Transaction } from '../../../../lib';

/** Una constante suelta en la carpeta: no es una migración y no debe contarse. */
export const NAME_LENGTH = 120;

export class AddName1700000100000 implements Migration {
  public async up(db: Transaction): Promise<void> {
    await db.execute(
      sql.raw('alter table layout_things add column name varchar(120)'),
    );
  }

  public async down(db: Transaction): Promise<void> {
    await db.execute(sql.raw('alter table layout_things drop column name'));
  }
}
