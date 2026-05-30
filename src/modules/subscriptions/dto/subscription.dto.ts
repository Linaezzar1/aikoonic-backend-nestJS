import { IsString, IsOptional, IsUrl } from 'class-validator';

export class SelectPlanDto {
  @IsString()
  plan_slug: string;
}

export class CheckoutDto {
  @IsString()
  plan_slug: string;

  @IsOptional()
  @IsString()
  success_url?: string;

  @IsOptional()
  @IsString()
  cancel_url?: string;
}

export class PortalDto {
  @IsOptional()
  @IsString()
  return_url?: string;
}

export class TrackUsageDto {
  @IsString()
  feature_key: string;
}
