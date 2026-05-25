import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeneratedWorkflow {
  name: string;
  trigger: string;
  triggerValue?: string;
  steps: Array<{ type: string; value: string; delayDays: number }>;
}

@Injectable()
export class WorkflowAiService {
  private readonly pythonApiUrl: string;

  constructor(private readonly config: ConfigService) {
    this.pythonApiUrl = this.config.get<string>('PYTHON_API_URL') ?? 'http://backend:8000';
  }

  async generateFromDescription(description: string): Promise<GeneratedWorkflow> {
    let response: Response;
    try {
      response = await fetch(`${this.pythonApiUrl}/ai/workflows/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
    } catch {
      throw new InternalServerErrorException('Le service IA est temporairement indisponible.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Erreur inconnue' })) as { detail?: string };
      throw new BadRequestException(error.detail ?? "L'IA n'a pas pu générer un workflow valide.");
    }

    return response.json() as Promise<GeneratedWorkflow>;
  }
}
