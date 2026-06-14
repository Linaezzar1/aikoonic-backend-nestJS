import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  @MaxLength(255, { message: "L'email ne peut pas dépasser 255 caractères" })
  email: string;

  @IsString({ message: 'Le mot de passe est requis' })
  @MinLength(1, { message: 'Le mot de passe est requis' })
  @MaxLength(128, { message: 'Le mot de passe ne peut pas dépasser 128 caractères' })
  password: string;
}
