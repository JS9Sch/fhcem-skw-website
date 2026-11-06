// Bus stops and alighting advice for 「怎樣來」. Checked against Citybus, KMB and
// Transport Department open data (DATA.GOV.HK) on 2026-11-06; see the private
// report docs/bus-alighting-2026-11-06.md in the project notes. 77A is left out
// (no longer in the Citybus API) pending confirmation.
export const STOPS = [
  ['新成街站', '往北角、西灣河方向，西行', '與教會同一邊，步行約 30 米。'],
  ['南康街站', '往柴灣方向，東行', '在馬路對面，步行約 120 米。'],
  ['南安里站', '往柴灣方向，東行', '在馬路對面，步行約 130 米。'],
];

// Eastbound: [where passengers come from, [[stop, routes]...]]. 85 stops at both; we say 南康街.
export const EAST = [
  ['港島北岸（中環、灣仔、銅鑼灣、北角、太古城、鰂魚涌、西灣河）', [['南康街', ['2', '2X', '18X', '85', '85A', '720']], ['南安里', ['8H', '81', '81A', '82', '382', 'N8', 'N8X']]]],
  ['區內短程（西灣河嘉亨灣、筲箕灣廣場、耀東邨一帶）', [['南安里', ['14', '82S', '720X']]]],
  ['香港仔、田灣、海怡半島、數碼港', [['南康街', ['33X']], ['南安里', ['77', '99']]]],
  ['九龍、新界（過海）', [['南康街', ['608']], ['南安里', ['106', '106P', '307D', '606', '613', '613A', '682', '682A', '682B', '682P', '694', '694S', 'B13', 'SP11']]]],
  ['機場、港珠澳大橋香港口岸', [['南康街', ['A12', 'NA12']]]],
];

// Westbound: every route that stops at 新成街.
export const WEST = ['2', '2X', '8H', '14', '18X', '19P', '33X', '77', '81', '81A', '82', '82S', '85', '85A', '99', '102', '102P', '106', '106P', '110', '307D', '382', '606', '608', '608P', '613', '613A', '682', '682A', '682B', '694', '694S', '720', '720A', '770', 'A12', 'B13', 'N8', 'N8X', 'N122', 'NA12'];

export const TERMINUS = ['18X', '33X', '608', '613', '77', '85A', '99'];
export const NIGHT = ['N8', 'N8X', 'N122', 'NA12'];
export const SPECIAL = ['SP11', '682P', '720X', '608P'];
