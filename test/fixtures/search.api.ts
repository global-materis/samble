import { IsOptional, IsString } from 'class-validator';
import { Endpoint, Body, HttpQuery, Group } from '../../lib';

export class SearchBodyDto {
  @IsString()
  termino: string;

  @IsOptional()
  @IsString()
  ciudad?: string;
}

/**
 * HTTP QUERY method: safe and idempotent like GET, but with criteria in the
 * body (`@Body`) instead of the query string.
 */
@Group('busqueda')
@HttpQuery('clientes')
@Body(SearchBodyDto)
export class SearchCustomersApi extends Endpoint<null, SearchBodyDto> {
  main() {
    return { buscado: this.body.termino, ciudad: this.body.ciudad ?? null };
  }
}
