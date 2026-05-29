import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs/promises';

const SOURCE_DIR = '/Users/mattkelley/Library/CloudStorage/GoogleDrive-matt.kelley@visiquate.com/Shared drives/Client Command Center/BYRAM/01. Client Reference Materials/05. Requirements _ SSD_s/01. Active/Automation/Discovery/Claim Resubmit';
const OUTPUT_FILE = '/Users/mattkelley/Documents/Merged_Claim_Resubmit.xlsx';

interface RowData {
  sourceFile: string;
  data: any[];
}

async function mergeFiles() {
  console.log('Starting file merge...\n');

  // Get all files
  const files = await fs.readdir(SOURCE_DIR);
  const excelFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
  const csvFiles = files.filter(f => f.endsWith('.csv'));

  console.log(`Found ${excelFiles.length} Excel files and ${csvFiles.length} CSV files\n`);

  const allRows: RowData[] = [];
  let allHeaders = new Set<string>();

  // Process Excel files
  for (const file of excelFiles) {
    try {
      console.log(`Reading: ${file}`);
      const filePath = path.join(SOURCE_DIR, file);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      // Read first sheet only
      const worksheet = workbook.worksheets[0];
      if (!worksheet) continue;

      const rows: any[][] = [];
      let headers: string[] = [];

      worksheet.eachRow((row, rowNumber) => {
        // Get cell values (not formulas)
        const values: any[] = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Get the actual value, not the formula
          values.push(cell.value && typeof cell.value === 'object' && 'result' in cell.value
            ? cell.value.result
            : cell.value);
        });

        if (rowNumber === 1) {
          headers = values.map(v => String(v || '').trim());
          headers.forEach(h => allHeaders.add(h));
        } else {
          rows.push(values);
        }
      });

      allRows.push({
        sourceFile: file,
        data: rows.map(row => {
          const obj: any = { _sourceFile: file };
          headers.forEach((header, idx) => {
            obj[header] = row[idx];
          });
          return obj;
        })
      });

      console.log(`  ✓ ${rows.length} rows from ${file}`);
    } catch (error: any) {
      console.log(`  ✗ Error reading ${file}: ${error.message}`);
    }
  }

  // Process CSV files
  for (const file of csvFiles) {
    try {
      console.log(`Reading: ${file}`);
      const filePath = path.join(SOURCE_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      if (lines.length === 0) continue;

      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      headers.forEach(h => allHeaders.add(h));

      const rows = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
        const obj: any = { _sourceFile: file };
        headers.forEach((header, idx) => {
          obj[header] = values[idx];
        });
        return obj;
      });

      allRows.push({
        sourceFile: file,
        data: rows
      });

      console.log(`  ✓ ${rows.length} rows from ${file}`);
    } catch (error: any) {
      console.log(`  ✗ Error reading ${file}: ${error.message}`);
    }
  }

  // Create merged workbook
  console.log('\nCreating merged file...');
  const mergedWorkbook = new ExcelJS.Workbook();
  const mergedSheet = mergedWorkbook.addWorksheet('Merged Data');

  // Create headers - Source File first, then all unique headers
  const finalHeaders = ['Source File', ...Array.from(allHeaders).filter(h => h && h !== '_sourceFile')];
  mergedSheet.addRow(finalHeaders);

  // Style header row
  mergedSheet.getRow(1).font = { bold: true };
  mergedSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Add all data
  let totalRows = 0;
  for (const fileData of allRows) {
    for (const row of fileData.data) {
      const rowValues = [row._sourceFile];
      for (let i = 1; i < finalHeaders.length; i++) {
        rowValues.push(row[finalHeaders[i]] || '');
      }
      mergedSheet.addRow(rowValues);
      totalRows++;
    }
  }

  // Auto-fit columns
  mergedSheet.columns.forEach((column, idx) => {
    if (idx === 0) {
      column.width = 40; // Source File column
    } else {
      column.width = 15;
    }
  });

  // Save file
  await mergedWorkbook.xlsx.writeFile(OUTPUT_FILE);

  console.log(`\n✓ Merge complete!`);
  console.log(`✓ Total rows: ${totalRows}`);
  console.log(`✓ Output file: ${OUTPUT_FILE}`);
}

mergeFiles().catch(console.error);
