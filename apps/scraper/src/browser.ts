import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

let browser: Browser | null = null
let sharedContext: BrowserContext | null = null

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    })
  }
  return browser
}

async function getSharedContext(): Promise<BrowserContext> {
  const b = await getBrowser()
  if (!sharedContext) {
    sharedContext = await b.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        'sec-ch-ua': '"Google Chrome";v="124", "Chromium";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    })
    await sharedContext.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
  }
  return sharedContext
}

// Returns a new page inside the shared context — CF clearance cookies are preserved across calls
export async function newPage(): Promise<{ page: Page; context: BrowserContext }> {
  const context = await getSharedContext()
  const page = await context.newPage()
  return { page, context }
}

export async function closeBrowser(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close()
    sharedContext = null
  }
  if (browser) {
    await browser.close()
    browser = null
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
