import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

const SOURCE_DIR = '/Users/mattkelley/Library/CloudStorage/GoogleDrive-matt.kelley@visiquate.com/Shared drives/Client Command Center/BYRAM/01. Client Reference Materials/05. Requirements _ SSD_s/01. Active/Automation/Discovery/Claim Resubmit/Trigger Files';
const OUTPUT_FILE = '/Users/mattkelley/Documents/Merged_Trigger_Files.csv';

async function mergeToCSV() {
  console.log('Starting file merge to CSV...\n');

  // Create write stream
  const writeStream = fs.createWriteStream(OUTPUT_FILE);

  // Get all files
  const files = await fsPromises.readdir(SOURCE_DIR);
  const excelFiles = files.filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
  const csvFiles = files.filter(f => f.endsWith('.csv'));
  const pipeFiles = files.filter(f => f.endsWith('.CMPIPE'));

  console.log(`Found ${excelFiles.length} Excel, ${csvFiles.length} CSV, and ${pipeFiles.length} pipe-delimited files\n`);

  let allHeaders = new Set<string>();
  let headerWritten = false;
  let totalRows = 0;

  // First pass: collect all unique headers
  console.log('Collecting headers...');
  for (const file of excelFiles) {
    try {
      const filePath = path.join(SOURCE_DIR, file);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) continue;

      const firstRow = worksheet.getRow(1);
      firstRow.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell.value;
        const header = String(value || '').trim();
        if (header) allHeaders.add(header);
      });
    } catch (error: any) {
      console.log(`  ⚠️  Error reading headers from ${file}`);
    }
  }

  for (const file of csvFiles) {
    try {
      const filePath = path.join(SOURCE_DIR, file);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const firstLine = content.split('\n')[0];
      const headers = firstLine.split(',').map(h => h.trim().replace(/"/g, ''));
      headers.forEach(h => {
        if (h) allHeaders.add(h);
      });
    } catch (error: any) {
      console.log(`  ⚠️  Error reading headers from ${file}`);
    }
  }

  // For pipe files, determine max columns
  let maxColumns = 0;
  for (const file of pipeFiles) {
    try {
      const filePath = path.join(SOURCE_DIR, file);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const firstLine = content.split('\n')[0];
      const columns = firstLine.split('|').length;
      if (columns > maxColumns) maxColumns = columns;
    } catch (error: any) {
      console.log(`  ⚠️  Error reading ${file}`);
    }
  }

  // Add Field 1, Field 2, etc. headers
  for (let i = 1; i <= maxColumns; i++) {
    allHeaders.add(`Field ${i}`);
  }

  // Write header row with Source File as first column
  const finalHeaders = ['Source File', ...Array.from(allHeaders)];
  writeStream.write(finalHeaders.map(h => `"${h}"`).join(',') + '\n');
  console.log(`\nWriting ${finalHeaders.length} columns...\n`);

  // Process Excel files
  for (const file of excelFiles) {
    try {
      console.log(`Processing: ${file}`);
      const filePath = path.join(SOURCE_DIR, file);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) continue;

      let fileHeaders: string[] = [];
      let rowCount = 0;

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          // Get headers
          row.eachCell({ includeEmpty: true }, (cell) => {
            const value = cell.value && typeof cell.value === 'object' && 'result' in cell.value
              ? cell.value.result
              : cell.value;
            fileHeaders.push(String(value || '').trim());
          });
        } else {
          // Write data row
          const rowData: any = {};
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const value = cell.value && typeof cell.value === 'object' && 'result' in cell.value
              ? cell.value.result
              : cell.value;
            const header = fileHeaders[colNumber - 1];
            if (header) {
              rowData[header] = value;
            }
          });

          const csvRow = [file, ...finalHeaders.slice(1).map(h => {
            const val = rowData[h];
            return val !== undefined && val !== null ? `"${String(val).replace(/"/g, '""')}"` : '';
          })];

          writeStream.write(csvRow.join(',') + '\n');
          rowCount++;
          totalRows++;
        }
      });

      console.log(`  ✓ ${rowCount} rows`);
    } catch (error: any) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  // Process CSV files
  for (const file of csvFiles) {
    try {
      console.log(`Processing: ${file}`);
      const filePath = path.join(SOURCE_DIR, file);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      if (lines.length === 0) continue;

      const fileHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      let rowCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const rowData: any = {};
        fileHeaders.forEach((header, idx) => {
          rowData[header] = values[idx];
        });

        const csvRow = [file, ...finalHeaders.slice(1).map(h => {
          const val = rowData[h];
          return val !== undefined && val !== null ? `"${String(val).replace(/"/g, '""')}"` : '';
        })];

        writeStream.write(csvRow.join(',') + '\n');
        rowCount++;
        totalRows++;
      }

      console.log(`  ✓ ${rowCount} rows`);
    } catch (error: any) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  // Process pipe-delimited files
  for (const file of pipeFiles) {
    try {
      console.log(`Processing: ${file}`);
      const filePath = path.join(SOURCE_DIR, file);
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      if (lines.length === 0) continue;

      let rowCount = 0;

      for (const line of lines) {
        const values = line.split('|');
        const rowData: any = {};

        // Map to Field 1, Field 2, etc.
        values.forEach((val, idx) => {
          rowData[`Field ${idx + 1}`] = val.trim();
        });

        const csvRow = [file, ...finalHeaders.slice(1).map(h => {
          const val = rowData[h];
          return val !== undefined && val !== null ? `"${String(val).replace(/"/g, '""')}"` : '';
        })];

        writeStream.write(csvRow.join(',') + '\n');
        rowCount++;
        totalRows++;
      }

      console.log(`  ✓ ${rowCount} rows`);
    } catch (error: any) {
      console.log(`  ✗ Error: ${error.message}`);
    }
  }

  writeStream.end();

  console.log(`\n✓ Merge complete!`);
  console.log(`✓ Total rows: ${totalRows}`);
  console.log(`✓ Output file: ${OUTPUT_FILE}`);
}

mergeToCSV().catch(console.error);
