import { IsNumberString } from 'class-validator';

export class ProductIdDto {
  /**
   * GOTCHA: route params and query strings arrive as STRINGS. Validate them as
   * such and convert explicitly — `@Query` does not coerce to number either.
   */
  @IsNumberString({}, { message: 'id must be numeric' })
  id: string;
}
