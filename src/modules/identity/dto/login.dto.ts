import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Username required' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'Password required' })
  password: string;
}
