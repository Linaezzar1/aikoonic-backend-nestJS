import * as xlsx from 'xlsx';
import * as fs from 'fs';

const buf = fs.readFileSync('../aikoonic-backend/sample-import.csv');
const wb = xlsx.read(buf, { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
console.log(xlsx.utils.sheet_to_json(ws));
