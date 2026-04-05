#!/usr/bin/env npx tsx
/**
 * X Integration - Search Posts
 * Scrapes recent posts from X search results and bookmarks.
 * Usage: echo '{"queries":["Claude Code","Gemini CLI"],"hours":24,"maxPerQuery":10,"includeBookmarks":true}' | npx tsx search.ts
 */

import { getBrowserContext, runScript, ScriptResult, config } from '../lib/browser.js';

interface SearchInput {
  queries?: string[];       // Search terms
  hours?: number;           // How far back to look (default: 24)
  maxPerQuery?: number;     // Max posts per query (default: 10)
  includeBookmarks?: boolean; // Whether to scrape bookmarks (default: true)
}

interface Post {
  author: string;
  handle: string;
  text: string;
  time: string;
  url: string;
  likes: string;
  reposts: string;
}

async function extractPosts(page: import('playwright').Page, maxPosts: number): Promise<Post[]> {
  await page.waitForTimeout(3000);

  // Scroll a bit to load more posts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(800);
  }

  const posts = await page.evaluate((max) => {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, max);
    return articles.map((el) => {
      const authorEl = el.querySelector('[data-testid="User-Name"]');
      const authorName = authorEl?.querySelector('span')?.textContent?.trim() || '';
      const handleEl = authorEl?.querySelectorAll('span')[3] || authorEl?.querySelectorAll('span')[1];
      const handle = handleEl?.textContent?.trim() || '';

      const textEl = el.querySelector('[data-testid="tweetText"]');
      const text = textEl?.textContent?.trim() || '';

      const timeEl = el.querySelector('time');
      const time = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

      const linkEl = el.querySelector('a[href*="/status/"]');
      const url = linkEl ? `https://x.com${linkEl.getAttribute('href')}` : '';

      const statsEls = el.querySelectorAll('[data-testid$="-count"]') as NodeListOf<Element>;
      let likes = '0', reposts = '0';
      statsEls.forEach((s) => {
        const testid = s.getAttribute('data-testid') || '';
        const val = s.textContent?.trim() || '0';
        if (testid.includes('like')) likes = val;
        if (testid.includes('retweet')) reposts = val;
      });

      return { authorName, handle, text, time, url, likes, reposts };
    });
  }, maxPosts);

  return posts
    .filter(p => p.text.length > 0)
    .map(p => ({
      author: p.authorName,
      handle: p.handle,
      text: p.text,
      time: p.time,
      url: p.url,
      likes: p.likes,
      reposts: p.reposts,
    }));
}

async function extractBookmarks(page: import('playwright').Page, hours: number): Promise<Post[]> {
  await page.goto('https://x.com/i/bookmarks', {
    timeout: config.timeouts.navigation,
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3000);

  // Scroll more for bookmarks to load enough
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(700);
  }

  const posts = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    return articles.map((el) => {
      const authorEl = el.querySelector('[data-testid="User-Name"]');
      const authorName = authorEl?.querySelector('span')?.textContent?.trim() || '';
      const handleEl = authorEl?.querySelectorAll('span')[3] || authorEl?.querySelectorAll('span')[1];
      const handle = handleEl?.textContent?.trim() || '';

      const textEl = el.querySelector('[data-testid="tweetText"]');
      const text = textEl?.textContent?.trim() || '';

      const timeEl = el.querySelector('time');
      const time = timeEl?.getAttribute('datetime') || '';

      const linkEl = el.querySelector('a[href*="/status/"]');
      const url = linkEl ? `https://x.com${linkEl.getAttribute('href')}` : '';

      const statsEls = el.querySelectorAll('[data-testid$="-count"]') as NodeListOf<Element>;
      let likes = '0', reposts = '0';
      statsEls.forEach((s) => {
        const testid = s.getAttribute('data-testid') || '';
        const val = s.textContent?.trim() || '0';
        if (testid.includes('like')) likes = val;
        if (testid.includes('retweet')) reposts = val;
      });

      return { authorName, handle, text, time, url, likes, reposts };
    });
  });

  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return posts
    .filter(p => {
      if (!p.text) return false;
      if (!p.time) return true; // include if no timestamp
      const t = new Date(p.time);
      return isNaN(t.getTime()) || t >= cutoff;
    })
    .map(p => ({
      author: p.authorName,
      handle: p.handle,
      text: p.text,
      time: p.time,
      url: p.url,
      likes: p.likes,
      reposts: p.reposts,
    }));
}

async function searchX(input: SearchInput): Promise<ScriptResult> {
  const {
    queries = [],
    hours = 24,
    maxPerQuery = 10,
    includeBookmarks = true,
  } = input;

  let context = null;
  const allPosts: { source: string; posts: Post[] }[] = [];

  try {
    context = await getBrowserContext();
    const page = context.pages()[0] || await context.newPage();

    // Check login
    await page.goto('https://x.com/home', { timeout: config.timeouts.navigation, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(config.timeouts.pageLoad);

    const isLoggedIn = await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').isVisible().catch(() => false);
    if (!isLoggedIn) {
      return { success: false, message: 'X login expired. Run the X integration setup to re-authenticate.' };
    }

    // Bookmarks
    if (includeBookmarks) {
      try {
        const bookmarks = await extractBookmarks(page, hours);
        if (bookmarks.length > 0) {
          allPosts.push({ source: 'bookmarks', posts: bookmarks });
        }
      } catch (err) {
        console.error(`Bookmarks failed: ${err}`);
      }
    }

    // Search queries
    for (const query of queries) {
      try {
        const encoded = encodeURIComponent(`${query} since:${getSinceDate(hours)}`);
        await page.goto(`https://x.com/search?q=${encoded}&src=typed_query&f=live`, {
          timeout: config.timeouts.navigation,
          waitUntil: 'domcontentloaded',
        });

        const posts = await extractPosts(page, maxPerQuery);
        if (posts.length > 0) {
          allPosts.push({ source: `search: ${query}`, posts });
        }
      } catch (err) {
        console.error(`Search failed for "${query}": ${err}`);
      }
    }

    return {
      success: true,
      message: `Found posts from ${allPosts.length} sources`,
      data: allPosts,
    };

  } finally {
    if (context) await context.close();
  }
}

function getSinceDate(hours: number): string {
  const d = new Date(Date.now() - hours * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

runScript<SearchInput>(searchX);
