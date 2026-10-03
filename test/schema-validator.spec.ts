import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { IsEmail, IsInt, IsString } from 'class-validator';
import schemaValidator from '../lib/services/schema-validator';

class UserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}

class PageDto {
  @IsInt()
  page: number;
}

describe('schemaValidator', () => {
  it('devuelve null cuando el objeto es válido', async () => {
    const result = await schemaValidator(UserDto, {
      name: 'Erick',
      email: 'erick@example.com',
    });

    expect(result).toBeNull();
  });

  it('devuelve un mapa campo → mensaje cuando hay errores', async () => {
    const result = await schemaValidator(UserDto, {
      name: 123,
      email: 'no-es-un-correo',
    });

    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(['email', 'name']);
    expect(typeof result!.email).toBe('string');
  });

  it('rechaza propiedades no declaradas (forbidNonWhitelisted)', async () => {
    const result = await schemaValidator(UserDto, {
      name: 'Erick',
      email: 'erick@example.com',
      isAdmin: true,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('isAdmin');
  });

  it('no coacciona strings a number sin @Type: "2" no es un entero válido', async () => {
    // Documents the real behavior: query params arrive as strings, so a DTO
    // with @IsInt needs @Type(() => Number) to pass.
    const result = await schemaValidator(PageDto, { page: '2' });

    expect(result).not.toBeNull();
    expect(result).toHaveProperty('page');
  });
});
