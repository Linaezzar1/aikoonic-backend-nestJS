const xlsx = require('xlsx');

// Create a dummy workbook mimicking the user's excel file
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet([
  ['Name', 'email', 'phone', 'status'],
  ['ahmed', 'ali@gmail.com', 87545625, 'nouveau'],
  ['yousef', 'yo@gmail.com', 44545625, '']
]);
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

// Simulate parsing
const workbook = xlsx.read(buffer, { type: 'buffer' });
const firstSheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[firstSheetName];
const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });

console.log(rows);
