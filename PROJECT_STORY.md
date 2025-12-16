# Building an Automated Healthcare Payer Scraper with Claude

## Project Overview

**Goal:** Build a web scraping automation tool to extract healthcare payer information from the Availity portal across all 50+ US states, navigating complex authentication, dynamic content, and session management.

**Final Result:** A production-ready TypeScript/Playwright script that:
- Automates login with 2FA
- Scrapes 2,100+ payer records across 56 states/territories
- Captures complete URLs for future direct navigation
- Handles session timeouts with automatic resume functionality
- Saves incremental progress after each state

**Tech Stack:** TypeScript, Playwright (browser automation), ExcelJS (data export), Node.js

---

## The Development Journey

### Phase 1: Initial Setup & Requirements (The Ask)

**User's Initial Request:**
> "Build me a new project where a Playwright script logs into the Availity website and scrapes all the values in Payer dropdown for each state and then save the output in Excel along with the payerId parameter in the url."

**Key Elements:**
- Started with a PDF walkthrough provided by the user
- User needed runtime credential prompts (security requirement)
- TypeScript chosen for type safety
- Excel export for easy data manipulation

**First Breakthrough:** Understanding the workflow from the PDF - login, 2FA, state selection, payer scraping.

---

### Phase 2: Authentication Challenges

**Challenge 1: 2FA Code Entry**
- Initial attempt: Script selected "Text" but didn't click "Continue"
- **Solution:** Added explicit button click after selecting 2FA method
- **Learning:** Don't assume UI interactions - verify each step

**Challenge 2: Interactive Prompts in Terminal**
- User couldn't interact with prompts through Claude Code's embedded terminal
- **Solution:** User ran script in separate terminal for proper input handling
- **Learning:** Interactive CLI tools need native terminal environment

---

### Phase 3: Navigation & Page Structure Discovery

**Challenge 3: Finding the Right URL**
- Script initially used wrong URL for Claim Status page
- User provided actual URL: `https://essentials.availity.com/static/web/onb/onboarding-ui-apps/navigation/#/loadApp/?appUrl=%2Fstatic%2Fweb%2Fpost%2Fcs%2Fenhanced-claim-status-ui%2F%23%2Fdashboard`
- **Breakthrough:** User manually navigated and shared the correct URL
- **Learning:** When automation fails, have user manually perform the task and observe

**Challenge 4: Page Refresh on State Change**
- Discovered: Changing state causes page refresh
- Required: Navigate back to Claim Status page after each state change
- **Solution:** Added `selectClaimStatus()` function called after state selection
- **Learning:** User domain knowledge is critical - they explained the "click Claim Status card after state change" behavior

---

### Phase 4: The Iframe Discovery (Critical Breakthrough)

**The Problem:**
```
Error: page.waitForSelector: Timeout 15000ms exceeded.
- waiting for locator('#payerSelect') to be visible
```

The payer dropdown was clearly visible on screen, but Playwright couldn't find it.

**The Investigation:**
- User sent screenshot showing the page WAS on the correct URL
- Dropdown WAS visible
- But selector failed every time

**The Breakthrough:**
After user confirmed element visibility, we investigated page structure:
- The Claim Status app runs inside an **iframe**
- Playwright was searching the main page, not inside the iframe
- **Solution:** Used `frameLocator()` to access iframe content

```typescript
const frameElement = page.frameLocator('iframe[src*="enhanced-claim-status-ui"]');
const payerControl = frameElement.locator('#payerSelect .payer-select__control');
```

**Learning:** Modern SPAs often use iframes. If an element is "visible" but not found, check for iframe boundaries.

---

### Phase 5: Custom Dropdown Components

**Challenge 5: Not Standard HTML Selectors**

User inspected elements and provided actual HTML:
- State dropdown: `<div class="UserRegionsMenu__trigger">Alabama</div>` (not `<select>`)
- Payer dropdown: React Select component with `<input id="payer">` (not native dropdown)

**Solutions:**
1. **State Dropdown:** Click trigger div, find `li.UserRegionsMenu__option button` elements
2. **Payer Dropdown:** Type into input field + press Enter (more reliable than clicking options)

**Learning:** Always inspect actual DOM structure. Modern web apps rarely use native HTML form elements.

---

### Phase 6: Cookie Banner Interference

**The Problem:**
```
<div class="ot-sdk-row">…</div> from <div id="onetrust-consent-sdk">…</div>
subtree intercepts pointer events
```

Some payers couldn't be clicked because cookie consent banner blocked them.

**Solution:**
- Aggressive cookie dismissal at startup
- Dismiss before each payer click
- Force clicks with `{ force: true }` option

**Learning:** Third-party consent tools (OneTrust) can interfere with automation. Dismiss early and often.

---

### Phase 7: URL Capture & Data Accuracy

**Challenge 6: Wrong URLs Being Saved**

Initially all payers showed the same URL. Investigation revealed:
- Script wasn't waiting for URL to actually change after clicking
- Captured URL too quickly (before page navigation completed)

**Solution:**
```typescript
// Save URL before clicking
const urlBeforeClick = page.url();

// Click payer...

// Wait for URL to change
while (currentUrl === urlBeforeClick && attempts < 10) {
  await page.waitForTimeout(500);
  currentUrl = page.url();
  attempts++;
}

// Wait for page stabilization
await page.waitForLoadState('networkidle', { timeout: 10000 });
```

**Learning:** With SPAs, don't assume instant updates. Actively wait for state changes.

---

### Phase 8: Session Management & Resume Functionality

**Challenge 7: Session Timeout Mid-Scrape**

After scraping for extended time:
```
navigated to "https://essentials.availity.com/static/public/onb/onboarding-ui-apps/availity-fr-ui/#/logout"
```

Lost all progress from remaining states.

**Critical Feature Request:**
> "We need to gracefully shut down, save progress, then restart and resume where we left off"

**Solution Implemented:**
1. **Session Detection:** Monitor URL for logout redirect
2. **Graceful Shutdown:** Save progress immediately on timeout
3. **Resume Logic:**
   - Read most recent Excel file on startup
   - Extract completed states
   - Load existing data
   - Continue with remaining states only

```typescript
const completedStates = await getCompletedStates();
const remainingStates = states.filter(s => !completedStates.includes(s));

// Resume message:
// "Found previous run: availity_payers_2025-11-25.xlsx"
// "Already completed: Alabama, Alaska, ..."
// "States to process: 44/56"
```

**Learning:** Long-running scrapes need resilience. Auto-resume from saved state is essential.

---

## Key Prompting Strategies That Worked

### 1. **Provide Context Progressively**
- Started with PDF walkthrough
- Shared actual HTML when selectors failed
- Provided real URLs when navigation failed
- Sent error messages for debugging

### 2. **Manual Verification**
> "I'll manually navigate and send you the URL"
> "Let me inspect the element and send you the HTML"

When automation struggled, user became the "eyes" to identify correct approach.

### 3. **Specific Error Messages**
Shared complete error logs including:
- Call logs from Playwright
- Timeout durations
- Element selectors that failed

This gave Claude exact failure points to address.

### 4. **Incremental Testing Requests**
> "Run and test the results you get after each payer selection"
> "Print the URL to console so I can verify"

Built in validation checkpoints to catch issues early.

### 5. **Domain Knowledge Sharing**
> "The page remembers which state you were on when you logged out"
> "After state change, you need to click the Claim Status card"

User's understanding of the application's behavior was crucial.

---

## Technical Challenges Solved

| Challenge | Solution | Key Technique |
|-----------|----------|---------------|
| Interactive prompts | Run in native terminal | Process separation |
| 2FA automation | Wait for code input, then continue | Async prompt handling |
| Iframe content | Use `frameLocator()` | DOM boundary traversal |
| Custom dropdowns | Inspect actual HTML, use appropriate selectors | DOM inspection |
| React Select | Type + Enter instead of click | Alternative interaction patterns |
| Cookie banners | Aggressive dismissal + force clicks | Overlay handling |
| URL timing | Wait for URL change explicitly | State change detection |
| Session timeout | Detect logout, save & resume | Error recovery + persistence |
| Progress loss | Incremental saves + auto-resume | Data persistence |

---

## Results & Impact

**Quantitative:**
- **2,107 records** scraped successfully
- **56 states/territories** covered
- **Complete URLs** captured for direct navigation
- **Auto-resume** functionality prevents data loss

**Qualitative:**
- Reduced manual data collection from weeks to hours
- Repeatable process for different credentials/organizations
- Foundation for future automation improvements

---

## Lessons Learned

### For Users Working with Claude:

1. **Be Your Own QA:** Test, observe, report what you see
2. **Provide Artifacts:** Screenshots, HTML, URLs, error logs
3. **Explain Domain Logic:** Your knowledge of the application is invaluable
4. **Iterate Quickly:** Small fixes → test → next issue
5. **Trust the Process:** Complex projects take multiple iterations

### For Claude:

1. **Don't Assume:** Web apps have unique implementations
2. **Verify Each Step:** Wait for confirmations, check states
3. **Resilience Matters:** Long-running processes need recovery mechanisms
4. **User Feedback is Gold:** When stuck, ask user to investigate
5. **Iframes Are Sneaky:** Modern SPAs love nested contexts

---

## The Power of Collaboration

This project showcased **human-AI collaboration at its best:**

**Claude's Strengths:**
- Writing boilerplate code quickly
- Implementing patterns (error handling, retry logic)
- Adapting to feedback rapidly
- Building on incremental discoveries

**User's Strengths:**
- Understanding application behavior
- Inspecting actual page structure
- Providing domain context
- Making architectural decisions

**Together:** Built a production tool neither could have created alone efficiently.

---

## Code Highlights

### Iframe Detection
```typescript
const frameElement = page.frameLocator('iframe[src*="enhanced-claim-status-ui"]');
await frameElement.locator('#payerSelect').waitFor({ timeout: 15000 });
```

### URL Change Detection
```typescript
const urlBeforeClick = page.url();
// ... click action ...
while (currentUrl === urlBeforeClick && attempts < 10) {
  await page.waitForTimeout(500);
  currentUrl = page.url();
  attempts++;
}
```

### Auto-Resume Logic
```typescript
const completedStates = await getCompletedStates(); // Read from Excel
const remainingStates = states.filter(s => !completedStates.includes(s));
console.log(`States to process: ${remainingStates.length}/${states.length}`);
```

### Session Timeout Detection
```typescript
async function checkSessionTimeout(page: Page): Promise<boolean> {
  const currentUrl = page.url();
  if (currentUrl.includes('logout') || currentUrl.includes('login')) {
    console.log('\n⚠️  Session timeout detected!');
    await saveToExcel(allPayers); // Save before exit
    return true;
  }
  return false;
}
```

---

## Project Timeline

- **Initial Setup:** 30 minutes (project structure, dependencies)
- **Authentication:** 1 hour (2FA, login flow)
- **Navigation:** 1 hour (finding correct URLs, page structure)
- **Iframe Discovery:** 30 minutes (critical breakthrough)
- **Dropdown Handling:** 1.5 hours (custom selectors, React Select)
- **Data Accuracy:** 1 hour (URL capture, timing issues)
- **Session Management:** 1 hour (timeout detection, resume logic)
- **Testing & Refinement:** 2 hours (cookie banners, edge cases)

**Total Development Time:** ~8 hours across multiple sessions

---

## Conclusion

This project demonstrates that **complex web automation is achievable** through:
- Iterative problem-solving
- Clear communication between human and AI
- Domain expertise + technical implementation
- Resilience through error handling and recovery

The result is a **production-ready tool** that automates a tedious manual process, saving hours of work and providing consistent, accurate data collection.

---

## Phase 9: Search Tabs Collection (December 2025)

### New Requirement

After the initial scrape collected 3,232 payer records with URLs, a new need emerged:
> "We need to collect the available search tabs for each payer. Not every payer has the same options, so we need to know what they are prior to developing claim search automation."

The search tabs (Member, Service Dates, Claim History, HIPAA Standard, etc.) vary by payer and determine what search methods are available.

### Approach: URL-Based Direct Navigation

Instead of re-scraping through state/payer dropdowns, the solution leverages the URLs already captured:
- Read existing extract file with payer URLs
- Navigate directly to each payer's page
- Extract available search tabs
- Output with individual Y/N columns per tab type

### New Script: `collect-search-tabs.ts`

**Key Features:**
1. **Direct URL Navigation** - Uses captured URLs instead of dropdown selection
2. **Dynamic Column Generation** - Creates columns for each unique tab type discovered
3. **Retry Logic** - 3 retries per payer with increasing delays (1s, 3s, 5s)
4. **Session Recovery** - Detects timeout, saves progress, re-authenticates, resumes
5. **Incremental Saves** - Progress saved every 10 payers

**Output Format:**
| Organization | State | Payer Name | Payer ID | URL | Member | Service Dates | Claim History | HIPAA Standard | Error |
|--------------|-------|------------|----------|-----|--------|---------------|---------------|----------------|-------|
| Med-Data INC. | Alabama | AETNA | AETNA | https://... | Y | Y | Y | Y | |

### Code Highlights

#### Retry with Exponential Backoff
```typescript
const RETRY_DELAYS = [1000, 3000, 5000];

async function processPayerWithRetry(page, payer, retryCount = 0) {
  try {
    // Navigate and extract tabs
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms`);
      await page.waitForTimeout(delay);
      return processPayerWithRetry(page, payer, retryCount + 1);
    }
    return { ...payer, searchTabs: [], error: error.message };
  }
}
```

#### Session Recovery
```typescript
if (error.message === 'SESSION_TIMEOUT') {
  await saveResults(results, outputPath, allTabTypes);
  const reauthed = await reAuthenticate(page);
  if (reauthed) {
    i--; // Retry current payer
    continue;
  }
}
```

---

## Files Created

```
availity_scrape/
├── src/
│   ├── index.ts              (627 lines) - Original payer scraper
│   ├── collect-search-tabs.ts (400 lines) - Search tabs collector
│   ├── merge-files.ts        - Excel file merger utility
│   └── merge-to-csv.ts       - CSV conversion utility
├── Extracts/                  - Output directory
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
└── PROJECT_STORY.md          (this file)
```

**NPM Scripts:**
- `npm start` - Run original payer scraper
- `npm run collect-tabs` - Run search tabs collector
- `npm run merge` - Merge Excel files
- `npm run merge-csv` - Merge to CSV

**Key Dependencies:**
- `playwright` - Browser automation
- `exceljs` - Excel file generation
- `prompts` - User input handling
- `typescript` - Type safety

---

*This project was built through collaborative problem-solving between a user with domain knowledge and Claude, an AI assistant, demonstrating the power of human-AI partnership in software development.*
