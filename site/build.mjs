// Generates the static public pages into public/. Run: npm run build
// The output is committed so the existing deploy workflow needs no build step;
// `npm test` fails if public/ is out of date with these sources.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import home from './pages/home.mjs';
import { about, faith, history, churchesPage } from './pages/about.mjs';
import { meetingsPage } from './pages/meetings.mjs';
import { activitiesPage } from './pages/activities.mjs';
import { noticesPage, documentPage, covidPage } from './pages/notices.mjs';
import { contactPage } from './pages/contact.mjs';
import { creditsPage, loginPage, attendanceLinkPage, notFoundPage } from './pages/misc.mjs';
import { memberIndex } from './pages/members.mjs';

export const PAGES = {
  'index.html': home,
  'about/index.html': about,
  'about/faith/index.html': faith,
  'about/history/index.html': history,
  'about/churches/index.html': churchesPage,
  'meetings/index.html': meetingsPage,
  'activities/index.html': activitiesPage,
  'notices/index.html': noticesPage,
  'notices/weather/index.html': () => documentPage('weather'),
  'notices/song-copyright/index.html': () => documentPage('song-copyright'),
  'notices/recreation/index.html': () => documentPage('recreation'),
  'notices/weddings-funerals/index.html': () => documentPage('weddings-funerals'),
  'notices/covid-2023/index.html': covidPage,
  'contact/index.html': contactPage,
  'credits/index.html': creditsPage,
  'login/index.html': loginPage,
  'attendance/index.html': attendanceLinkPage,
  '404.html': notFoundPage,
  '../src/member-index.txt': memberIndex,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
export function render() { return Object.fromEntries(Object.entries(PAGES).map(([file, fn]) => [file, fn()])); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = [];
  for (const [file, html] of Object.entries(render())) {
    const out = join(root, file);
    if (check) { let cur = ''; try { cur = readFileSync(out, 'utf8'); } catch {} if (cur !== html) stale.push(file); continue; }
    mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html);
  }
  if (check && stale.length) { console.error('public/ is out of date; run npm run build:', stale.join(', ')); process.exit(1); }
  console.log(check ? 'public/ pages are up to date.' : `Built ${Object.keys(PAGES).length} pages.`);
}
