import { sql } from 'drizzle-orm';
import { Provider, Provides } from '../../../../lib';
import { rows } from '../../../../lib';
import { Grants } from '../tokens/grants.token';

/** Lee de la base: prueba que `this.db` llega vivo al proveedor. */
@Provides(Grants)
export class GrantsProvider extends Provider implements Grants {
  public async forUser(userId: number): Promise<string[] | null> {
    // La tabla la crea la prueba, no un módulo, así que va por SQL con el
    // parámetro interpolado — que `sql` parametriza, no pega.
    const found = await rows<{ perms: string }>(
      this.db,
      sql`select perms from permisos_demo where user_id = ${userId}`,
    );

    return found.length > 0 ? found[0].perms.split(',') : null;
  }
}
