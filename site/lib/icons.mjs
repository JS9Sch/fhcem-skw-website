// Hand-drawn line icons for the activities page (replace the old stock photos).
const svg = (body, label) => `<svg class="icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${label ? ` data-name="${label}"` : ''}>${body}</svg>`;

export const ICONS = {
  // Worship: the wall cross over the double red rail.
  崇拜: svg('<path d="M32 8v38M21 19h22"/><path class="r" d="M8 52h48M8 58h48"/>'),
  // Learning: open Bible with a ribbon.
  學習: svg('<path d="M32 16c-6-5-15-6-24-4v36c9-2 18-1 24 4 6-5 15-6 24-4V12c-9-2-18-1-24 4z"/><path d="M32 16v36"/><path class="r" d="M40 13v14l3-3 3 3V12"/>'),
  // Prayer: two hands meeting.
  禱告: svg('<path d="M31 54V30c0-6-2-14-5-19-1-2-4-1-4 1l1 13-7 10v10l-6 9"/><path d="M33 54V30c0-6 2-14 5-19 1-2 4-1 4 1l-1 13 7 10v10l6 9"/><path class="r" d="M20 8l-2-4M44 8l2-4M32 6V2"/>'),
  // Fellowship: three people around a table.
  團契: svg('<circle cx="18" cy="20" r="6"/><circle cx="46" cy="20" r="6"/><circle cx="32" cy="14" r="6"/><path d="M8 40c0-7 4-12 10-12s9 3 10 6M56 40c0-7-4-12-10-12s-9 3-10 6M22 34c1-6 5-10 10-10s9 4 10 10"/><path class="r" d="M6 46h52M14 46v12M50 46v12"/>'),
};
