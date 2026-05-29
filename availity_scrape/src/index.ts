import { chromium, Browser, Page } from 'playwright';
import prompts from 'prompts';
import ExcelJS from 'exceljs';
import * as path from 'path';
import * as os from 'os';

interface PayerInfo {
  organization: string;
  state: string;
  payerName: string;
  payerId: string;
  url: string;
}

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

  // Wait for login form
  await page.waitForSelector('input[name="userId"]', { timeout: 10000 });

  console.log('Entering credentials...');
  await page.fill('input[name="userId"]', username);
  await page.fill('input[name="password"]', password);

  // Click sign in button
  await page.click('button[type="submit"]');

  // Wait for 2FA page
  await page.waitForLoadState('networkidle');
}

async function handle2FA(page: Page) {
  console.log('Handling 2FA...');

  // Check if we're on the 2FA selection page
  const textMethodButton = page.locator('text=Text').first();
  if (await textMethodButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Selecting Text 2FA method...');
    await textMethodButton.click();
    await page.waitForTimeout(1000);

    // Click Continue/Request Code button after selecting text method
    const continueButton = page.locator('button:has-text("Continue"), button:has-text("Request Code"), button[type="submit"]').first();
    if (await continueButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking Continue to request code...');
      await continueButton.click();
      await page.waitForLoadState('networkidle');
    }
  }

  // Wait for code input field to be visible
  await page.waitForSelector('input[type="text"], input[type="tel"]', { timeout: 5000 });

  // Prompt user for 2FA code
  const code = await prompt2FACode();

  // Enter 2FA code
  console.log('Entering 2FA code...');
  await page.fill('input[type="text"], input[type="tel"]', code);
  await page.click('button:has-text("Continue"), button:has-text("Verify"), button[type="submit"]');

  await page.waitForLoadState('networkidle');
}

async function skipUpdateAndAcceptCookies(page: Page) {
  // Skip update notification if present
  const updateLaterButton = page.locator('button:has-text("Update Now"), button:has-text("Continue")');
  if (await updateLaterButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Skipping update notification...');
    await page.click('button:has-text("Continue")');
    await page.waitForTimeout(1000);
  }

  // Accept/close cookies aggressively
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
      console.log(`Clicking cookie button: ${selector}`);
      await button.click();
      await page.waitForTimeout(1000);
    }
  }

  // Press Escape to close any remaining modals
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('✓ Cookie banners dismissed');
}

async function getOrganizationName(page: Page): Promise<string> {
  console.log('Extracting organization name...');

  // Try multiple possible selectors for organization name
  // Common locations: header, nav, user profile area
  const possibleSelectors = [
    '[data-test-id="organization-name"]',
    '.organization-name',
    '[class*="organization"]',
    'header [class*="org"]',
    '[aria-label*="Organization"]',
    '.user-info .organization',
    '#organization-name'
  ];

  for (const selector of possibleSelectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
      const orgName = await element.textContent();
      if (orgName && orgName.trim()) {
        console.log(`Organization found: ${orgName.trim()}`);
        return orgName.trim();
      }
    }
  }

  // If not found in specific selectors, try to find it in the page content
  console.log('Organization name not found in common locations, checking page text...');

  // Look for organization in the page title or visible text
  const pageTitle = await page.title();
  console.log(`Using page title or manual identification. Page title: ${pageTitle}`);

  // Return a placeholder that prompts for manual entry if needed
  return 'Unknown Organization';
}

async function navigateToClaimStatus(page: Page) {
  console.log('Navigating to Claim Status page...');

  await page.goto('https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpost%2Fcs%2Fenhanced-claim-status-ui%2F%23%2Fdashboard', {
    waitUntil: 'networkidle'
  });

  await page.waitForTimeout(3000);
}

async function getAllStates(page: Page): Promise<string[]> {
  console.log('Getting all states...');

  // Wait for custom state dropdown
  await page.waitForSelector('.UserRegionsMenu__trigger', { timeout: 15000 });

  // Click the state dropdown to open it
  const stateDropdown = page.locator('.UserRegionsMenu__trigger');
  await stateDropdown.click();
  await page.waitForTimeout(1000);

  // Wait for dropdown menu to appear and get all state options
  await page.waitForSelector('li.UserRegionsMenu__option', { timeout: 5000 });

  const stateItems = page.locator('li.UserRegionsMenu__option button');
  const count = await stateItems.count();
  console.log(`Found ${count} states`);

  const states = await stateItems.allTextContents();

  // Close the dropdown by clicking elsewhere or pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Filter out empty values
  const filteredStates = states
    .map(s => s.trim())
    .filter(s => s && s !== 'Select' && s !== '');

  console.log(`Total states found: ${filteredStates.length}`);
  return filteredStates;
}

async function selectClaimStatus(page: Page) {
  console.log('Selecting Claim Status...');

  // Wait a bit for page to load after state change
  await page.waitForTimeout(2000);

  // Look for the Claim Status card/link - try multiple times as page may still be loading
  for (let attempt = 0; attempt < 3; attempt++) {
    const claimStatusLink = page.locator('a[title="Claim Status"][href*="enhanced-claim-status-ui"]');

    if (await claimStatusLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking Claim Status card...');
      await claimStatusLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      console.log('✓ Navigated to Claim Status page');
      return;
    }

    console.log(`Attempt ${attempt + 1}: Claim Status card not visible, waiting...`);
    await page.waitForTimeout(2000);
  }

  console.log('⚠ Could not find Claim Status card - trying direct navigation');
  await navigateToClaimStatus(page);
}

async function selectState(page: Page, state: string) {
  console.log(`Selecting state: ${state}`);

  // Click the state dropdown to open it
  const stateDropdown = page.locator('.UserRegionsMenu__trigger');
  await stateDropdown.click();
  await page.waitForTimeout(1000);

  // Wait for menu to appear
  await page.waitForSelector('li.UserRegionsMenu__option', { timeout: 5000 });

  // Find and click the specific state button
  const stateButton = page.locator(`li.UserRegionsMenu__option button:has-text("${state}")`).first();

  if (await stateButton.isVisible({ timeout: 2000 })) {
    await stateButton.click();
    console.log(`✓ Clicked ${state}`);
  } else {
    throw new Error(`Could not find state: ${state}`);
  }

  // Wait for page to refresh after state change
  console.log('Waiting for page refresh...');
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 60000 }); // Increased timeout

  // After state change, page refreshes - need to select Claim Status again
  await selectClaimStatus(page);
}

async function dismissCookieBanner(page: Page) {
  // Try to dismiss any cookie banner that might be blocking clicks
  const closeCookieBanner = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button:has-text("Close")');
  if (await closeCookieBanner.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeCookieBanner.first().click();
    await page.waitForTimeout(300);
  }
}

async function getPayersForState(page: Page, state: string, organization: string): Promise<PayerInfo[]> {
  console.log(`Getting payers for ${state}...`);

  const payers: PayerInfo[] = [];

  // Dismiss any cookie banner
  await dismissCookieBanner(page);

  // The Claim Status app is loaded in an iframe - find it
  console.log('Looking for iframe...');
  const frameElement = page.frameLocator('iframe[src*="enhanced-claim-status-ui"]');

  // Wait for payer dropdown to be visible in the iframe
  await frameElement.locator('#payerSelect').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);

  // Find and click the React Select control to open the dropdown
  const payerControl = frameElement.locator('#payerSelect .payer-select__control').first();
  await payerControl.click();
  await page.waitForTimeout(1500);

  // Wait for dropdown menu to appear
  // React Select typically creates a menu with options
  const menuSelectors = [
    '[class*="payer-select__menu"] [class*="option"]',
    '[id*="react-select"][id*="listbox"] [role="option"]',
    '[class*="menu"] [role="option"]',
    '[class*="Select__menu"] [class*="option"]'
  ];

  let payerOptionElements: any[] = [];
  for (const selector of menuSelectors) {
    const options = frameElement.locator(selector);
    const count = await options.count();
    if (count > 0) {
      console.log(`Found ${count} payers using selector: ${selector}`);
      payerOptionElements = await options.all();
      break;
    }
  }

  if (payerOptionElements.length === 0) {
    console.log('⚠ No payer options found - dropdown may be empty for this state');
    return payers;
  }

  // Get all payer names first
  const payerNames: string[] = [];
  for (const option of payerOptionElements) {
    const name = await option.textContent();
    if (name && name.trim()) {
      payerNames.push(name.trim());
    }
  }

  // Close the dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Now select each payer individually to get the payerId from URL
  for (const payerName of payerNames) {
    try {
      // Dismiss cookie banner before selecting
      await dismissCookieBanner(page);

      // Save current URL before selecting
      const urlBeforeClick = page.url();

      // Find the payer input field
      const payerInput = frameElement.locator('#payer').first();

      // Clear and type the payer name
      console.log(`  Typing: ${payerName}`);
      await payerInput.click();
      await page.waitForTimeout(300);
      await payerInput.fill(''); // Clear
      await payerInput.fill(payerName);
      await page.waitForTimeout(500);

      // Press Enter to select
      await payerInput.press('Enter');
      await page.waitForTimeout(500);

      // Wait for URL to change or timeout after 5 seconds
      let currentUrl = page.url();
      let attempts = 0;
      while (currentUrl === urlBeforeClick && attempts < 10) {
        await page.waitForTimeout(500);
        currentUrl = page.url();
        attempts++;
      }

      // Additional wait for page to stabilize
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Get final URL and extract payerId
      currentUrl = page.url();
      const payerIdMatch = currentUrl.match(/payerId[=%]3D([^&]*)/);
      const payerId = payerIdMatch ? decodeURIComponent(payerIdMatch[1]) : '';

      payers.push({
        organization,
        state,
        payerName,
        payerId,
        url: currentUrl
      });

      console.log(`  ✓ ${payerName} (${payerId})`);

    } catch (error: any) {
      console.log(`  ✗ Error processing ${payerName}: ${error.message}`);
    }
  }

  return payers;
}

let excelFilePath: string = '';

async function checkSessionTimeout(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  if (currentUrl.includes('logout') || currentUrl.includes('login')) {
    console.log('\n⚠️  Session timeout detected!');
    return true;
  }
  return false;
}

async function getCompletedStates(): Promise<string[]> {
  const documentsPath = path.join(os.homedir(), 'Documents');
  const fs = require('fs').promises;

  try {
    // Find the most recent Excel file
    const files = await fs.readdir(documentsPath);
    const excelFiles = files
      .filter((f: string) => f.startsWith('availity_payers_') && f.endsWith('.xlsx'))
      .sort()
      .reverse();

    if (excelFiles.length === 0) {
      console.log('No previous run found - starting fresh');
      return [];
    }

    const lastFile = path.join(documentsPath, excelFiles[0]);
    console.log(`\nFound previous run: ${excelFiles[0]}`);

    // Read the Excel file
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(lastFile);
    const worksheet = workbook.getWorksheet('Payers by State');

    if (!worksheet) return [];

    // Get unique states from the file
    const completedStates = new Set<string>();
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) { // Skip header
        const state = row.getCell(2).value; // State is column 2
        if (state) completedStates.add(state.toString());
      }
    });

    const states = Array.from(completedStates);
    console.log(`Already completed: ${states.join(', ')}`);
    return states;

  } catch (error) {
    console.log('Could not read previous file - starting fresh');
    return [];
  }
}

async function saveToExcel(data: PayerInfo[], isInitial: boolean = false) {
  const documentsPath = path.join(os.homedir(), 'Documents');

  // Create file path on first save
  if (!excelFilePath || isInitial) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    excelFilePath = path.join(documentsPath, `availity_payers_${timestamp}.xlsx`);
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payers by State');

  // Add headers
  worksheet.columns = [
    { header: 'Organization', key: 'organization', width: 40 },
    { header: 'State', key: 'state', width: 20 },
    { header: 'Payer Name', key: 'payerName', width: 50 },
    { header: 'Payer ID', key: 'payerId', width: 30 },
    { header: 'URL', key: 'url', width: 100 }
  ];

  // Style headers
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' }
  };

  // Add data
  data.forEach(payer => {
    worksheet.addRow(payer);
  });

  await workbook.xlsx.writeFile(excelFilePath);
  console.log(`\n✓ Progress saved: ${data.length} total records`);
}

async function main() {
  let browser: Browser | null = null;

  try {
    // Get credentials
    const { username, password } = await promptCredentials();

    // Launch browser
    console.log('\nLaunching browser...');
    browser = await chromium.launch({
      headless: false,
      slowMo: 100  // Slow down actions to see what's happening
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Login flow
    await login(page, username, password);
    await handle2FA(page);
    await skipUpdateAndAcceptCookies(page);

    // Get organization name
    const organization = await getOrganizationName(page);

    // Navigate to claim status page
    await navigateToClaimStatus(page);

    // Check for previous run and get completed states
    const completedStates = await getCompletedStates();
    const allPayers: PayerInfo[] = [];

    // If resuming, load existing data
    if (completedStates.length > 0) {
      console.log('Resuming from previous run...');
      const lastFile = excelFilePath || path.join(os.homedir(), 'Documents',
        (await require('fs').promises.readdir(path.join(os.homedir(), 'Documents')))
          .filter((f: string) => f.startsWith('availity_payers_') && f.endsWith('.xlsx'))
          .sort()
          .reverse()[0]
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(lastFile);
      const worksheet = workbook.getWorksheet('Payers by State');

      worksheet?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          allPayers.push({
            organization: row.getCell(1).value?.toString() || '',
            state: row.getCell(2).value?.toString() || '',
            payerName: row.getCell(3).value?.toString() || '',
            payerId: row.getCell(4).value?.toString() || '',
            url: row.getCell(5).value?.toString() || ''
          });
        }
      });
      excelFilePath = lastFile;
      console.log(`Loaded ${allPayers.length} existing records`);
    }

    // Get all states
    const states = await getAllStates(page);

    // Filter out completed states
    const remainingStates = states.filter(s => !completedStates.includes(s));
    console.log(`\nStates to process: ${remainingStates.length}/${states.length}`);

    // Process each remaining state
    for (const state of remainingStates) {
      // Check for session timeout
      if (await checkSessionTimeout(page)) {
        console.log('💾 Saving progress before exit...');
        await saveToExcel(allPayers);
        console.log(`\n✓ Progress saved: ${allPayers.length} records`);
        console.log(`✓ File: ${excelFilePath}`);
        console.log('\n⚠️  Session expired - please run the script again to resume');
        return;
      }

      try {
        console.log(`\n=== Processing state: ${state} (${remainingStates.indexOf(state) + 1}/${remainingStates.length}) ===`);
        await selectState(page, state);
        const payers = await getPayersForState(page, state, organization);
        allPayers.push(...payers);

        // Save progress after each state
        await saveToExcel(allPayers, allPayers.length === payers.length);
      } catch (error: any) {
        // Check if it's a timeout error
        if (await checkSessionTimeout(page)) {
          console.log('💾 Saving progress before exit...');
          await saveToExcel(allPayers);
          console.log(`\n✓ Progress saved: ${allPayers.length} records`);
          console.log(`✓ File: ${excelFilePath}`);
          console.log('\n⚠️  Session expired - please run the script again to resume');
          return;
        }

        console.error(`✗ Error processing ${state}: ${error.message}`);
        console.log(`Continuing to next state...`);
        continue;
      }
    }

    // Final summary
    console.log(`\n✓ Scraping completed!`);
    console.log(`✓ Final file: ${excelFilePath}`);
    console.log(`✓ Total records: ${allPayers.length}`);

    console.log('\n✓ Scraping completed successfully!');

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
