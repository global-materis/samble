import { IsBooleanString, IsOptional } from 'class-validator';

export class ListProductsQuery {
  /** A query string is text: `?onlyEnabled=true` arrives as `'true'`. */
  @IsOptional()
  @IsBooleanString({ message: 'onlyEnabled must be true or false' })
  onlyEnabled?: string;
}
