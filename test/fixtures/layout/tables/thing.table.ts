import { integer, pgTable, text } from 'drizzle-orm/pg-core';

/** Lo que el archivo exporta ADEMÁS de la tabla, que es lo normal. */
export enum ThingKind {
  Big = 'big',
  Small = 'small',
}

export const DEFAULT_KIND = ThingKind.Small;

export class ThingHelper {
  static describe(): string {
    return 'no soy una tabla';
  }
}

export const things = pgTable('layout_things', {
  id: integer('id').primaryKey(),
  name: text('name'),
});

export type Thing = typeof things.$inferSelect;
