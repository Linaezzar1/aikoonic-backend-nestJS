import { Injectable } from '@nestjs/common';
import { CreateLeadDto } from '../dto/create-lead.dto';
import * as csv from 'csv-parser';
import * as xlsx from 'xlsx';
import { Readable, Transform } from 'stream';

const csvParser = csv as unknown as (optionsOrHeaders?: any) => Transform;

@Injectable()
export class CsvParserService {
  private isValidEmail(email: string): boolean {
    return email ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : false;
  }

  private mapRowToLead(
    row: any,
    index: number,
    errors: string[],
  ): CreateLeadDto | null {
    console.log('Parsing row:', row);
    const keys = Object.keys(row);
    console.log('Found keys:', keys);
    const getVal = (possibleKeys: string[]) => {
      const key = keys.find((k) =>
        possibleKeys.includes(k.toLowerCase().trim()),
      );
      let val = key ? row[key]?.toString().trim() : undefined;
      if (val) {
        // Remove zero-width spaces or hidden characters that Excel sometimes inserts
        val = val.replace(/[\u200B-\u200D\uFEFF]/g, '');
      }
      console.log(
        `Checking for ${possibleKeys.join(',')}. Found key:`,
        key,
        'Value:',
        val,
      );
      return val;
    };

    const email = getVal(['email', 'e-mail', 'courriel']);
    const firstName =
      getVal(['firstname', 'first_name', 'prenom', 'prénom', 'name']) ||
      undefined;
    const lastName =
      getVal(['lastname', 'last_name', 'nom', 'nom de famille']) || undefined;
    const phone =
      getVal(['phone', 'telephone', 'téléphone', 'tel']) || undefined;
    const notes =
      getVal(['notes', 'note', 'remarques', 'remarque']) || undefined;

    // Check if the row is completely empty
    if (!email && !firstName && !lastName && !phone && !notes) {
      return null;
    }

    if (!this.isValidEmail(email || '')) {
      errors.push(`Row ${index}: invalid email format ("${email}")`);
      return null;
    }

    return {
      firstName,
      lastName,
      email,
      phone,
      notes,
    } as CreateLeadDto;
  }

  async parseCSV(
    buffer: Buffer,
  ): Promise<{ leads: CreateLeadDto[]; errors: string[] }> {
    return this.parseExcel(buffer); // xlsx module can natively parse CSVs incredibly well regardless of the separator (; or ,)
  }

  async parseExcel(
    buffer: Buffer,
  ): Promise<{ leads: CreateLeadDto[]; errors: string[] }> {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' }); // use defval to avoid undefined columns

    const leads: CreateLeadDto[] = [];
    const errors: string[] = [];

    rows.forEach((row: any, i: number) => {
      const lead = this.mapRowToLead(row, i + 2, errors);
      if (lead) leads.push(lead);
    });

    return { leads, errors };
  }
}
