import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RestockDto {
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Quantity must be at least 1' })
  quantity: number;
}
