import { plainToClass } from 'class-transformer';
import { validate } from 'class-validator';

export default async function schemaValidator(
  Schema: new () => Record<string, any>,
  object: Record<string, any>,
) {
  const schema = plainToClass(Schema, object);
  const errors = await validate(schema, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    const fieldsErrors: Record<string, string> = {};
    errors.forEach((error) => {
      const constraintArr = Object.values(error.constraints || {});
      if (constraintArr.length > 0) {
        fieldsErrors[error.property] = constraintArr[0];
      }
    });
    return fieldsErrors;
  }

  return null;
}
