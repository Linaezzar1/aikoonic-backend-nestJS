import { IsString, IsNotEmpty, IsBoolean, IsOptional, ValidateNested, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class WorkflowStepDto {
  @IsString()
  @IsIn(['send_email', 'change_status', 'wait', 'condition', '__graph__'])
  type: string;

  @IsString()
  value: string;

  @IsInt()
  @Min(0)
  delayDays: number;
}

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['tag_added', 'status_changed', 'scheduled'])
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
