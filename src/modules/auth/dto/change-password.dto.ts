import { IsString, MaxLength, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8, {
    message: 'Le nouveau mot de passe doit contenir au moins 8 caractères',
  })
  @MaxLength(128, {
    message: 'Le nouveau mot de passe ne peut pas dépasser 128 caractères',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'Le nouveau mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre',
  })
  newPassword: string;
}
