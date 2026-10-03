import { IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { UserRole } from '../tables/user.table';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'Username required' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'Full name required' })
  fullName: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsIn(['owner', 'staff'], { message: 'Role must be owner or staff' })
  role: UserRole;
}
