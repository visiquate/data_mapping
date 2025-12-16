import { chromium, Browser, Page, BrowserContext } from 'playwright';
import prompts from 'prompts';
import ExcelJS from 'exceljs';
import * as path from 'path';

// Input record from the existing extract
interface PayerRecord {
  organization: string;
  state: string;
  payerName: string;
  payerId: string;
  url: string;
}

// Output record with search tab flags
interface PayerWithTabs extends PayerRecord {
  searchTabs: string[];
  error?: string;
}

// Retry configuration
const RETRY_DELAYS = [1000, 3000, 5000]; // Increasing delays for retries
const MAX_RETRIES = 3;

// Store credentials for session recovery
let storedUsername = '';
let storedPassword = '';

async function promptCredentials() {
  const response = await prompts([
    {
      type: 'text',
      name: 'username',
      message: 'Enter Availity username:',
      validate: (value) => value.length > 0 || 'Username is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter Availity password:',
      validate: (value) => value.length > 0 || 'Password is required'
    }
  ]);

  if (!response.username || !response.password) {
    throw new Error('Credentials are required');
  }

  // Store for session recovery
  storedUsername = response.username;
  storedPassword = response.password;

  return response;
}

async function prompt2FACode() {
  const response = await prompts({
    type: 'text',
    name: 'code',
    message: 'Enter 2FA verification code:',
    validate: (value) => value.length > 0 || '2FA code is required'
  });

  if (!response.code) {
    throw new Error('2FA code is required');
  }

  return response.code;
}

async function login(page: Page, username: string, password: string) {
  console.log('Navigating to Availity login page...');
  await page.goto('https://apps.availity.com/public-apps/login');

  await page.waitForSelector('input[name="userId"]', { timeout: 10000 });

  console.log('Entering credentials...');
  await page.fill('input[name="userId"]', username);
  await page.fill('input[name="password"]', password);

  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

async function handle2FA(page: Page) {
  console.log('Handling 2FA...');

  const textMethodButton = page.locator('text=Text').first();
  if (await textMethodButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Selecting Text 2FA method...');
    await textMethodButton.click();
    await page.waitForTimeout(1000);

    const continueButton = page.locator('button:has-text("Continue"), button:has-text("Request Code"), button[type="submit"]').first();
    if (await continueButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking Continue to request code...');
      await continueButton.click();
      await page.waitForLoadState('networkidle');
    }
  }

  await page.waitForSelector('input[type="text"], input[type="tel"]', { timeout: 5000 });

  const code = await prompt2FACode();

  console.log('Entering 2FA code...');
  await page.fill('input[type="text"], input[type="tel"]', code);
  await page.click('button:has-text("Continue"), button:has-text("Verify"), button[type="submit"]');

  await page.waitForLoadState('networkidle');
}

async function skipUpdateAndAcceptCookies(page: Page) {
  const updateLaterButton = page.locator('button:has-text("Update Now"), button:has-text("Continue")');
  if (await updateLaterButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Skipping update notification...');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
  }

  console.log('Dismissing cookie banners...');
  const cookieSelectors = [
    '#onetrust-accept-btn-handler',
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    '#onetrust-close-btn-container button',
    '.onetrust-close-btn-handler',
    '[aria-label="Close"]'
  ];

  for (const selector of cookieSelectors) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      await button.click();
      await page.waitForTimeout(1000);
    }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('✓ Cookie banners dismissed');
}

async function dismissCookieBanner(page: Page) {
  const closeCookieBanner = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button:has-text("Close")');
  if (await closeCookieBanner.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeCookieBanner.first().click();
    await page.waitForTimeout(300);
  }
}

function checkSessionTimeout(page: Page): boolean {
  const currentUrl = page.url();
  return currentUrl.includes('logout') || currentUrl.includes('login');
}

async function reAuthenticate(page: Page): Promise<boolean> {
  console.log('\n🔄 Re-authenticating...');
  try {
    await login(page, storedUsername, storedPassword);
    await handle2FA(page);
    await skipUpdateAndAcceptCookies(page);
    console.log('✓ Re-authentication successful');
    return true;
  } catch (error: any) {
    console.error(`✗ Re-authentication failed: ${error.message}`);
    return false;
  }
}

async function extractSearchTabs(page: Page): Promise<string[]> {
  const searchTabs: string[] = [];

  // Wait for iframe to load
  await page.waitForTimeout(2000);

  // Look for the iframe containing the claim status UI
  const frameElement = page.frameLocator('iframe[src*="enhanced-claim-status-ui"]');

  // Tab selectors to try
  const tabSelectors = [
    '[role="tablist"] [role="tab"]',
    '.nav-tabs .nav-link',
    '.nav-tabs li a',
    'nav[class*="Tab"] button',
    'nav[class*="Tab"] a',
    '[class*="Tabs"] button',
    '[class*="tabs"] a',
    'ul[role="tablist"] li',
    '.tab-list .tab',
    '[data-testid*="tab"]'
  ];

  for (const selector of tabSelectors) {
    try {
      const tabs = frameElement.locator(selector);
      const count = await tabs.count();
      if (count > 0) {
        const tabTexts = await tabs.allTextContents();
        for (const text of tabTexts) {
          const trimmed = text.trim();
          if (trimmed && !searchTabs.includes(trimmed)) {
            searchTabs.push(trimmed);
          }
        }
        if (searchTabs.length > 0) break;
      }
    } catch {
      // Continue to next selector
    }
  }

  return searchTabs;
}

async function processPayerWithRetry(
  page: Page,
  payer: PayerRecord,
  retryCount: number = 0
): Promise<PayerWithTabs> {
  try {
    // Navigate to the payer URL
    await page.goto(payer.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Check for session timeout after navigation
    if (checkSessionTimeout(page)) {
      throw new Error('SESSION_TIMEOUT');
    }

    // Dismiss any cookie banners
    await dismissCookieBanner(page);

    // Extract search tabs
    const searchTabs = await extractSearchTabs(page);

    return {
      ...payer,
      searchTabs
    };
  } catch (error: any) {
    // Handle session timeout specially
    if (error.message === 'SESSION_TIMEOUT') {
      throw error; // Propagate to main loop for re-auth
    }

    // Retry logic for other errors
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      console.log(`  ⚠ Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms: ${error.message}`);
      await page.waitForTimeout(delay);
      return processPayerWithRetry(page, payer, retryCount + 1);
    }

    // All retries exhausted
    return {
      ...payer,
      searchTabs: [],
      error: error.message
    };
  }
}

async function loadInputData(inputPath: string): Promise<PayerRecord[]> {
  console.log(`Reading input file: ${inputPath}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  const worksheet = workbook.getWorksheet('Payers by State');
  if (!worksheet) {
    throw new Error('Could not find worksheet "Payers by State"');
  }

  const records: PayerRecord[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      records.push({
        organization: row.getCell(1).value?.toString() || '',
        state: row.getCell(2).value?.toString() || '',
        payerName: row.getCell(3).value?.toString() || '',
        payerId: row.getCell(4).value?.toString() || '',
        url: row.getCell(5).value?.toString() || ''
      });
    }
  });

  console.log(`Loaded ${records.length} payer records`);
  return records;
}

async function loadProgress(outputPath: string): Promise<Set<string>> {
  const processed = new Set<string>();

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);
    const worksheet = workbook.getWorksheet('Payer Search Tabs');

    if (worksheet) {
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          const state = row.getCell(2).value?.toString() || '';
          const payerName = row.getCell(3).value?.toString() || '';
          processed.add(`${state}|${payerName}`);
        }
      });
      console.log(`Found ${processed.size} previously processed payers`);
    }
  } catch {
    console.log('No previous progress file found - starting fresh');
  }

  return processed;
}

async function saveResults(
  results: PayerWithTabs[],
  outputPath: string,
  allTabTypes: Set<string>
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payer Search Tabs');

  // Build dynamic columns based on all discovered tab types
  const tabColumns = Array.from(allTabTypes).sort();

  // Define columns
  const columns = [
    { header: 'Organization', key: 'organization', width: 40 },
    { header: 'State', key: 'state', width: 20 },
    { header: 'Payer Name', key: 'payerName', width: 50 },
    { header: 'Payer ID', key: 'payerId', width: 30 },
    { header: 'URL', key: 'url', width: 100 },
    ...tabColumns.map(tab => ({ header: tab, key: tab, width: 15 })),
    { header: 'Error', key: 'error', width: 50 }
  ];

  worksheet.columns = columns;

  // Style headers
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Add data rows
  results.forEach(payer => {
    const row: Record<string, string> = {
      organization: payer.organization,
      state: payer.state,
      payerName: payer.payerName,
      payerId: payer.payerId,
      url: payer.url,
      error: payer.error || ''
    };

    // Set Y for each tab the payer has
    tabColumns.forEach(tab => {
      row[tab] = payer.searchTabs.includes(tab) ? 'Y' : '';
    });

    worksheet.addRow(row);
  });

  await workbook.xlsx.writeFile(outputPath);
}

async function main() {
  let browser: Browser | null = null;

  // File paths
  const inputPath = path.join(__dirname, '../Extracts/availity_payers_2025-11-25T02-22-06.xlsx');
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const outputPath = path.join(__dirname, `../Extracts/payer_search_tabs_${timestamp}.xlsx`);

  try {
    // Load input data
    const allPayers = await loadInputData(inputPath);

    // Load any previous progress
    const processed = await loadProgress(outputPath);

    // Filter to unprocessed payers
    const pendingPayers = allPayers.filter(p => !processed.has(`${p.state}|${p.payerName}`));
    console.log(`\nPayers to process: ${pendingPayers.length}/${allPayers.length}`);

    if (pendingPayers.length === 0) {
      console.log('All payers already processed!');
      return;
    }

    // Get credentials
    await promptCredentials();

    // Launch browser
    console.log('\nLaunching browser...');
    browser = await chromium.launch({
      headless: false,
      slowMo: 50
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Initial login
    await login(page, storedUsername, storedPassword);
    await handle2FA(page);
    await skipUpdateAndAcceptCookies(page);

    // Track all discovered tab types for dynamic columns
    const allTabTypes = new Set<string>();

    // Results array (load existing if resuming)
    const results: PayerWithTabs[] = [];

    // Load existing results if any
    try {
      const existingWorkbook = new ExcelJS.Workbook();
      await existingWorkbook.xlsx.readFile(outputPath);
      const existingSheet = existingWorkbook.getWorksheet('Payer Search Tabs');
      if (existingSheet) {
        // Get existing tab columns from headers
        const headerRow = existingSheet.getRow(1);
        const headers: string[] = [];
        headerRow.eachCell((cell) => {
          headers.push(cell.value?.toString() || '');
        });

        // Find tab columns (after URL, before Error)
        const urlIndex = headers.indexOf('URL');
        const errorIndex = headers.indexOf('Error');
        const tabHeaders = headers.slice(urlIndex + 1, errorIndex);
        tabHeaders.forEach(tab => allTabTypes.add(tab));

        existingSheet.eachRow((row, rowNumber) => {
          if (rowNumber > 1) {
            const tabs: string[] = [];
            tabHeaders.forEach((tab, i) => {
              const cellIndex = urlIndex + 2 + i; // +1 for 1-based, +1 for after URL
              if (row.getCell(cellIndex).value === 'Y') {
                tabs.push(tab);
              }
            });

            results.push({
              organization: row.getCell(1).value?.toString() || '',
              state: row.getCell(2).value?.toString() || '',
              payerName: row.getCell(3).value?.toString() || '',
              payerId: row.getCell(4).value?.toString() || '',
              url: row.getCell(5).value?.toString() || '',
              searchTabs: tabs,
              error: row.getCell(errorIndex + 1).value?.toString() || ''
            });
          }
        });
        console.log(`Loaded ${results.length} existing results`);
      }
    } catch {
      // No existing file, start fresh
    }

    // Process each pending payer
    let saveCounter = 0;
    const SAVE_INTERVAL = 10; // Save every 10 payers

    for (let i = 0; i < pendingPayers.length; i++) {
      const payer = pendingPayers[i];
      console.log(`\n[${i + 1}/${pendingPayers.length}] ${payer.state} - ${payer.payerName}`);

      try {
        const result = await processPayerWithRetry(page, payer);

        // Track discovered tabs
        result.searchTabs.forEach(tab => allTabTypes.add(tab));

        results.push(result);

        if (result.error) {
          console.log(`  ✗ Error: ${result.error}`);
        } else {
          console.log(`  ✓ Tabs: ${result.searchTabs.join(', ') || 'none found'}`);
        }

        saveCounter++;

      } catch (error: any) {
        if (error.message === 'SESSION_TIMEOUT') {
          console.log('\n⚠️ Session timeout detected');

          // Save current progress
          console.log('💾 Saving progress...');
          await saveResults(results, outputPath, allTabTypes);
          console.log(`✓ Progress saved: ${results.length} records`);

          // Attempt re-authentication
          const reauthed = await reAuthenticate(page);
          if (!reauthed) {
            console.log('❌ Could not re-authenticate. Please restart the script to resume.');
            return;
          }

          // Retry this payer
          i--; // Will be incremented by loop, so stays on same payer
          continue;
        }

        // Unexpected error
        console.error(`  ✗ Unexpected error: ${error.message}`);
        results.push({
          ...payer,
          searchTabs: [],
          error: error.message
        });
      }

      // Periodic save
      if (saveCounter >= SAVE_INTERVAL) {
        await saveResults(results, outputPath, allTabTypes);
        console.log(`\n💾 Progress saved: ${results.length} records`);
        saveCounter = 0;
      }
    }

    // Final save
    await saveResults(results, outputPath, allTabTypes);

    // Summary
    const errorCount = results.filter(r => r.error).length;
    console.log(`\n✓ Processing complete!`);
    console.log(`✓ Output file: ${outputPath}`);
    console.log(`✓ Total records: ${results.length}`);
    console.log(`✓ Tab types found: ${Array.from(allTabTypes).join(', ')}`);
    if (errorCount > 0) {
      console.log(`⚠ Records with errors: ${errorCount}`);
    }

  } catch (error) {
    console.error('\n✗ Error occurred:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the script
main().catch(console.error);
