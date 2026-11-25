// ASTB "World markets" page: dotted world map with day/night shading, a pin per exchange (green = open),
// and a live card per market with its opening hours in YOUR time zone and a countdown to the open / close.
// Hours are the regular trading sessions; public holidays are NOT included (the page says so).
// The map is drawn from a small built-in outline of the continents, so it works offline.
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ exchanges
  // days: 0 = Sunday ... 6 = Saturday.  sessions are local clock times [open, close] in minutes after midnight.
  const H = (h, m = 0) => h * 60 + m;
  const MON_FRI = [1, 2, 3, 4, 5];
  const EX = [
    { id: 'nyse', name: 'NYSE · Nasdaq', city: 'New York', tz: 'America/New_York', lat: 40.7, lon: -74.0, days: MON_FRI, s: [[H(9, 30), H(16)]], us: true },
    { id: 'tsx', name: 'TSX', city: 'Toronto', tz: 'America/Toronto', lat: 43.65, lon: -79.4, days: MON_FRI, s: [[H(9, 30), H(16)]] },
    { id: 'b3', name: 'B3', city: 'São Paulo', tz: 'America/Sao_Paulo', lat: -23.55, lon: -46.6, days: MON_FRI, s: [[H(10), H(17)]] },
    { id: 'lse', name: 'London Stock Exchange', city: 'London', tz: 'Europe/London', lat: 51.5, lon: -0.1, days: MON_FRI, s: [[H(8), H(16, 30)]] },
    { id: 'euronext', name: 'Euronext', city: 'Paris', tz: 'Europe/Paris', lat: 48.85, lon: 2.35, days: MON_FRI, s: [[H(9), H(17, 30)]] },
    { id: 'xetra', name: 'Deutsche Börse (Xetra)', city: 'Frankfurt', tz: 'Europe/Berlin', lat: 50.1, lon: 8.7, days: MON_FRI, s: [[H(9), H(17, 30)]] },
    { id: 'six', name: 'SIX Swiss Exchange', city: 'Zurich', tz: 'Europe/Zurich', lat: 47.4, lon: 8.55, days: MON_FRI, s: [[H(9), H(17, 20)]] },
    { id: 'tadawul', name: 'Tadawul', city: 'Riyadh', tz: 'Asia/Riyadh', lat: 24.7, lon: 46.7, days: [0, 1, 2, 3, 4], s: [[H(10), H(15)]] },
    { id: 'jse', name: 'JSE', city: 'Johannesburg', tz: 'Africa/Johannesburg', lat: -26.2, lon: 28.05, days: MON_FRI, s: [[H(9), H(17)]] },
    { id: 'dfm', name: 'Dubai Financial Market', city: 'Dubai', tz: 'Asia/Dubai', lat: 25.2, lon: 55.3, days: MON_FRI, s: [[H(10), H(15)]] },
    { id: 'nse', name: 'NSE · BSE', city: 'Mumbai', tz: 'Asia/Kolkata', lat: 19.1, lon: 72.9, days: MON_FRI, s: [[H(9, 15), H(15, 30)]] },
    { id: 'sgx', name: 'Singapore Exchange', city: 'Singapore', tz: 'Asia/Singapore', lat: 1.3, lon: 103.85, days: MON_FRI, s: [[H(9), H(17)]] },
    { id: 'hkex', name: 'HKEX', city: 'Hong Kong', tz: 'Asia/Hong_Kong', lat: 22.3, lon: 114.2, days: MON_FRI, s: [[H(9, 30), H(12)], [H(13), H(16)]] },
    { id: 'sse', name: 'Shanghai Stock Exchange', city: 'Shanghai', tz: 'Asia/Shanghai', lat: 31.2, lon: 121.5, days: MON_FRI, s: [[H(9, 30), H(11, 30)], [H(13), H(15)]] },
    { id: 'krx', name: 'Korea Exchange', city: 'Seoul', tz: 'Asia/Seoul', lat: 37.55, lon: 127.0, days: MON_FRI, s: [[H(9), H(15, 30)]] },
    { id: 'tse', name: 'Tokyo Stock Exchange', city: 'Tokyo', tz: 'Asia/Tokyo', lat: 35.7, lon: 139.7, days: MON_FRI, s: [[H(9), H(11, 30)], [H(12, 30), H(15, 30)]] },
    { id: 'asx', name: 'ASX', city: 'Sydney', tz: 'Australia/Sydney', lat: -33.9, lon: 151.2, days: MON_FRI, s: [[H(10), H(16)]] },
    { id: 'nzx', name: 'NZX', city: 'Wellington', tz: 'Pacific/Auckland', lat: -41.3, lon: 174.8, days: MON_FRI, s: [[H(10), H(16, 45)]] },
  ];

  // ------------------------------------------------------------------ time maths
  const fmtCache = {};
  function localParts(tz, d) {
    let f = fmtCache[tz];
    if (!f) f = fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const o = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday];
    return { wd, sec: (+o.hour % 24) * 3600 + +o.minute * 60 + +o.second };
  }

  // Returns {state: 'open'|'lunch'|'closed', secs: seconds until the next change, nextAt: Date of that change, openedAt, closesAt, frac}
  function status(ex, now) {
    const { wd, sec } = localParts(ex.tz, now);
    const trading = ex.days.includes(wd);
    const at = (secsFromNow) => new Date(now.getTime() + secsFromNow * 1000);
    if (trading) {
      for (let i = 0; i < ex.s.length; i++) {
        const [o, c] = [ex.s[i][0] * 60, ex.s[i][1] * 60];
        if (sec >= o && sec < c) {
          return { state: 'open', secs: c - sec, nextAt: at(c - sec), frac: (sec - o) / (c - o), openAt: at(o - sec), closeAt: at(c - sec), label: 'Closes in' };
        }
        if (sec < o) {
          const lunch = i > 0;
          return { state: lunch ? 'lunch' : 'closed', secs: o - sec, nextAt: at(o - sec), frac: 0, label: lunch ? 'Reopens in' : 'Opens in', openAt: at(o - sec), closeAt: at(ex.s[ex.s.length - 1][1] * 60 - sec) };
        }
      }
    }
    // after the last session today, or not a trading day: find the next trading day's first open
    for (let d = trading ? 1 : 0; d <= 8; d++) {
      const day = (wd + d) % 7;
      if (!ex.days.includes(day)) continue;
      const o = ex.s[0][0] * 60, secs = d * 86400 + o - sec;
      if (secs <= 0) continue;
      return { state: 'closed', secs, nextAt: at(secs), frac: 0, label: 'Opens in', openAt: at(secs), closeAt: at(d * 86400 + ex.s[ex.s.length - 1][1] * 60 - sec) };
    }
    return { state: 'closed', secs: 0, nextAt: now, frac: 0, label: 'Opens in', openAt: now, closeAt: now };
  }

  const pad = (n) => String(n).padStart(2, '0');
  function dur(secs) {
    secs = Math.max(0, Math.floor(secs));
    const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const myTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time'; } catch (e) { return 'your time'; } })();
  const hhmm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayTag = (d, now) => {
    const a = new Date(d), b = new Date(now);
    const diff = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
    return diff === 0 ? '' : diff === 1 ? ' tomorrow' : diff === -1 ? ' yesterday' : ' ' + a.toLocaleDateString([], { weekday: 'short' });
  };
  const localClock = (ex, now) => { try { return now.toLocaleTimeString('en-GB', { timeZone: ex.tz, hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } };
  const sessionText = (ex) => ex.s.map(([o, c]) => `${pad(Math.floor(o / 60))}:${pad(o % 60)}–${pad(Math.floor(c / 60))}:${pad(c % 60)}`).join(' · ');

  // ------------------------------------------------------------------ land outline (lon, lat), coarse on purpose
  const P = (a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
  const LAND = [
    // North America
    P([-168,66,-162,70,-156,71.3,-141,69.6,-128,70,-115,68.5,-108,68,-96,68,-90,69,-82,69.5,-82,66,-87,64,-94,61,-93,58.7,-88,56.5,-82,55,-79,52,-79,55,-77,58,-78,62,-72,61.5,-65,60,-62,57,-56,52,-60,50,-65,49.5,-60,46.5,-64,45,-67,44.5,-70,43,-70,41.7,-74,40.5,-76,37,-76,35,-80,32,-81,30,-80,26,-81,25.2,-83,27,-84,30,-88,30.3,-90,29,-94,29.5,-97,27.5,-97.5,24,-97.8,22,-96,19,-94.5,18.2,-91,18.8,-90.5,21,-87,21.5,-87.5,18,-88.5,16,-84,15.8,-83.3,12,-83.5,10,-81.5,8.8,-79.5,9.5,-77.5,8.5,-78,7.5,-80,7.3,-81.5,8,-83,8.3,-85.7,10,-87.5,13,-91.5,14,-94,16,-96,15.7,-101,17.2,-105.5,20,-105.5,23,-109,26,-112.5,29.5,-114.8,31.8,-117,32.5,-118,33.8,-120.6,34.5,-122.5,37.5,-124,40.3,-124.5,43,-124,46.5,-123,48.5,-125,50,-128,51,-130,54.5,-134,58,-138,59,-145,60.2,-150,59.5,-152,58,-157,56.5,-162,55,-165,54.5,-160,57,-158,58.7,-162,59,-165,61,-166,63,-161,64.5,-168,65.5]),
    P([-80,63,-72,67,-62,66,-65,62,-72,63,-78,62.5]), P([-90,77,-75,79,-62,82,-80,83,-92,81]), P([-120,69,-110,72,-100,72,-102,69.5,-112,68.5]), P([-100,73,-90,76,-82,74,-90,72.5]),
    P([-73,78,-60,82,-30,83.5,-20,80,-18,76,-22,70,-32,68,-40,65,-43,60,-48,61,-53,66,-55,70,-60,76,-68,76.5]),
    P([-85,22,-82,23,-77,21.5,-74.2,20.2,-78,20,-81,21.8,-84,21.7]), P([-74.4,19.8,-70,19.8,-68.4,18.6,-72,18,-74.4,18.4]),
    P([-24,65.5,-22,66.3,-15,66.3,-14,64.5,-19,63.4,-22.5,63.8]),
    P([-5,50,1.5,51,1.7,52.8,-0.5,54.2,-2,55.8,-1.8,57.5,-3,58.6,-5,58.5,-6,56.5,-4.8,55,-3,54.5,-3.2,53.4,-4.5,52.5,-5.2,51.7,-3,51.4]), P([-10,51.7,-6,52,-6,54.2,-8,55.2,-10,54]),
    // South America
    P([-77.5,8.5,-75.5,10.8,-71.5,12.4,-68,10.6,-62,10.7,-60.5,8.5,-57,6,-52,5,-50,1.8,-48,-0.5,-44,-2.5,-39,-3.5,-35,-5.3,-34.8,-8,-37,-12,-39,-15.5,-39.8,-19.5,-41.5,-22.5,-45,-23.8,-48.5,-26,-48.8,-28.5,-51,-31,-53.5,-34,-56,-34.8,-58,-34.5,-57,-37.5,-62,-39,-65,-41,-65,-45,-67.5,-46.5,-66,-48,-69,-50.5,-68.5,-53,-66.5,-55,-71,-54.8,-74,-52,-75.5,-47,-73.8,-42,-73.5,-37,-71.7,-33,-71.5,-28.5,-70.3,-23,-70.2,-18.4,-75.2,-15.3,-78.5,-10,-81.3,-6,-80.5,-3,-80,-1,-81,1,-78.8,1.8,-77.5,4,-77.3,6.5]),
    // Africa + Madagascar
    P([-5.8,35.8,-2,35.2,3,36.8,10.3,37.2,11,35,10.2,33.8,15,32.3,20,32,20,30.8,25,31.8,32,31.2,34.3,31.2,32.5,29.8,34,27.8,36.5,22.5,37.3,18,39.3,15.5,43.2,12.7,44.5,10.5,51.2,11.8,51,10,48,5,44,1.5,41,-2,39.2,-5,39.5,-9,40.5,-11,40.5,-15,37,-18,35,-20,35.5,-24,32.8,-26,32.7,-29,30,-31.5,27,-33.7,22,-34.2,18.5,-34.2,17.8,-31,15,-26.5,14.5,-22,11.8,-17,13.5,-12,13.2,-8.5,12.3,-6,9.5,-1,9.5,3.8,6.5,4.3,4,6.3,1,6,-2,4.8,-4.5,5.2,-7.5,4.4,-11,6.8,-13.2,8.5,-15,11,-16.7,12.5,-17.5,14.7,-16.5,19.5,-16,21.5,-13,27.7,-10,29.3,-9.8,31,-8.5,33.2,-6.8,34.2]),
    P([49.3,-12,50.5,-15.5,49.5,-19,47.5,-24.5,45,-25.5,43.5,-22.5,44.3,-17,46.5,-15.8]),
    // Eurasia (Black Sea and Caspian are cut out below)
    P([-5.5,36.2,-9,37,-9.5,39,-8.8,42,-9.3,43.2,-2,43.5,-1.5,46,-4.5,48.3,-1.5,48.7,1.5,50.3,4,51.5,8.5,53.5,8.5,56.5,10.5,57.7,10.5,55,12,54.2,18,54.8,21,55,21,57,24,57.3,24.5,59.5,30,59.9,28,60.5,23,60,21.5,61.5,21.5,64,25,65.5,22,65.8,17.5,62.5,18.5,60,16.5,57,14.5,55.5,12.5,56,11,59,8,58,5.5,59.5,5,62,10,64,14,67.5,19,70,26,71,31,70,40,67,41,66.5,36,64.5,40,64.5,44,66.5,44,68.5,54,68.5,60,69.5,68,69,66.5,71.5,72,72.8,80.5,73.3,87,75,100,76.5,105,77.5,113,74,124,73.5,131,71.5,140,72.5,150,71.5,160,70,170,70,180,69,180,65,178.5,64.5,177,62.5,171,60,164,59.8,163,57.5,160,54,156.8,51,155.5,57,162,60,156,61.5,154,59.2,143,59.3,137,54,141,53,140,48,135,43.5,131,42.5,129.5,40.8,128,38.5,129.5,36,126.8,34.5,126.5,37.5,125,38.5,124.5,40,121.5,39,122,40.8,118,39,119,37.2,122.5,37,120.2,35.8,121.8,32,121.3,30,122,29.5,120,26,116.5,23,112,21.8,109.5,21.5,108.5,19,106,17,108.8,12.5,105,8.7,104.5,10.4,101,12.5,99.5,10,100.2,6.5,103.5,1.5,102,2.2,100.5,4.5,98.5,8,98.2,13.7,95.5,15.8,94.3,18,92,21,90,22,86.5,20,80.5,15.5,80.2,13,79.8,10.3,77.5,8,76.2,10,73.5,16.5,72.8,20.5,72.8,21.5,70,21,68.5,23.5,66.5,25.4,61.5,25.2,57.3,25.7,56.5,27,53.5,26.7,50.8,28.5,48.5,30,48,29.5,50,26.3,51.5,24.5,54,24,56,26,56.4,24.8,59.8,22.5,57.5,19,55,17,52,16,45,12.8,43.3,13,42.8,16,39.3,21.5,36.7,26,34.9,29.5,34.3,31.2,35,33,36,36.5,32,36.1,28,36.7,26.3,38.5,26.5,40.2,24,40.8,23.5,38,22,36.5,21,38,19.5,40.5,19.5,42,15.5,44.5,13.5,45.5,12.3,45.2,12.5,44,14,42.5,16,41.5,18.5,40.2,16.5,39,16,38,15.6,40,12.5,41.5,10.5,43,8.8,44.3,6.5,43.2,3.2,43.3,3.2,42,0.8,41,-0.5,39.2,0,38.5,-1.8,36.8]),
    // Asian / Pacific islands
    P([130.9,34,132.5,34.3,135,34.7,135.8,33.5,137.2,34.6,139.5,35,140.8,35.7,141.8,38.3,141.5,40.5,140,41,139.8,39.5,139,38,137,37,136,36,133.5,35.5,131.5,34.5]),
    P([140,42,141.5,43.2,145.5,43.3,143.2,42,141.5,42.5]), P([129.8,33,131.8,33.5,131.5,31.4,130.2,31.2]), P([142,46,143.2,49.5,143,53.5,142.5,54,141.8,50]),
    P([120.2,23,121.5,25.2,122,24.5,120.8,22]), P([120.3,16.5,122.2,18.4,122.3,14.2,124,13,121,13.5,120.5,14.5]), P([122,8,125.5,9.8,126.5,7,125.5,5.8,123.5,7.2]),
    P([109,1.5,111,2.5,114.5,4.5,117,7,119,5.2,117.8,1,116,-3.8,113,-3.5,110,-2.8]), P([95.3,5.6,98.5,4,104,-1.5,106,-3.2,105.5,-5.8,102,-4,100,-1,97.5,2.5]),
    P([105.3,-6.5,108.5,-6.5,113,-7.8,114.5,-8.5,110,-8.2,106,-7.2]), P([119.5,0.5,121,1.5,125,1.5,122,-0.8,123,-4,121,-3,120.5,-5.5,119.3,-3.5]),
    P([131,-0.9,134,-0.8,138,-1.8,141,-2.6,146,-5.5,150,-10.5,147,-10.2,144,-7.8,141,-9.2,138,-8.4,137.5,-5,133,-4,132,-2.8]), P([79.8,9.8,81.8,7.5,81,6,80,6.2,79.8,8]),
    // Oceania
    P([113.5,-22,114,-26,115,-34,118,-35,123.5,-34,126,-32.3,131.5,-31.6,134,-32.8,137.8,-33,138,-35.5,140.5,-38,144,-38.5,146.5,-39,150,-37.5,151,-34,153.3,-28.5,153,-25,150.5,-22.5,146.5,-19,145.4,-15,143.5,-14,142.5,-10.7,141.5,-13,141.2,-17,139.5,-17.5,136.8,-15.8,135.5,-14.8,136.8,-12.2,132.5,-11.5,130,-13,128,-15,125,-14.5,122.2,-17,121,-19.5,117,-20.7,114,-22.2]),
    P([144.7,-40.7,148.3,-40.9,148,-43.2,146,-43.6]), P([172.7,-34.4,175.5,-37,178.5,-37.7,177,-39.5,175,-41.5,174.8,-39.5,173.8,-39.2,174.5,-37]), P([172.7,-40.5,174,-41.7,171,-44.5,169,-46.6,166.5,-46,168,-44,171.5,-41.8]),
  ];
  const SEAS = [
    P([28,41.2,28.5,43.5,30,45.5,33,46,35,45,36.8,45.3,38,47,41,45,41.8,42.8,41,41.2,37,41,33,42,30,41.2]),
    P([47,45.5,49,46.8,53,46.8,53,45,51,44,52.5,41.5,53.8,39.5,53.8,37,50.5,37,49,38.5,49.5,40.5,47.5,42.5]),
  ];
  const bbox = (poly) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of poly) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); } return [a, b, c, d]; };
  const LAND_B = LAND.map(bbox), SEAS_B = SEAS.map(bbox);
  function inside(x, y, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const isLand = (x, y) => {
    for (let i = 0; i < SEAS.length; i++) { const b = SEAS_B[i]; if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(x, y, SEAS[i])) return false; }
    for (let i = 0; i < LAND.length; i++) { const b = LAND_B[i]; if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inside(x, y, LAND[i])) return true; }
    return false;
  };

  const LAT_TOP = 84, LAT_BOT = -58, STEP = 1.6;
  let DOTS = null;
  function dots() {
    if (DOTS) return DOTS;
    DOTS = [];
    for (let lat = LAT_TOP - STEP / 2; lat > LAT_BOT; lat -= STEP) {
      const stepLon = STEP / Math.max(0.35, Math.cos(0 * Math.PI / 180));   // equirectangular: constant spacing
      for (let lon = -180 + stepLon / 2; lon < 180; lon += stepLon) if (isLand(lon, lat)) DOTS.push([lon, lat]);
    }
    return DOTS;
  }

  // sun position: sub-solar latitude / longitude for a given instant
  function sunPoint(d) {
    const day = (d.getTime() / 86400000) + 2440587.5 - 2451545.0;          // days since J2000
    const g = (357.529 + 0.98560028 * day) * Math.PI / 180;
    const q = 280.459 + 0.98564736 * day;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180;
    const e = (23.439 - 0.00000036 * day) * Math.PI / 180;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const gmst = (280.46061837 + 360.98564736629 * day) * Math.PI / 180;
    let lon = ra - gmst; lon = ((lon + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return { lat: dec, lon };
  }

  // ------------------------------------------------------------------ view
  let panel, canvas, ctx, pinsEl, listEl, sumEl, tip, sel = null, lastDraw = 0, drawn = null;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function build() {
    const page = $('.page');
    if (!page || $('#world-panel')) return;
    panel = document.createElement('section');
    panel.className = 'panel'; panel.id = 'world-panel'; panel.dataset.v = 'world';
    panel.innerHTML = `
      <div class="wsum" id="w-sum"></div>
      <div class="wmap" id="w-map"><canvas id="w-canvas" aria-label="World map of stock exchanges"></canvas><div id="w-pins"></div><div id="w-tip" class="wtip hidden" role="status"></div></div>
      <div class="wleg"><span><i class="o"></i>Open</span><span><i class="l"></i>Lunch break</span><span><i class="c"></i>Closed</span><span class="wnote">Shaded side of the map is night right now. Times are in <b>${esc(myTz)}</b>. Regular hours only: public holidays are not included.</span></div>
      <div class="wlist" id="w-list"></div>`;
    page.appendChild(panel);
    canvas = $('#w-canvas'); ctx = canvas.getContext('2d'); pinsEl = $('#w-pins'); listEl = $('#w-list'); sumEl = $('#w-sum'); tip = $('#w-tip');
    pinsEl.innerHTML = EX.map((e) => `<button type="button" class="xpin closed" data-id="${e.id}" aria-label="${esc(e.name)}, ${esc(e.city)}"><i></i><b>${esc(e.city)}</b></button>`).join('');
    pinsEl.addEventListener('click', (ev) => { const b = ev.target.closest('.xpin'); if (b) select(b.dataset.id); });
    pinsEl.addEventListener('mouseover', (ev) => { const b = ev.target.closest('.xpin'); if (b) showTip(b.dataset.id); });
    pinsEl.addEventListener('mouseout', () => tip.classList.add('hidden'));
    listEl.addEventListener('click', (ev) => { const c = ev.target.closest('.wc'); if (c) select(c.dataset.id); });
    new ResizeObserver(() => { drawn = null; draw(true); }).observe($('#w-map'));
    tick();
  }

  const X = (lon, w) => ((lon + 180) / 360) * w;
  const Y = (lat, h) => ((LAT_TOP - lat) / (LAT_TOP - LAT_BOT)) * h;

  function draw(force) {
    const wrap = $('#w-map');
    if (!wrap || !wrap.clientWidth) return;
    const now = Date.now();
    if (!force && drawn && now - drawn < 30000) return;
    drawn = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = Math.round(w * (LAT_TOP - LAT_BOT) / 360);
    wrap.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const light = document.documentElement.dataset.theme === 'light';
    const sun = sunPoint(new Date());
    // graticule
    ctx.strokeStyle = light ? 'rgba(20,60,100,.07)' : 'rgba(120,170,220,.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let lon = -150; lon <= 180; lon += 30) { ctx.moveTo(X(lon, w), 0); ctx.lineTo(X(lon, w), h); }
    for (let lat = -30; lat <= 60; lat += 30) { ctx.moveTo(0, Y(lat, h)); ctx.lineTo(w, Y(lat, h)); }
    ctx.stroke();
    const r = Math.max(1.1, w / 360 * STEP * 0.36);
    for (const [lon, lat] of dots()) {
      const phi = lat * Math.PI / 180, dl = (lon * Math.PI / 180) - sun.lon;
      const alt = Math.sin(phi) * Math.sin(sun.lat) + Math.cos(phi) * Math.cos(sun.lat) * Math.cos(dl);       // sine of the sun's height
      const k = Math.max(0, Math.min(1, 0.5 + alt * 3));                                                         // soft dawn / dusk edge
      ctx.fillStyle = light ? `rgba(8,90,120,${(0.16 + 0.5 * k).toFixed(3)})` : `rgba(${Math.round(90 + 60 * k)},${Math.round(150 + 70 * k)},${Math.round(210 + 25 * k)},${(0.16 + 0.6 * k).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(X(lon, w), Y(lat, h), r, 0, 6.2832); ctx.fill();
    }
    // night shade glow behind the terminator
    const sx = X(sun.lon * 180 / Math.PI, w), sy = Y(sun.lat * 180 / Math.PI, h);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.28);
    g.addColorStop(0, light ? 'rgba(255,200,60,.35)' : 'rgba(255,214,102,.30)'); g.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 6.2832); ctx.fill();
    // place pins
    pinsEl.querySelectorAll('.xpin').forEach((b) => {
      const e = EX.find((x) => x.id === b.dataset.id);
      b.style.left = (X(e.lon, w) / w * 100) + '%'; b.style.top = (Y(e.lat, h) / h * 100) + '%';
    });
  }

  function select(id) {
    sel = sel === id ? null : id;
    pinsEl.querySelectorAll('.xpin').forEach((b) => b.classList.toggle('sel', b.dataset.id === sel));
    listEl.querySelectorAll('.wc').forEach((c) => c.classList.toggle('sel', c.dataset.id === sel));
    if (sel) { const c = listEl.querySelector(`.wc[data-id="${sel}"]`); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  function showTip(id) {
    const e = EX.find((x) => x.id === id), st = status(e, new Date());
    const b = pinsEl.querySelector(`.xpin[data-id="${id}"]`);
    tip.innerHTML = `<b>${esc(e.name)}</b><span>${esc(e.city)} · local ${localClock(e, new Date())}</span><span class="${st.state}">${st.state === 'open' ? 'OPEN' : st.state === 'lunch' ? 'LUNCH BREAK' : 'CLOSED'} · ${esc(st.label)} ${dur(st.secs)}</span>`;
    tip.style.left = b.style.left; tip.style.top = b.style.top; tip.classList.remove('hidden');
  }

  const STATE_TXT = { open: 'OPEN', lunch: 'LUNCH BREAK', closed: 'CLOSED' };
  function tick() {
    if (!panel) return;
    const now = new Date();
    const rows = EX.map((e) => ({ e, st: status(e, now) }));
    // pins
    rows.forEach(({ e, st }) => { const b = pinsEl.querySelector(`.xpin[data-id="${e.id}"]`); if (b) b.className = 'xpin ' + st.state + (sel === e.id ? ' sel' : ''); });
    // summary
    const open = rows.filter((r) => r.st.state === 'open');
    const nextOpen = rows.filter((r) => r.st.state !== 'open').sort((a, b) => a.st.secs - b.st.secs)[0];
    const nextClose = open.slice().sort((a, b) => a.st.secs - b.st.secs)[0];
    sumEl.innerHTML = `<div class="wchip"><small>Markets open now</small><b class="up">${open.length}<span> of ${rows.length}</span></b></div>
      <div class="wchip"><small>Next to close</small><b>${nextClose ? esc(nextClose.e.city) + ' · ' + dur(nextClose.st.secs) : '--'}</b></div>
      <div class="wchip"><small>Next to open</small><b>${nextOpen ? esc(nextOpen.e.city) + ' · ' + dur(nextOpen.st.secs) : '--'}</b></div>
      <div class="wchip"><small>Crypto</small><b class="up">24/7<span> always open</span></b></div>`;
    // cards: open first (closing soonest), then lunch, then closed (opening soonest)
    const rank = { open: 0, lunch: 1, closed: 2 };
    rows.sort((a, b) => rank[a.st.state] - rank[b.st.state] || a.st.secs - b.st.secs);
    listEl.innerHTML = rows.map(({ e, st }) => {
      const o = st.openAt;
      const hours = `${sessionText(e)} local`;
      const bar = st.state === 'open' ? `<div class="wbar"><i style="width:${Math.round(st.frac * 100)}%"></i></div>` : '';
      const yours = st.state === 'open' ? `Your time: ${hhmm(st.openAt)} to ${hhmm(st.closeAt)}${dayTag(st.closeAt, now)}`
        : st.state === 'lunch' ? `Reopens ${hhmm(st.nextAt)} your time`
        : `Opens ${hhmm(o)}${dayTag(o, now)} your time`;
      return `<button type="button" class="wc ${st.state}${sel === e.id ? ' sel' : ''}" data-id="${e.id}">
        <div class="wtop"><div><b>${esc(e.name)}</b><span>${esc(e.city)} · local time ${localClock(e, now)}</span></div><em>${STATE_TXT[st.state]}</em></div>
        <div class="wtime"><small>${esc(st.label)}</small><strong>${dur(st.secs)}</strong></div>${bar}
        <div class="wmeta"><span>Hours: ${esc(hours)}</span><span>${esc(yours)}</span></div>
      </button>`;
    }).join('');
    draw(false);
    window.astbWorld.usStatus = rows.find((r) => r.e.us).st;
    if (!tip.classList.contains('hidden')) { const hv = pinsEl.querySelector('.xpin:hover'); if (hv) showTip(hv.dataset.id); }
  }

  // small chip in the top bar: the US market countdown, visible on every page
  function topChip() {
    const chips = $('.topbar .chips');
    if (!chips || $('#chip-us')) return;
    const c = document.createElement('button');
    c.type = 'button'; c.id = 'chip-us'; c.className = 'chip us-chip'; c.title = 'Open the world markets page';
    c.innerHTML = '<span class="dot"></span><span id="chip-us-txt">NYSE</span>';
    c.addEventListener('click', () => { const n = $('.nav-i[data-view="world"]'); if (n) n.click(); });
    chips.appendChild(c);
    const upd = () => {
      const ny = EX[0], st = status(ny, new Date());
      c.className = 'chip us-chip ' + (st.state === 'open' ? 'ok' : '');
      $('#chip-us-txt').textContent = st.state === 'open' ? `NYSE closes in ${dur(st.secs)}` : `NYSE opens in ${dur(st.secs)}`;
    };
    upd(); setInterval(upd, 1000);
  }

  function boot() {
    if (!window.dashboard) { setTimeout(boot, 100); return; }
    build(); topChip();
    setInterval(() => { if (!document.hidden) tick(); }, 1000);
    window.addEventListener('astb-theme', () => draw(true));
  }
  window.astbWorld = { status, EX, dur, usStatus: null, redraw: () => draw(true) };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot); else boot();
})();
