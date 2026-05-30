import { IsString, IsNotEmpty, IsBoolean, IsOptional, ValidateNested, IsIn, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class WorkflowStepDto {
  @IsString()
  @IsIn([
    'send_email', 'change_status', 'wait', 'condition', '__graph__',
    'check_tag', 'check_status', 'check_field',
    'add_tag', 'remove_tag', 'create_note',
  ])
  type: string;

  @IsString()
  value: string;

  @Transform(({ value }) => Math.round(Number(value ?? 0)))
  @IsInt()
  @Min(0)
  delayDays: number;

  @Transform(({ value }) => value != null ? Math.round(Number(value)) : undefined)
  @IsInt()
  @IsOptional()
  falseStep?: number;
}

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['tag_added', 'tag_removed', 'status_changed', 'contact_created', 'scheduled'])
  trigger: string;

  @IsString()
  @IsOptional()
  triggerValue?: string;

  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps: WorkflowStepDto[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
