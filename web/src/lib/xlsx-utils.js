import * as XLSX from 'xlsx';

export function readSpreadsheet(data, filename) {
    if (filename.toLowerCase().endsWith('.csv')) {
        const text = new TextDecoder().decode(data);
        const wb = XLSX.read(text, { type: 'string' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else {
        const wb = XLSX.read(data, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    }
}

export function createWorkbook(sheetName, rows) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return { wb, ws };
}

export function addSheet(wb, sheetName, rows) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return ws;
}

export function jsonToSheet(data) {
    return XLSX.utils.json_to_sheet(data);
}

export function downloadWorkbook(wb, filename) {
    XLSX.writeFile(wb, filename);
}

export function downloadJsonToExcel(data, sheetName, filename, colWidths) {
    const ws = XLSX.utils.json_to_sheet(data);
    if (colWidths) ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
}

export { XLSX };
