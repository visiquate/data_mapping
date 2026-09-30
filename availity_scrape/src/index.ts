import { chromium, Browser, BrowserContext, Page } from 'playwright';
import prompts from 'prompts';
import ExcelJS from 'exceljs';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';

const OP_ITEM = 'SP-Availity-1';
const SESSION_FILE = path.join(os.homedir(), '.availity-session.json');

function opGet(field: string): string {
  return execSync(`op item get "${OP_ITEM}" --fields "${field}" --reveal`, { encoding: 'utf8', timeout: 5000 }).trim();
}

function opTotp(): string {
  return execSync(`op item get "${OP_ITEM}" --otp`, { encoding: 'utf8', timeout: 5000 }).trim();
}

interface PayerInfo {
  organization: string;
  state: string;
  payerName: string;
  payerId: string;
  url: string;
}

async function promptCredentials() {
  try {
    const username = opGet('username');
    const password = opGet('password');
    if (username && password) {
      console.log(`Credentials loaded from 1Password (${OP_ITEM})`);
      return { username, password };
    }
  } catch {
    console.log('1Password not available, falling back to prompts');
  }

  const response = await prompts([
    { type: 'text',     name: 'username', message: 'Enter Availity username:', validate: (v: string) => v.length > 0 || 'Required' },
    { type: 'password', name: 'password', message: 'Enter Availity password:', validate: (v: string) => v.length > 0 || 'Required' },
  ]);
  if (!response.username || !response.password) throw new Error('Credentials are required');
  return response;
}

async function prompt2FACode(): Promise<string> {
  try {
    const code = opTotp();
    if (/^\d{6}$/.test(code)) {
      console.log('TOTP retrieved from 1Password');
      return code;
    }
  } catch {
    console.log('1Password TOTP not available, please enter manually');
  }

  const response = await prompts({ type: 'text', name: 'code', message: 'Enter 2FA verification code:', validate: (v: string) => v.length > 0 || 'Required' });
  if (!response.code) throw new Error('2FA code is required');
  return response.code;
}

async function sessionFileAge(): Promise<number | null> {
  try {
    const stat = await fs.stat(SESSION_FILE);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

async function loadSession(browser: Browser): Promise<BrowserContext> {
  const age = await sessionFileAge();
  if (age !== null) {
    const hours = (age / 1000 / 60 / 60).toFixed(1);
    console.log(`Loading saved session (${hours}h old)...`);
    return browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1280, height: 720 } });
  }
  throw new Error('No session file found');
}

async function saveSession(context: BrowserContext) {
  await context.storageState({ path: SESSION_FILE });
  console.log(`Session saved → ${SESSION_FILE}`);
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

  // Go directly to claim status -- the card search always fails anyway
  await navigateToClaimStatus(page);
}

async function dismissCookieBanner(page: Page) {
  // Try to dismiss any cookie banner that might be blocking clicks
  const closeCookieBanner = page.locator('#onetrust-close-btn-container button, .onetrust-close-btn-handler, button:has-text("Close")');
  if (await closeCookieBanner.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeCookieBanner.first().click();
    await page.waitForTimeout(300);
  }
}

const CLAIM_STATUS_SELECT_URL = 'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpost%2Fcs%2Fenhanced-claim-status-ui%2F%23%2Fdashboard';
const NAV_ROOT = 'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/';
const MENU_SELECTORS = [
  '[class*="payer-select__menu"] [class*="option"]',
  '[id*="react-select"][id*="listbox"] [role="option"]',
  '[class*="menu"] [role="option"]',
];

async function getPayerNamesForState(page: Page): Promise<string[]> {
  await dismissCookieBanner(page);
  const frame = page.frameLocator('iframe[name="newBody"]');
  await frame.locator('#payerSelect').waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  await frame.locator('#payerSelect .payer-select__control').first().click();
  await page.waitForTimeout(1000);

  const names: string[] = [];
  for (const selector of MENU_SELECTORS) {
    const opts = frame.locator(selector);
    if (await opts.count() > 0) {
      console.log(`  Found ${await opts.count()} payers`);
      for (const opt of await opts.all()) {
        const text = await opt.textContent();
        if (text?.trim()) names.push(text.trim());
      }
      break;
    }
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return names;
}

async function getPayerIdByName(page: Page, payerName: string): Promise<string> {
  await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.goto(CLAIM_STATUS_SELECT_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const frame = page.frameLocator('iframe[name="newBody"]');
  const control = frame.locator('#payerSelect .payer-select__control');
  await control.waitFor({ state: 'visible', timeout: 30000 });

  const urlBefore = page.url();
  await control.click();
  await page.waitForTimeout(300);

  await frame.locator('#payerSelect [class*="payer-select__option"]')
    .filter({ hasText: payerName }).first().click();

  await page.waitForURL((url: URL) => url.toString() !== urlBefore, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const currentUrl = page.url();
  const match = currentUrl.match(/payerId[=%]3D([^&]*)/);
  return match ? decodeURIComponent(match[1]) : '';
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

const SAVE_SESSION_MODE = process.argv.includes('--save-session');

async function main() {
  let browser: Browser | null = null;

  try {
    console.log('\nLaunching browser...');
    browser = await chromium.launch({ headless: !SAVE_SESSION_MODE, channel: 'chrome' });

    let context: BrowserContext;
    let page: Page;

    if (SAVE_SESSION_MODE) {
      console.log('Save-session mode: opening browser for manual login...');
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
      await page.goto('https://apps.availity.com/public-apps/login', { waitUntil: 'networkidle' });
      console.log('\nPlease log in manually in the browser window.');
      console.log('Waiting for you to reach the Availity dashboard (up to 5 minutes)...\n');
      // Wait for the navigation dashboard URL -- this only appears after successful login
      await page.waitForURL(url => { const s = url.toString(); return s.includes('essentials.availity.com') && s.includes('navigation/#/') && !s.includes('login'); }, { timeout: 300000 });
      await page.waitForLoadState('networkidle');
      await saveSession(context);
      console.log('\nSession saved. You can close the browser now.');
      return;
    }

    const age = await sessionFileAge();
    if (age !== null) {
      context = await loadSession(browser);
      page = await context.newPage();
      console.log('Navigating to Availity...');
      await page.goto('https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/', { waitUntil: 'networkidle', timeout: 60000 });
      if (page.url().includes('logout') || page.url().includes('login')) {
        console.log('Saved session expired -- running full login');
        await context.close();
        context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        page = await context.newPage();
        const { username, password } = await promptCredentials();
        await login(page, username, password);
        await handle2FA(page);
        await saveSession(context);
        await skipUpdateAndAcceptCookies(page);
      }
    } else {
      console.log('No saved session -- running full login');
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
      const { username, password } = await promptCredentials();
      await login(page, username, password);
      await handle2FA(page);
      await saveSession(context);
      await skipUpdateAndAcceptCookies(page);
    }

    // Get organization name
    const organization = await getOrganizationName(page);

    // Navigate to claim status page (needed to get the state list)
    await navigateToClaimStatus(page);

    // Get all states
    const states = await getAllStates(page);
    console.log(`\nTotal states: ${states.length}`);

    // ── Pass 1: collect payer names per state (no URL clicks) ──────────────
    console.log('\n=== Pass 1: Collecting payer names per state ===');
    const statePayerNames = new Map<string, string[]>();
    const BROWSER_RESTART_INTERVAL = 10;

    for (let i = 0; i < states.length; i++) {
      // Restart browser every 10 states to prevent memory exhaustion
      if (i > 0 && i % BROWSER_RESTART_INTERVAL === 0) {
        console.log(`\n♻️  Restarting browser after ${i} states...`);
        await saveSession(context);
        await page.close();
        await context.close();
        await browser!.close();
        browser = await chromium.launch({ headless: true, channel: 'chrome' });
        context = await loadSession(browser);
        page = await context.newPage();
        await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 60000 });
        if (page.url().includes('logout') || page.url().includes('login')) {
          throw new Error('Session expired during browser restart');
        }
        console.log('✓ Browser restarted');
      }

      const state = states[i];
      console.log(`\n[${i + 1}/${states.length}] ${state}`);
      try {
        await selectState(page, state);
        const names = await getPayerNamesForState(page);
        statePayerNames.set(state, names);
      } catch (err: any) {
        console.log(`  ✗ ${err.message.split('\n')[0]}`);
        statePayerNames.set(state, []);
      }
    }

    // Build unique payer → first representative state
    const payerFirstState = new Map<string, string>();
    for (const [state, names] of statePayerNames) {
      for (const name of names) {
        if (!payerFirstState.has(name)) payerFirstState.set(name, state);
      }
    }
    console.log(`\nUnique payers across all states: ${payerFirstState.size}`);

    // Group unique payers by their representative state (minimises state switches)
    const stateUniquePayerList = new Map<string, string[]>();
    for (const [payerName, state] of payerFirstState) {
      if (!stateUniquePayerList.has(state)) stateUniquePayerList.set(state, []);
      stateUniquePayerList.get(state)!.push(payerName);
    }

    // ── Pass 2: fetch payerId for each unique payer ────────────────────────
    console.log('\n=== Pass 2: Fetching payer IDs (one click per unique payer) ===');
    const payerToId = new Map<string, string>();
    let stateGroupsProcessed = 0;

    for (const [repState, payerNames] of stateUniquePayerList) {
      if (stateGroupsProcessed > 0 && stateGroupsProcessed % BROWSER_RESTART_INTERVAL === 0) {
        console.log(`\n♻️  Restarting browser...`);
        await saveSession(context);
        await page.close();
        await context.close();
        await browser!.close();
        browser = await chromium.launch({ headless: true, channel: 'chrome' });
        context = await loadSession(browser);
        page = await context.newPage();
        await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 60000 });
      }

      console.log(`\nNavigating to ${repState} for ${payerNames.length} unique payer(s)...`);
      try {
        await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 30000 });
        await selectState(page, repState);
      } catch (err: any) {
        console.log(`  ✗ Could not navigate to ${repState}: ${err.message.split('\n')[0]}`);
        stateGroupsProcessed++;
        continue;
      }

      for (const payerName of payerNames) {
        try {
          const payerId = await getPayerIdByName(page, payerName);
          payerToId.set(payerName, payerId);
          console.log(`  ✓ ${payerName} (${payerId})`);
        } catch (err: any) {
          console.log(`  ✗ ${payerName}: ${err.message.split('\n')[0]}`);
          payerToId.set(payerName, '');
        }
      }
      stateGroupsProcessed++;
    }

    // Handle WELLCARE exception: RI and VT have WELLCAREMC instead of A6007
    const WELLCARE_EXCEPTION_STATES = ['Rhode Island', 'Vermont'];
    if (statePayerNames.get('Rhode Island')?.includes('WELLCARE')) {
      console.log('\nCapturing WELLCARE exception (Rhode Island)...');
      try {
        await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 30000 });
        await selectState(page, 'Rhode Island');
        const riId = await getPayerIdByName(page, 'WELLCARE');
        const defaultId = payerToId.get('WELLCARE') || '';
        if (riId && riId !== defaultId) {
          console.log(`  WELLCARE RI/VT override: ${riId} (default: ${defaultId})`);
          payerToId.set('WELLCARE__RI_VT_OVERRIDE', riId);
        }
      } catch (err: any) {
        console.log(`  ✗ WELLCARE RI exception: ${err.message.split('\n')[0]}`);
      }
    }

    // ── Pass 3: build full dataset ─────────────────────────────────────────
    console.log('\n=== Pass 3: Building final dataset ===');
    const allPayers: PayerInfo[] = [];
    for (const [state, names] of statePayerNames) {
      for (const name of names) {
        let payerId = payerToId.get(name) || '';
        if (name === 'WELLCARE' && WELLCARE_EXCEPTION_STATES.includes(state)) {
          payerId = payerToId.get('WELLCARE__RI_VT_OVERRIDE') || payerId;
        }
        allPayers.push({ organization, state, payerName: name, payerId, url: '' });
      }
    }

    await saveToExcel(allPayers, true);

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
