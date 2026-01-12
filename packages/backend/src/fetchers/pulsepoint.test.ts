/**
 * PulsePoint Fetcher Test
 * 
 * Run with: npx vitest run src/fetchers/pulsepoint.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const SCREENSHOT_DIR = 'C:/Users/Ripley/Situation-Monitor/packages/backend/test-screenshots';

describe('PulsePoint Fetcher', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    // Create screenshot directory
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    
    browser = await chromium.launch({
      headless: true,
    });
    const context = await browser.newContext({
      geolocation: { latitude: 38.9072, longitude: -77.0369 },
      permissions: ['geolocation'],
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
  }, 60000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  async function screenshot(name: string) {
    const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`Screenshot: ${filepath}`);
  }

  async function logPageState() {
    const buttons = await page.$$eval('button', btns => 
      btns.filter(b => b.offsetParent !== null).map(b => b.textContent?.trim().substring(0, 30))
    );
    console.log('Visible buttons:', buttons);
    
    const inputs = await page.$$eval('input', inputs =>
      inputs.filter(i => i.offsetParent !== null).map(i => ({
        type: i.type,
        placeholder: i.placeholder,
        value: i.value
      }))
    );
    console.log('Visible inputs:', JSON.stringify(inputs));
  }

  it('should complete full PulsePoint flow', async () => {
    // Step 1: Load the page
    console.log('\n=== Step 1: Loading PulsePoint ===');
    await page.goto('https://web.pulsepoint.org/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await screenshot('01-loaded');
    await logPageState();
    
    // Step 2: Click Create New Feed
    console.log('\n=== Step 2: Click Create New Feed ===');
    const createBtn = page.locator('button:has-text("Create New Feed")');
    await createBtn.waitFor({ state: 'visible', timeout: 5000 });
    await createBtn.click({ force: true });
    await page.waitForTimeout(2000);
    await screenshot('02-after-create');
    await logPageState();
    
    // Step 3: Find and click "Find Agencies"
    console.log('\n=== Step 3: Find Agencies ===');
    // Log the HTML structure to understand the page
    const agencySection = await page.$eval('body', body => {
      const text = body.innerText;
      const agencyIdx = text.indexOf('Agencies');
      return text.substring(agencyIdx, agencyIdx + 200);
    });
    console.log('Agency section text:', agencySection);
    
    // Look for Find Agencies - it might be a link or button
    const findAgencies = page.locator('text=Find Agencies').first();
    if (await findAgencies.isVisible()) {
      console.log('Clicking Find Agencies...');
      await findAgencies.click({ force: true });
      await page.waitForTimeout(2000);
    }
    await screenshot('03-find-agencies');
    
    // Step 4: Check if a modal opened
    console.log('\n=== Step 4: Check for agency search modal ===');
    const modalVisible = await page.$('[role="dialog"]');
    console.log('Modal visible:', !!modalVisible);
    
    // Get all visible text inputs
    const textInputs = await page.$$('input[type="text"], input:not([type])');
    console.log(`Found ${textInputs.length} text-ish inputs`);
    
    for (let i = 0; i < textInputs.length; i++) {
      const input = textInputs[i];
      const isVisible = await input.isVisible();
      const placeholder = await input.getAttribute('placeholder');
      const ariaLabel = await input.getAttribute('aria-label');
      console.log(`Input ${i}: visible=${isVisible}, placeholder="${placeholder}", aria-label="${ariaLabel}"`);
    }
    
    await screenshot('04-looking-for-input');
    
    // Step 5: Search in the modal
    console.log('\n=== Step 5: Search for DC Fire ===');
    
    // Find the search input by placeholder
    const searchInput = page.locator('input[placeholder*="Search agency"]');
    if (await searchInput.isVisible()) {
      console.log('Found search input, typing...');
      await searchInput.click({ force: true });
      await searchInput.fill('20001'); // Use ZIP code
      await page.waitForTimeout(3000); // Wait for search results
    } else {
      console.log('Search input not found by placeholder');
    }
    
    await screenshot('05-after-search');
    
    // Check if DC Fire and EMS appears
    const pageText = await page.innerText('body');
    console.log('Contains "DC Fire and EMS":', pageText.includes('DC Fire and EMS'));
    console.log('Contains "District of Columbia":', pageText.includes('District of Columbia'));
    
    // Step 5b: Select DC Fire and EMS
    console.log('\n=== Step 5b: Select agency ===');
    const dcAgency = page.locator('text=/DC Fire and EMS|District of Columbia Fire/i').first();
    if (await dcAgency.isVisible().catch(() => false)) {
      console.log('Found DC agency, clicking...');
      await dcAgency.click({ force: true });
      await page.waitForTimeout(1000);
      await screenshot('05c-selected');
    } else {
      console.log('DC agency not visible in results');
      // Try clicking any result
      const anyResult = page.locator('[role="dialog"] >> text=/Fire|EMS/i').first();
      if (await anyResult.isVisible().catch(() => false)) {
        console.log('Found alternative agency, clicking...');
        await anyResult.click({ force: true });
      }
    }
    
    // Step 5c: Click Save in modal
    console.log('\n=== Step 5c: Save in modal ===');
    const modalSaveBtn = page.locator('[role="dialog"] button:has-text("Save")').first();
    if (await modalSaveBtn.isVisible().catch(() => false)) {
      console.log('Clicking Save in modal...');
      await modalSaveBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }
    await screenshot('05d-after-modal-save');
    
    // Step 6: Click Save and View to load incidents
    console.log('\n=== Step 6: Click Save and View ===');
    const saveViewBtn = page.locator('button:has-text("Save and View")');
    const isDisabled = await saveViewBtn.evaluate(el => (el as HTMLButtonElement).disabled);
    console.log('Save and View disabled:', isDisabled);
    
    if (!isDisabled) {
      console.log('Clicking Save and View...');
      await saveViewBtn.click({ force: true });
      await page.waitForTimeout(5000);
      await screenshot('06-after-save-view');
    } else {
      console.log('Save and View is disabled - agency not properly selected');
    }
    
    // Step 7: Log full page state
    console.log('\n=== Step 7: Full page analysis ===');
    
    // Get all clickable elements
    const clickables = await page.$$eval('a, button, [role="button"], [onclick]', els =>
      els.filter(e => e.offsetParent !== null).map(e => ({
        tag: e.tagName,
        text: e.textContent?.trim().substring(0, 50),
        className: e.className
      }))
    );
    console.log('Clickable elements:', JSON.stringify(clickables.slice(0, 20), null, 2));
    
    await screenshot('07-final-state');
    
    // Log page content
    const pageText2 = await page.innerText('body');
    console.log('\nPage text (first 2000 chars):', pageText2.substring(0, 2000));
    
    // Check for incident data
    console.log('\n=== Incident Check ===');
    const hasIncidentData = pageText2.includes('WASHINGTON') || 
                            pageText2.includes('Medical Emergency') ||
                            pageText2.includes('min ago') ||
                            pageText2.includes('Active Incidents');
    console.log('Has incident data:', hasIncidentData);
    
  }, 120000);
});
