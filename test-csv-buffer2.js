const xlsx = require('xlsx');

// Create a mock buffer of a french CSV file
const csvContent = 'Name;email;phone;status\nahmed;ali@gmail.com;87545625;nouveau\nyousef;yo@gmail.com;44545625;\n';
const buffer = Buffer.from(csvContent, 'utf-8');

const workbook = xlsx.read(buffer, { type: 'buffer' });
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

console.log(rows);
