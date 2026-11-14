const XLSX = require('xlsx');
const headers = ['nama', 'tempat', 'no_whatsapp', 'notes'];

function template() {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ['', '', '', '']]);
  sheet['!cols'] = [{ wch: 28 }, { wch: 24 }, { wch: 20 }, { wch: 45 }];
  for (let row = 2; row <= 1001; row++) sheet['C' + row] = { t: 's', v: '', z: '@' };
  sheet['!ref'] = 'A1:D1001';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Daftar tamu');
  return XLSX.write(book, { bookType: 'biff8', type: 'buffer' });
}

function rowsFromExcel(data) {
  if (!data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
    throw new Error('Invalid XLS file');
  }
  const book = XLSX.read(data, { sheets: 0, cellFormula: false });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {
    header: 1, defval: '', raw: false, blankrows: false, range: 0,
  });
}

module.exports = { headers, template, rowsFromExcel };
