import { chromium, Browser, BrowserContext, Page } from 'playwright';
import ExcelJS from 'exceljs';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';

const SESSION_FILE = path.join(os.homedir(), '.availity-session.json');
const PAYERS_JSON = path.join(__dirname, '../../worker/payers.json');
const XLSX_PATH = path.join(__dirname, '../../availity_payers.xlsx');

const NAV_ROOT = 'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/';
const CLAIM_STATUS_URL = 'https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpost%2Fcs%2Fenhanced-claim-status-ui%2F%23%2Fdashboard';

async function loadSession(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: SESSION_FILE, viewport: { width: 1280, height: 720 } });
}

async function selectState(page: Page, state: string) {
  const trigger = page.locator('.UserRegionsMenu__trigger');
  await trigger.click();
  await page.waitForTimeout(800);
  await page.waitForSelector('li.UserRegionsMenu__option', { timeout: 5000 });
  const btn = page.locator(`li.UserRegionsMenu__option button:has-text("${state}")`).first();
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  await page.goto(CLAIM_STATUS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function getPayerId(page: Page, payerName: string): Promise<string> {
  await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(500);
  await page.goto(CLAIM_STATUS_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const frame = page.frameLocator('iframe[name="newBody"]');
  const control = frame.locator('#payerSelect .payer-select__control');
  await control.waitFor({ state: 'visible', timeout: 30000 });

  const urlBefore = page.url();
  await control.click();
  await page.waitForTimeout(300);

  await frame.locator('#payerSelect [class*="payer-select__option"]')
    .filter({ hasText: payerName }).first().click({ timeout: 5000 });

  await page.waitForURL((url: URL) => url.toString() !== urlBefore, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);

  const match = page.url().match(/payerId[=%]3D([^&]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function main() {
  const payersJson = JSON.parse(await fs.readFile(PAYERS_JSON, 'utf8')) as Record<string, {payerName: string; payerId: string}[]>;

  // Build: payerName -> all states it appears in
  const payerStates: Record<string, string[]> = {};
  for (const [state, payers] of Object.entries(payersJson)) {
    for (const { payerName } of payers) {
      if (!payerStates[payerName]) payerStates[payerName] = [];
      payerStates[payerName].push(state);
    }
  }

  const FAILED = new Set(['California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida']);

  // Find all unique empty-ID payer names
  const emptyNames = new Set<string>();
  for (const [, payers] of Object.entries(payersJson)) {
    for (const { payerName, payerId } of payers) {
      if (!payerId) emptyNames.add(payerName);
    }
  }

  // For each, pick representative state (prefer non-failed)
  const stateToFetch: Record<string, string[]> = {};
  for (const name of emptyNames) {
    const nonFailed = payerStates[name].filter(s => !FAILED.has(s));
    const repState = nonFailed.length > 0 ? nonFailed[0] : payerStates[name][0];
    if (!stateToFetch[repState]) stateToFetch[repState] = [];
    stateToFetch[repState].push(name);
  }

  console.log(`\nFetching IDs for ${emptyNames.size} payers across ${Object.keys(stateToFetch).length} states`);
  for (const [state, names] of Object.entries(stateToFetch)) {
    console.log(`  ${state}: ${names.length} payer(s)`);
  }

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let context = await loadSession(browser);
  let page = await context.newPage();

  await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 60000 });
  if (page.url().includes('login') || page.url().includes('logout')) {
    console.error('Session expired -- run npm run save-session first');
    await browser.close();
    process.exit(1);
  }

  const recovered: Record<string, string> = {};
  let statesProcessed = 0;

  for (const [state, payerNames] of Object.entries(stateToFetch)) {
    // Restart browser every 5 states
    if (statesProcessed > 0 && statesProcessed % 5 === 0) {
      console.log('\n♻️  Restarting browser...');
      await context.storageState({ path: SESSION_FILE });
      await page.close();
      await context.close();
      await browser.close();
      const browser2 = await chromium.launch({ headless: true, channel: 'chrome' });
      context = await loadSession(browser2);
      page = await context.newPage();
      await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 60000 });
    }

    console.log(`\n[${state}] ${payerNames.length} payer(s)`);
    try {
      await page.goto(NAV_ROOT, { waitUntil: 'networkidle', timeout: 30000 });
      await selectState(page, state);
    } catch (err: any) {
      console.log(`  ✗ Could not navigate to ${state}: ${err.message.split('\n')[0]}`);
      statesProcessed++;
      continue;
    }

    for (const payerName of payerNames) {
      try {
        const id = await getPayerId(page, payerName);
        recovered[payerName] = id;
        console.log(`  ✓ ${payerName} (${id || 'EMPTY'})`);
      } catch (err: any) {
        console.log(`  ✗ ${payerName}: ${err.message.split('\n')[0]}`);
        recovered[payerName] = '';
      }
    }
    statesProcessed++;
  }

  await browser.close();

  // Patch payers.json
  let patched = 0;
  for (const [state, payers] of Object.entries(payersJson)) {
    for (const payer of payers) {
      if (!payer.payerId && recovered[payer.payerName]) {
        payer.payerId = recovered[payer.payerName];
        patched++;
      }
    }
  }
  console.log(`\nPatched ${patched} rows in payers.json`);
  await fs.writeFile(PAYERS_JSON, JSON.stringify(payersJson, null, 2));

  // Patch xlsx too
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(XLSX_PATH);
  const ws = workbook.getWorksheet('Payers by State');
  let xlsxPatched = 0;
  if (ws) {
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const name = row.getCell(3).value?.toString() || '';
      const id = row.getCell(4).value?.toString() || '';
      if (!id && recovered[name]) {
        row.getCell(4).value = recovered[name];
        xlsxPatched++;
      }
    });
    await workbook.xlsx.writeFile(XLSX_PATH);
    console.log(`Patched ${xlsxPatched} rows in xlsx`);
  }

  const stillEmpty = Object.values(recovered).filter(v => !v).length;
  console.log(`\nDone. Recovered: ${Object.values(recovered).filter(v => v).length}, still empty: ${stillEmpty}`);
}

main().catch(console.error);
