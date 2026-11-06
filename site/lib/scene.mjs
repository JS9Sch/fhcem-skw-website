// Hero illustration: Wah Po Commercial Centre seen from across Shau Kei Wan Road
// (looking south-west). Drawn by hand from private reference photos; it is a
// simplified picture, not a photo. The tram (to Shau Kei Wan) travels right to
// left, stops at Nam Hong Street for about two seconds and leaves (see site.css).
const bays = [[6, 198], [212, 330], [344, 492]];
const mullions = (y1, y2, color) => `<path d="${bays.map(([a, b]) => {
  let d = `M${a} ${y1 + 12}H${b}`;
  for (let x = a + 16; x < b - 4; x += 16) d += `M${x} ${y1}V${y2}`;
  return d;
}).join('')}" stroke="${color}" stroke-width="1"/>`;
const windowRow = (y1, y2) => `<g fill="#39322C">${bays.map(([a, b]) => `<rect x="${a}" y="${y1}" width="${b - a}" height="${y2 - y1}"/>`).join('')}</g>${mullions(y1, y2, '#6A6058')}`;
const ac = (x, y) => `<rect x="${x}" y="${y}" width="17" height="10" fill="#E9E7E2" stroke="#8E8B85" stroke-width="1"/>`;
const split = (x, y) => `<rect x="${x}" y="${y}" width="22" height="15" fill="#E9E7E2" stroke="#8E8B85" stroke-width="1"/><circle cx="${x + 13}" cy="${y + 7.5}" r="5" fill="none" stroke="#8E8B85" stroke-width="1"/>`;
const bayWindows = x0 => [0, 1, 2].map(i => [0, 1, 2].map(r => `<rect x="${x0 + i * 62}" y="${4 + r * 44}" width="40" height="30" fill="#BBC2C3" stroke="#A3998C" stroke-width="5"/>`).join('')).join('');

export const scene = `<figure class="scene" aria-labelledby="scene-c">
<svg viewBox="0 0 640 430" role="img" aria-labelledby="scene-t"><title id="scene-t">插圖：從筲箕灣道對面望向華寶商業中心。地下是香港賽馬會，大廈入口在賽馬會左邊，門上寫「華寶商業中心」；賽馬會樓上第二層整排窗都是本堂，右邊窗上有紅字「信望愛福音會　筲箕灣堂」；門前有電車站「南康街」，往筲箕灣的電車由右至左駛過。</title>
<g class="towers">
  <rect x="34" y="-10" width="222" height="150" fill="#D9D6CF"/><rect x="262" y="-10" width="214" height="150" fill="#D9D6CF"/>
  <path d="M256 -10V140" stroke="#B9B6AF" stroke-width="6"/>
  ${bayWindows(56)}${bayWindows(282)}
  <rect x="500" y="40" width="150" height="360" fill="#E3D6CF"/>
  <g fill="#C9CFD0" stroke="#B9AEA7" stroke-width="2">${[60, 118, 176, 234, 292].map(y => `<rect x="514" y="${y}" width="50" height="30"/><rect x="578" y="${y}" width="50" height="30"/>`).join('')}</g>
</g>
<path d="M0 91H640M0 96H640" stroke="#1A1918" stroke-width="1.1"/>
<g class="podium">
  <rect x="-2" y="132" width="502" height="168" fill="#C9C6BF"/>
  <path d="M-2 132H500" stroke="#A9A59C" stroke-width="2"/>
  <path d="M40 200V300M150 205V300M262 200V292M300 226V300M410 204V300M470 210V300" stroke="#B4B0A7" stroke-width="2" opacity=".7"/>
  ${windowRow(164, 200)}
  <g class="lit">
    <g fill="#F2CF8A">${bays.map(([a, b]) => `<rect x="${a}" y="164" width="${b - a}" height="36"/>`).join('')}</g>
    ${mullions(164, 200, '#B89458')}
    <rect x="372" y="168" width="118" height="31" fill="#F7F4EC"/>
    <path d="M379 171h4v6h6v4h-6v14h-4v-14h-6v-4h6z" fill="#AE1820"/>
    <text x="393" y="188" class="sc-sign">信望愛福音會</text>
    <text x="456" y="197.5" text-anchor="middle" class="sc-sign-s">筲箕灣堂</text>
  </g>
  ${ac(26, 160)}${ac(118, 160)}${ac(228, 160)}${ac(300, 160)}${ac(352, 160)}
  ${windowRow(226, 262)}
  ${ac(54, 222)}${ac(170, 222)}${ac(236, 222)}${ac(388, 222)}${ac(448, 222)}
  ${split(276, 272)}${split(120, 268)}${split(22, 276)}
  <rect x="352" y="137" width="52" height="22" rx="11" fill="#AE1820"/><text x="378" y="153" text-anchor="middle" class="sc-tag">2 樓</text>
  <rect x="-2" y="300" width="502" height="6" fill="#F1F0EC"/>
  <rect x="-2" y="306" width="66" height="22" fill="#4A3F30"/><text x="31" y="321" text-anchor="middle" class="sc-wp">華寶商業中心</text>
  <rect x="64" y="306" width="436" height="22" fill="#22335F"/>
  <path d="M64 310H500M64 314H500M64 318H500M64 322H500M64 326H500" stroke="#3E5C9C" stroke-width="1.4"/>
  <rect x="132" y="306" width="128" height="22" fill="#1B2A4F"/>
  <text x="196" y="322" text-anchor="middle" class="sc-jc">香港賽馬會</text>
  <rect x="-2" y="328" width="502" height="44" fill="#CFD8D6"/>
  <path d="M64 328V372M104 328V372M144 328V372M184 328V372M224 328V372M264 328V372M304 328V372M344 328V372M384 328V372M424 328V372M464 328V372" stroke="#1A1918" stroke-width="1.2"/>
  <rect x="12" y="334" width="40" height="38" fill="#2B2723"/><path d="M32 334V372" stroke="#6A6058" stroke-width="1"/>
</g>
<rect x="0" y="372" width="640" height="10" fill="#B58174"/>
<rect x="0" y="382" width="640" height="48" fill="#3E3D3A"/>
<path d="M0 395H640M0 400H640M0 414H640M0 419H640" stroke="#8E8B85" stroke-width="1.6"/>
<g class="entry-tag"><path d="M32 376l6 8h-12z" fill="#AE1820"/><rect x="6" y="383" width="52" height="22" rx="11" fill="#AE1820"/><text x="32" y="399" text-anchor="middle" class="sc-tag">入口</text></g>
<g class="stop-pole"><rect x="596" y="262" width="5" height="152" fill="#1A1918"/><rect x="572" y="226" width="54" height="40" rx="3" fill="#1D4A37"/><text x="599" y="242" text-anchor="middle" class="sc-stop1">電車站</text><text x="599" y="259" text-anchor="middle" class="sc-stop2">南康街</text></g>
<g class="tram-move"><g transform="translate(330 256) scale(.78)">
  <line x1="212" y1="2" x2="330" y2="-212" stroke="#1A1918" stroke-width="4.5" stroke-linecap="round"/>
  <rect x="8" y="-4" width="284" height="12" rx="6" fill="#163A2B"/>
  <rect x="0" y="4" width="300" height="88" rx="16" fill="#1D4A37"/>
  <rect x="0" y="86" width="300" height="18" fill="#EFE3C2"/>
  <rect x="0" y="102" width="300" height="86" rx="6" fill="#1D4A37"/>
  <g fill="#DCE6E9" stroke="#0F2C20" stroke-width="2.4">
    <rect x="10" y="40" width="54" height="40" rx="5"/><rect x="74" y="40" width="40" height="40" rx="5"/><rect x="122" y="40" width="40" height="40" rx="5"/><rect x="170" y="40" width="40" height="40" rx="5"/><rect x="218" y="40" width="40" height="40" rx="5"/><rect x="266" y="40" width="26" height="40" rx="5"/>
    <rect x="74" y="114" width="40" height="44" rx="5"/><rect x="122" y="114" width="40" height="44" rx="5"/><rect x="170" y="114" width="40" height="44" rx="5"/><rect x="218" y="114" width="40" height="44" rx="5"/><rect x="266" y="114" width="26" height="44" rx="5"/>
  </g>
  <rect x="10" y="110" width="52" height="74" rx="3" fill="#163A2B" stroke="#0F2C20" stroke-width="2.4"/><path d="M36 110v74" stroke="#0F2C20" stroke-width="2.4"/>
  <rect x="10" y="12" width="112" height="24" rx="3" fill="#fff" stroke="#1A1918" stroke-width="2"/>
  <text x="66" y="31" text-anchor="middle" class="sc-dest">筲箕灣</text>
  <rect x="0" y="166" width="300" height="9" fill="#EFE3C2"/>
  <circle cx="60" cy="196" r="11" fill="#1A1918"/><circle cx="104" cy="196" r="11" fill="#1A1918"/><circle cx="200" cy="196" r="11" fill="#1A1918"/><circle cx="244" cy="196" r="11" fill="#1A1918"/>
</g></g>
</svg>
<figcaption id="scene-c">入口在賽馬會左邊；樓上第二層整排亮燈的窗就是本堂。</figcaption>
</figure>`;
