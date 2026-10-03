import { IsNumberString } from 'class-validator';

export class ProductoIdDto {
  @IsNumberString()
  id: string;
}
