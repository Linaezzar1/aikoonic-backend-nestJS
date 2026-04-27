const xlsx = require('xlsx');

// Create a workbook with a hyperlink
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet([
  ['email']
]);
// Add a hyperlink manually
ws['A2'] = { t: 's', v: 'ali@gmail.com', l: { Target: 'mailto:ali@gmail.com' } };
ws['!ref'] = 'A1:A2';
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

const workbook = xlsx.read(buffer, { type: 'buffer' });
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

console.log(rows);
