# Availity Payer Scraper

A TypeScript/Playwright script that automates scraping payer information from the Availity portal across all US states.

## Features

- 🔐 Secure credential prompts at runtime (no stored passwords)
- 🔑 Automated 2FA handling with text verification
- 🏢 Captures organization name for multi-credential tracking
- 🗺️ Loops through all US states automatically
- 📊 Scrapes payer names and IDs from dropdown menus
- 🔗 Extracts `payerId` parameter from URLs
- 📁 Exports data to Excel format in your Documents folder

## Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn package manager

## Installation

1. Navigate to the project directory:
```bash
cd /Users/mattkelley/git/availity_scrape
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install chromium
```

## Usage

Run the scraper with:

```bash
npm start
```

Or for development mode:

```bash
npm run dev
```

### Workflow

The script will:

1. **Prompt for credentials** - Enter your Availity username and password
2. **Login to Availity** - Automated login process
3. **Handle 2FA** - Select text verification method and prompt for code
4. **Skip updates** - Automatically skip update notifications
5. **Accept cookies** - Handle cookie consent
6. **Extract organization** - Capture the organization name from the Availity portal
7. **Navigate to page** - Access the search interface
8. **Select Claim Status** - Choose "Claim Status" from search type dropdown
9. **Loop through states** - Starting with Alabama, iterate through all states
   - After each state change, the page refreshes
   - Script automatically re-selects "Claim Status" after each refresh
10. **Scrape payers** - For each state, extract all payer information
11. **Extract payer IDs** - Capture the `payerId%3D` parameter from URLs
12. **Export to Excel** - Save results to `~/Documents/availity_payers_[timestamp].xlsx`

### Output Format

The Excel file contains four columns:

| Organization | State | Payer Name | Payer ID |
|--------------|-------|------------|----------|
| ABC Medical Group | Alabama | Example Insurance Co | 12345 |
| ABC Medical Group | Alabama | Another Payer LLC | 67890 |
| ABC Medical Group | Alaska | ... | ... |

**Note:** The organization name is automatically extracted from the Availity portal after login. This allows you to run the script multiple times with different credentials and combine the results while keeping track of which organization each record belongs to.

## Configuration

### Browser Settings

The script runs in **non-headless mode** by default so you can see the automation in action. To change this, edit `src/index.ts`:

```typescript
browser = await chromium.launch({
  headless: true,  // Change to true for headless mode
  slowMo: 100     // Adjust speed (milliseconds between actions)
});
```

### Selectors

If Availity updates their UI, you may need to update the selectors in `src/index.ts`. Key selectors to check:

- Login form: `input[name="userId"]`, `input[name="password"]`
- State dropdown: First `select` or `[role="combobox"]`
- Payer dropdown: Second `select` element (`.nth(1)`)

## Troubleshooting

### "Element not found" errors

- Availity's UI may have changed - check selector strings in the code
- Network may be slow - increase timeout values
- Page may require additional waiting - add `page.waitForTimeout()` calls

### 2FA issues

- Ensure you select "Text" verification during 2FA setup
- Enter the code quickly before it expires
- Check your phone for the verification message

### No payers showing up

- Verify you're on the correct Claim Status page
- Check that state selection is working
- Inspect the page to confirm dropdown structure

### Excel file not created

- Ensure you have write permissions to ~/Documents
- Check console output for error messages
- Verify ExcelJS is properly installed

## Development

### Build the project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

### Project Structure

```
availity_scrape/
├── src/
│   └── index.ts          # Main scraper script
├── dist/                 # Compiled JavaScript (generated)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Security Notes

- Credentials are **never stored** - only prompted at runtime
- Run this script only on trusted networks
- Keep your Availity credentials secure
- The output Excel file may contain sensitive payer information

## License

MIT

## Support

For issues or questions, refer to the PDF documentation: `VQA- PMS Overview - Availity Scrape Script.pdf`
