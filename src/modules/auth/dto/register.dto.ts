import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  @MaxLength(255, { message: "L'email ne peut pas dépasser 255 caractères" })
  email: string;

  @IsString({ message: 'Le mot de passe est requis' })
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  @MaxLength(128, { message: 'Le mot de passe ne peut pas dépasser 128 caractères' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Le mot de passe doit contenir au moins une minuscule, une majuscule et un chiffre',
  })
  password: string;

  @IsOptional()
  @IsString({ message: 'Le prénom doit être du texte' })
  @MaxLength(100, { message: 'Le prénom ne peut pas dépasser 100 caractères' })
  firstName?: string;

  @IsOptional()
  @IsString({ message: 'Le nom doit être du texte' })
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères' })
  lastName?: string;
}
