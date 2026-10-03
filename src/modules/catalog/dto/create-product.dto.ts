import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'Name required' })
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'Stock cannot be negative' })
  stock: number;
}
