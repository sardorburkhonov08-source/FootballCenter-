// Quiz bankiga qo'shimcha ~1000 savol (q12—q21): aniq ma'lumot jadvallaridan shablonlar bilan (uz, ru, en).
// Ishga tushirish: node scripts/gen-quiz-extra.js — q12+ fayllari qayta yoziladi (q01—q11 ga tegmaydi, ular bilan takror tashlanadi).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src/data/quiz-bank');
const dict = require(path.join(DIR, 'dict.json'));
const PLAYERS = require(path.join(ROOT, 'src/data/players.json'));

// Barqaror "tasodif"
function rng(seed) { let h = crypto.createHash('sha1').update(seed).digest(); let i = 0; return () => { if (i >= 18) { h = crypto.createHash('sha1').update(h).digest(); i = 0; } const v = h.readUInt16BE(i) / 65536; i += 2; return v; }; }
function pickN(list, n, seed, exclude = []) {
  const r = rng(seed);
  const pool = list.filter((x) => !exclude.includes(x));
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  if (out.length < n) throw new Error(`distraktor yetmadi: ${seed}`);
  return out;
}
const Q = [];
function add(uz, ru, en, opts) { Q.push([uz, ru, en, opts]); }

// ---------------- 1) Liga chempionlari mavsumlar bo'yicha
const LEAGUES = [
  {
    uz: 'Angliya Premier ligasi', ru: 'Английской Премьер-лиги', en: 'the Premier League',
    clubs: ['Manchester United', 'Arsenal', 'Chelsea', 'Liverpool', 'Manchester City', 'Blackburn Rovers', 'Leicester City', 'Tottenham Hotspur', 'Newcastle United', 'Aston Villa'],
    winners: { '1992/93': 'Manchester United', '1993/94': 'Manchester United', '1994/95': 'Blackburn Rovers', '1995/96': 'Manchester United', '1996/97': 'Manchester United', '1997/98': 'Arsenal', '1998/99': 'Manchester United', '1999/2000': 'Manchester United', '2000/01': 'Manchester United', '2001/02': 'Arsenal', '2002/03': 'Manchester United', '2003/04': 'Arsenal', '2004/05': 'Chelsea', '2005/06': 'Chelsea', '2006/07': 'Manchester United', '2007/08': 'Manchester United', '2008/09': 'Manchester United', '2009/10': 'Chelsea', '2010/11': 'Manchester United', '2011/12': 'Manchester City', '2012/13': 'Manchester United', '2013/14': 'Manchester City', '2014/15': 'Chelsea', '2015/16': 'Leicester City', '2016/17': 'Chelsea', '2017/18': 'Manchester City', '2018/19': 'Manchester City', '2019/20': 'Liverpool', '2020/21': 'Manchester City', '2021/22': 'Manchester City', '2022/23': 'Manchester City', '2023/24': 'Manchester City', '2024/25': 'Liverpool' },
  },
  {
    uz: 'Ispaniya La Ligasi', ru: 'Ла Лиги', en: 'La Liga',
    clubs: ['Real Madrid', 'Barcelona', 'Atlético Madrid', 'Valencia', 'Deportivo La Coruña', 'Sevilla', 'Villarreal', 'Athletic Bilbao', 'Real Sociedad'],
    winners: { '1999/2000': 'Deportivo La Coruña', '2000/01': 'Real Madrid', '2001/02': 'Valencia', '2002/03': 'Real Madrid', '2003/04': 'Valencia', '2004/05': 'Barcelona', '2005/06': 'Barcelona', '2006/07': 'Real Madrid', '2007/08': 'Real Madrid', '2008/09': 'Barcelona', '2009/10': 'Barcelona', '2010/11': 'Barcelona', '2011/12': 'Real Madrid', '2012/13': 'Barcelona', '2013/14': 'Atlético Madrid', '2014/15': 'Barcelona', '2015/16': 'Barcelona', '2016/17': 'Real Madrid', '2017/18': 'Barcelona', '2018/19': 'Barcelona', '2019/20': 'Real Madrid', '2020/21': 'Atlético Madrid', '2021/22': 'Real Madrid', '2022/23': 'Barcelona', '2023/24': 'Real Madrid', '2024/25': 'Barcelona' },
  },
  {
    uz: 'Italiya Seriya A', ru: 'Серии А', en: 'Serie A',
    clubs: ['Juventus', 'Milan', 'Inter', 'Roma', 'Lazio', 'Napoli', 'Fiorentina', 'Atalanta', 'Parma'],
    winners: { '1999/2000': 'Lazio', '2000/01': 'Roma', '2001/02': 'Juventus', '2002/03': 'Juventus', '2003/04': 'Milan', '2006/07': 'Inter', '2007/08': 'Inter', '2008/09': 'Inter', '2009/10': 'Inter', '2010/11': 'Milan', '2011/12': 'Juventus', '2012/13': 'Juventus', '2013/14': 'Juventus', '2014/15': 'Juventus', '2015/16': 'Juventus', '2016/17': 'Juventus', '2017/18': 'Juventus', '2018/19': 'Juventus', '2019/20': 'Juventus', '2020/21': 'Inter', '2021/22': 'Milan', '2022/23': 'Napoli', '2023/24': 'Inter', '2024/25': 'Napoli' },
  },
  {
    uz: 'Germaniya Bundesligasi', ru: 'Бундеслиги', en: 'the Bundesliga',
    clubs: ['Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'Werder Bremen', 'VfB Stuttgart', 'Wolfsburg', 'Schalke 04', 'Hamburg', 'RB Leipzig'],
    winners: { '1999/2000': 'Bayern Munich', '2000/01': 'Bayern Munich', '2001/02': 'Borussia Dortmund', '2002/03': 'Bayern Munich', '2003/04': 'Werder Bremen', '2004/05': 'Bayern Munich', '2005/06': 'Bayern Munich', '2006/07': 'VfB Stuttgart', '2007/08': 'Bayern Munich', '2008/09': 'Wolfsburg', '2009/10': 'Bayern Munich', '2010/11': 'Borussia Dortmund', '2011/12': 'Borussia Dortmund', '2012/13': 'Bayern Munich', '2013/14': 'Bayern Munich', '2014/15': 'Bayern Munich', '2015/16': 'Bayern Munich', '2016/17': 'Bayern Munich', '2017/18': 'Bayern Munich', '2018/19': 'Bayern Munich', '2019/20': 'Bayern Munich', '2020/21': 'Bayern Munich', '2021/22': 'Bayern Munich', '2022/23': 'Bayern Munich', '2023/24': 'Bayer Leverkusen', '2024/25': 'Bayern Munich' },
  },
  {
    uz: 'Fransiya Liga 1', ru: 'Лиги 1', en: 'Ligue 1',
    clubs: ['Paris Saint-Germain', 'Lyon', 'Marseille', 'Monaco', 'Lille', 'Bordeaux', 'Nantes', 'Montpellier', 'Saint-Étienne'],
    winners: { '1999/2000': 'Monaco', '2000/01': 'Nantes', '2001/02': 'Lyon', '2002/03': 'Lyon', '2003/04': 'Lyon', '2004/05': 'Lyon', '2005/06': 'Lyon', '2006/07': 'Lyon', '2007/08': 'Lyon', '2008/09': 'Bordeaux', '2009/10': 'Marseille', '2010/11': 'Lille', '2011/12': 'Montpellier', '2012/13': 'Paris Saint-Germain', '2013/14': 'Paris Saint-Germain', '2014/15': 'Paris Saint-Germain', '2015/16': 'Paris Saint-Germain', '2016/17': 'Monaco', '2017/18': 'Paris Saint-Germain', '2018/19': 'Paris Saint-Germain', '2019/20': 'Paris Saint-Germain', '2020/21': 'Lille', '2021/22': 'Paris Saint-Germain', '2022/23': 'Paris Saint-Germain', '2023/24': 'Paris Saint-Germain', '2024/25': 'Paris Saint-Germain' },
  },
];
for (const L of LEAGUES) {
  for (const [season, w] of Object.entries(L.winners)) {
    add(`${season}-mavsumda ${L.uz} chempioni qaysi klub bo'lgan?`,
      `Какой клуб стал чемпионом ${L.ru} в сезоне ${season}?`,
      `Which club won ${L.en} in the ${season} season?`,
      [w, ...pickN(L.clubs, 3, `lg:${L.en}:${season}`, [w])]);
  }
}

// ---------------- 2) Yevropa kuboklari yillar bo'yicha (final yili)
const BIG = ['Real Madrid', 'Barcelona', 'Manchester United', 'Liverpool', 'Chelsea', 'Bayern Munich', 'Juventus', 'Milan', 'Inter', 'Ajax', 'Porto', 'Borussia Dortmund', 'Marseille', 'Manchester City', 'Paris Saint-Germain', 'Atlético Madrid', 'Arsenal', 'Benfica', 'Valencia', 'Monaco'];
const UCL = { 1993: 'Marseille', 1994: 'Milan', 1995: 'Ajax', 1996: 'Juventus', 1997: 'Borussia Dortmund', 1998: 'Real Madrid', 1999: 'Manchester United', 2000: 'Real Madrid', 2001: 'Bayern Munich', 2002: 'Real Madrid', 2003: 'Milan', 2004: 'Porto', 2005: 'Liverpool', 2006: 'Barcelona', 2007: 'Milan', 2008: 'Manchester United', 2009: 'Barcelona', 2010: 'Inter', 2011: 'Barcelona', 2012: 'Chelsea', 2013: 'Bayern Munich', 2014: 'Real Madrid', 2015: 'Barcelona', 2016: 'Real Madrid', 2017: 'Real Madrid', 2018: 'Real Madrid', 2019: 'Liverpool', 2020: 'Bayern Munich', 2021: 'Chelsea', 2022: 'Real Madrid', 2023: 'Manchester City', 2024: 'Real Madrid', 2025: 'Paris Saint-Germain' };
for (const [y, w] of Object.entries(UCL)) {
  add(`${y}-yilgi UEFA Chempionlar ligasi finalida qaysi klub g'olib chiqqan?`,
    `Какой клуб выиграл финал Лиги чемпионов УЕФА ${y} года?`,
    `Which club won the ${y} UEFA Champions League final?`,
    [w, ...pickN(BIG, 3, `ucl:${y}`, [w])]);
}
const UEL_POOL = ['Sevilla', 'Atlético Madrid', 'Porto', 'Chelsea', 'Manchester United', 'Liverpool', 'Valencia', 'Villarreal', 'Inter', 'Arsenal', 'Benfica', 'Galatasaray', 'Feyenoord', 'Zenit', 'Shakhtar Donetsk', 'CSKA Moscow', 'Eintracht Frankfurt', 'Atalanta', 'Tottenham Hotspur', 'Roma', 'Marseille', 'Bayer Leverkusen', 'Ajax', 'Sporting CP'];
const UEL = { 2000: 'Galatasaray', 2001: 'Liverpool', 2002: 'Feyenoord', 2003: 'Porto', 2004: 'Valencia', 2005: 'CSKA Moscow', 2006: 'Sevilla', 2007: 'Sevilla', 2008: 'Zenit', 2009: 'Shakhtar Donetsk', 2010: 'Atlético Madrid', 2011: 'Porto', 2012: 'Atlético Madrid', 2013: 'Chelsea', 2014: 'Sevilla', 2015: 'Sevilla', 2016: 'Sevilla', 2017: 'Manchester United', 2018: 'Atlético Madrid', 2019: 'Chelsea', 2020: 'Sevilla', 2021: 'Villarreal', 2022: 'Eintracht Frankfurt', 2023: 'Sevilla', 2024: 'Atalanta', 2025: 'Tottenham Hotspur' };
for (const [y, w] of Object.entries(UEL)) {
  const cup = Number(y) <= 2009 ? ['UEFA Kubogi', 'Кубка УЕФА', 'UEFA Cup'] : ['UEFA Yevropa ligasi', 'Лиги Европы УЕФА', 'UEFA Europa League'];
  add(`${y}-yilda ${cup[0]}ni qaysi klub yutgan?`,
    `Какой клуб выиграл ${cup[1]} в ${y} году?`,
    `Which club won the ${y} ${cup[2]}?`,
    [w, ...pickN(UEL_POOL, 3, `uel:${y}`, [w])]);
}

// ---------------- 3) Oltin to'p (Ballon d'Or) yillar bo'yicha
const BDO_POOL = ['Lothar Matthäus', 'Jean-Pierre Papin', 'Marco van Basten', 'Roberto Baggio', 'Hristo Stoichkov', 'George Weah', 'Matthias Sammer', 'Ronaldo Nazário', 'Zinedine Zidane', 'Rivaldo', 'Luís Figo', 'Michael Owen', 'Pavel Nedvěd', 'Andriy Shevchenko', 'Ronaldinho', 'Fabio Cannavaro', 'Kaká', 'Cristiano Ronaldo', 'Lionel Messi', 'Luka Modrić', 'Karim Benzema', 'Rodri', 'Ousmane Dembélé', 'Thierry Henry', 'Andrés Iniesta', 'Xavi', 'Robert Lewandowski', 'Erling Haaland', 'Kylian Mbappé', 'Virgil van Dijk', 'Lamine Yamal', 'Vinícius Júnior', 'Gianluigi Buffon', 'Paolo Maldini', 'Dennis Bergkamp', 'David Beckham', 'Oliver Kahn', 'Raúl', 'Wayne Rooney', 'Manuel Neuer', 'Mohamed Salah'];
const BDO = { 1990: 'Lothar Matthäus', 1991: 'Jean-Pierre Papin', 1992: 'Marco van Basten', 1993: 'Roberto Baggio', 1994: 'Hristo Stoichkov', 1995: 'George Weah', 1996: 'Matthias Sammer', 1997: 'Ronaldo Nazário', 1998: 'Zinedine Zidane', 1999: 'Rivaldo', 2000: 'Luís Figo', 2001: 'Michael Owen', 2002: 'Ronaldo Nazário', 2003: 'Pavel Nedvěd', 2004: 'Andriy Shevchenko', 2005: 'Ronaldinho', 2006: 'Fabio Cannavaro', 2007: 'Kaká', 2008: 'Cristiano Ronaldo', 2009: 'Lionel Messi', 2010: 'Lionel Messi', 2011: 'Lionel Messi', 2012: 'Lionel Messi', 2013: 'Cristiano Ronaldo', 2014: 'Cristiano Ronaldo', 2015: 'Lionel Messi', 2016: 'Cristiano Ronaldo', 2017: 'Cristiano Ronaldo', 2018: 'Luka Modrić', 2019: 'Lionel Messi', 2021: 'Lionel Messi', 2022: 'Karim Benzema', 2023: 'Lionel Messi', 2024: 'Rodri', 2025: 'Ousmane Dembélé' };
for (const [y, w] of Object.entries(BDO)) {
  // Distraktorlar — shu davr futbolchilari (oltin to'p yili ±8 yil ichida g'olib bo'lganlar va mashhurlar)
  add(`${y}-yilda «Oltin to'p» (⟦Ballon d'Or⟧) mukofotini kim olgan?`,
    `Кто получил «Золотой мяч» в ${y} году?`,
    `Who won the Ballon d'Or in ${y}?`,
    [w, ...pickN(BDO_POOL, 3, `bdo:${y}`, [w])]);
}

// ---------------- 4) Futbolchilar (players.json): davlati, tug'ilgan yili, pozitsiyasi, klubi
const NAT_POOL = ['BRA', 'ARG', 'GER', 'FRA', 'ITA', 'ESP', 'ENG', 'POR', 'NED', 'BEL', 'URU', 'CRO', 'SWE', 'NOR', 'POL', 'DEN', 'SEN', 'EGY', 'NGA', 'CIV', 'CMR', 'KOR', 'JPN', 'MAR', 'UKR', 'SRB', 'COL', 'MEX', 'UZB', 'CZE'];
const POS = ['GK', 'DEF', 'MID', 'FWD'];
const POS_SKIP = ['Diego Maradona', 'Ronaldinho', 'Johan Cruyff', 'Kaká', 'Lionel Messi', 'Neymar', 'Mesut Özil'];
const CLUB_POOL = ['Real Madrid', 'Barcelona', 'Manchester United', 'Liverpool', 'Chelsea', 'Arsenal', 'Bayern Munich', 'Juventus', 'Milan', 'Inter', 'Paris Saint-Germain', 'Borussia Dortmund', 'Atlético Madrid', 'Manchester City', 'Tottenham Hotspur', 'Ajax', 'Benfica', 'Porto', 'Napoli', 'Roma'];
// Ro'yxatda bo'lmagan, lekin haqiqatda o'ynagan klublar (xato distraktor bo'lmasin)
const ALSO = {
  'Thiago Silva': ['Porto'], 'David Beckham': ['Milan'], "Samuel Eto'o": ['Real Madrid'], 'Raheem Sterling': ['Arsenal'],
  'Gabriel Batistuta': ['Inter'], 'Jamal Musiala': ['Chelsea'], 'Romelu Lukaku': [], 'Zlatan Ibrahimović': [],
  'Kevin De Bruyne': [], 'Edinson Cavani': [], 'Dani Alves': [], 'Ronaldo Nazário': [], 'Fernando Torres': [],
};
const COUNTRY_ALT = { FRG: ['GER'], GER: ['FRG'], URS: ['RUS', 'UKR'], UKR: ['URS'] };
for (const p of PLAYERS) {
  const nat = `#${p.country}`;
  add(`⟦${p.name}⟧ qaysi mamlakat terma jamoasida o'ynagan?`,
    `За сборную какой страны играл ${p.name}?`,
    `Which country did ${p.name} play for internationally?`,
    [nat, ...pickN(NAT_POOL, 3, `nat:${p.name}`, [p.country, ...(COUNTRY_ALT[p.country] || [])]).map((c) => `#${c}`)]);
  const years = [p.born - 3, p.born - 2, p.born - 1, p.born + 1, p.born + 2, p.born + 3].map(String);
  add(`⟦${p.name}⟧ qaysi yili tug'ilgan?`,
    `В каком году родился ${p.name}?`,
    `In which year was ${p.name} born?`,
    [String(p.born), ...pickN(years, 3, `born:${p.name}`)]);
  if (!POS_SKIP.includes(p.name)) {
    add(`⟦${p.name}⟧ asosan qaysi pozitsiyada o'ynagan?`,
      `На какой позиции в основном играл ${p.name}?`,
      `What was ${p.name}'s main position?`,
      [`#${p.pos}`, ...POS.filter((x) => x !== p.pos).map((x) => `#${x}`)]);
  }
  const big = p.clubs.filter((c) => CLUB_POOL.includes(c));
  const right = big.length ? big[Math.floor(rng(`club:${p.name}`)() * big.length)] : p.clubs[0];
  add(`⟦${p.name}⟧ quyidagi klublardan qaysi birida o'ynagan?`,
    `За какой из этих клубов играл ${p.name}?`,
    `Which of these clubs did ${p.name} play for?`,
    [right, ...pickN(CLUB_POOL, 3, `clubd:${p.name}`, [...p.clubs, ...(ALSO[p.name] || [])])]);
}

// ---------------- 5) Klub qaysi mamlakatda
const CLUB_COUNTRY = {
  ENG: ['Arsenal', 'Chelsea', 'Liverpool', 'Everton', 'Newcastle United', 'Aston Villa', 'Tottenham Hotspur', 'West Ham United', 'Leeds United', 'Nottingham Forest', 'Leicester City', 'Wolverhampton Wanderers', 'Brighton & Hove Albion', 'Crystal Palace', 'Fulham', 'Southampton'],
  ESP: ['Real Madrid', 'Barcelona', 'Atlético Madrid', 'Sevilla', 'Valencia', 'Villarreal', 'Real Betis', 'Athletic Bilbao', 'Real Sociedad', 'Celta Vigo', 'Deportivo La Coruña', 'Espanyol'],
  ITA: ['Juventus', 'Milan', 'Inter', 'Roma', 'Lazio', 'Napoli', 'Fiorentina', 'Atalanta', 'Torino', 'Genoa', 'Sampdoria', 'Bologna', 'Udinese', 'Parma'],
  GER: ['Bayern Munich', 'Borussia Dortmund', 'Bayer Leverkusen', 'Schalke 04', 'Werder Bremen', 'Hamburg', 'VfB Stuttgart', 'Eintracht Frankfurt', 'Borussia Mönchengladbach', 'RB Leipzig', 'Wolfsburg', '1. FC Köln'],
  FRA: ['Paris Saint-Germain', 'Marseille', 'Lyon', 'Lille', 'Bordeaux', 'Nantes', 'Saint-Étienne', 'Rennes', 'Nice', 'Lens'],
  NED: ['Ajax', 'PSV Eindhoven', 'Feyenoord', 'AZ Alkmaar', 'Twente'],
  POR: ['Benfica', 'Porto', 'Sporting CP', 'Braga'],
  SCO: ['Celtic', 'Rangers', 'Aberdeen'],
  TUR: ['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor'],
  BEL: ['Anderlecht', 'Club Brugge', 'Standard Liège'],
  ARG: ['Boca Juniors', 'River Plate', 'Independiente', 'Racing Club', 'San Lorenzo'],
  BRA: ['Flamengo', 'Santos', 'Palmeiras', 'Corinthians', 'São Paulo', 'Grêmio', 'Cruzeiro', 'Fluminense'],
  KSA: ['Al-Hilal', 'Al-Nassr', 'Al-Ittihad', 'Al-Ahli'],
  UZB: ['Pakhtakor', 'Bunyodkor', 'Nasaf', 'Navbahor', 'Neftchi Fergana', 'Lokomotiv Tashkent', 'AGMK', 'Andijon'],
  RUS: ['Spartak Moscow', 'CSKA Moscow', 'Zenit', 'Lokomotiv Moscow', 'Dynamo Moscow'],
  UKR: ['Dynamo Kyiv', 'Shakhtar Donetsk'],
  GRE: ['Olympiacos', 'Panathinaikos', 'AEK Athens'],
  MEX: ['Club América', 'Guadalajara (Chivas)', 'Cruz Azul'],
  USA: ['LA Galaxy', 'Inter Miami', 'Seattle Sounders'],
  JPN: ['Kashima Antlers', 'Urawa Red Diamonds'],
  QAT: ['Al-Sadd'],
  EGY: ['Al Ahly', 'Zamalek'],
  SRB: ['Red Star Belgrade', 'Partizan'],
  CRO: ['Dinamo Zagreb', 'Hajduk Split'],
  AUT: ['Red Bull Salzburg', 'Rapid Vienna'],
  SUI: ['Basel', 'Young Boys'],
  CZE: ['Sparta Prague', 'Slavia Prague'],
  DEN: ['Copenhagen', 'Brøndby'],
  URU: ['Peñarol', 'Nacional'],
  MAR: ['Raja Casablanca', 'Wydad Casablanca'],
};
const NEAR = {
  ENG: ['SCO', 'WAL', 'IRL', 'NED'], ESP: ['POR', 'ITA', 'FRA'], ITA: ['ESP', 'FRA', 'SUI'], GER: ['AUT', 'SUI', 'NED'], FRA: ['BEL', 'SUI', 'ESP'],
  NED: ['BEL', 'GER', 'DEN'], POR: ['ESP', 'BRA', 'ITA'], SCO: ['ENG', 'IRL', 'WAL'], TUR: ['GRE', 'AZE', 'GEO'], BEL: ['NED', 'FRA', 'SUI'],
  ARG: ['URU', 'CHI', 'BRA'], BRA: ['ARG', 'POR', 'COL'], KSA: ['UAE', 'QAT', 'KUW'], UZB: ['KAZ', 'TJK', 'KGZ'], RUS: ['UKR', 'BLR', 'KAZ'],
  UKR: ['RUS', 'BLR', 'POL'], GRE: ['TUR', 'CYP', 'BUL'], MEX: ['USA', 'COL', 'CRC'], USA: ['CAN', 'MEX', 'ENG'], JPN: ['KOR', 'CHN', 'THA'],
  QAT: ['KSA', 'UAE', 'BHR'], EGY: ['MAR', 'TUN', 'ALG'], SRB: ['CRO', 'BIH', 'MNE'], CRO: ['SRB', 'SVN', 'BIH'], AUT: ['GER', 'SUI', 'CZE'],
  SUI: ['AUT', 'GER', 'FRA'], CZE: ['SVK', 'POL', 'AUT'], DEN: ['NOR', 'SWE', 'NED'], URU: ['ARG', 'PAR', 'CHI'], MAR: ['ALG', 'TUN', 'EGY'],
};
for (const [code, clubs] of Object.entries(CLUB_COUNTRY)) {
  for (const c of clubs) {
    add(`⟦${c}⟧ klubi qaysi mamlakatda joylashgan?`,
      `В какой стране базируется клуб ${c}?`,
      `In which country is ${c} based?`,
      [`#${code}`, ...pickN(NEAR[code], 3, `cc:${c}`).map((x) => `#${x}`)]);
  }
}

// ---------------- 6) Stadion qaysi klubniki
const STADIUMS = [
  ['Camp Nou', 'Barcelona', 'ESP'], ['Santiago Bernabéu', 'Real Madrid', 'ESP'], ['Old Trafford', 'Manchester United', 'ENG'], ['Anfield', 'Liverpool', 'ENG'],
  ['Emirates Stadium', 'Arsenal', 'ENG'], ['Stamford Bridge', 'Chelsea', 'ENG'], ['Etihad Stadium', 'Manchester City', 'ENG'], ['Allianz Arena', 'Bayern Munich', 'GER'],
  ['Signal Iduna Park', 'Borussia Dortmund', 'GER'], ['Parc des Princes', 'Paris Saint-Germain', 'FRA'], ['Johan Cruyff Arena', 'Ajax', 'NED'], ['Estádio da Luz', 'Benfica', 'POR'],
  ['Estádio do Dragão', 'Porto', 'POR'], ['Celtic Park', 'Celtic', 'SCO'], ['Ibrox', 'Rangers', 'SCO'], ['Diego Armando Maradona Stadium', 'Napoli', 'ITA'],
  ['Mestalla', 'Valencia', 'ESP'], ['Ramón Sánchez-Pizjuán', 'Sevilla', 'ESP'], ['San Mamés', 'Athletic Bilbao', 'ESP'], ['Benito Villamarín', 'Real Betis', 'ESP'],
  ['Estadio de la Cerámica', 'Villarreal', 'ESP'], ['Tottenham Hotspur Stadium', 'Tottenham Hotspur', 'ENG'], ['Villa Park', 'Aston Villa', 'ENG'], ["St James' Park", 'Newcastle United', 'ENG'],
  ['Elland Road', 'Leeds United', 'ENG'], ['City Ground', 'Nottingham Forest', 'ENG'], ['Molineux', 'Wolverhampton Wanderers', 'ENG'], ['Selhurst Park', 'Crystal Palace', 'ENG'],
  ['Craven Cottage', 'Fulham', 'ENG'], ['Veltins-Arena', 'Schalke 04', 'GER'], ['BayArena', 'Bayer Leverkusen', 'GER'], ['Weserstadion', 'Werder Bremen', 'GER'],
  ['Volksparkstadion', 'Hamburg', 'GER'], ['Stade Vélodrome', 'Marseille', 'FRA'], ['Philips Stadion', 'PSV Eindhoven', 'NED'], ['De Kuip', 'Feyenoord', 'NED'],
  ['Estádio José Alvalade', 'Sporting CP', 'POR'], ['Şükrü Saracoğlu Stadium', 'Fenerbahçe', 'TUR'], ['Vila Belmiro', 'Santos', 'BRA'], ['Morumbi', 'São Paulo', 'BRA'],
  ['Allianz Parque', 'Palmeiras', 'BRA'], ['Estadio Monumental (Buenos Aires)', 'River Plate', 'ARG'], ['Stadio Artemio Franchi', 'Fiorentina', 'ITA'], ['Gewiss Stadium', 'Atalanta', 'ITA'],
];
for (const [s, club, code] of STADIUMS) {
  const base = CLUB_COUNTRY[code];
  const same = code === 'SCO' ? [...base, 'Heart of Midlothian', 'Hibernian'] : base;
  add(`«⟦${s}⟧» qaysi klubning uy stadioni?`,
    `Стадион «${s}» — домашняя арена какого клуба?`,
    `${s} is the home ground of which club?`,
    [club, ...pickN(same, 3, `st:${s}`, [club])]);
}

// ---------------- 7) Murabbiylar qaysi mamlakatdan
const COACHES = [
  ['Pep Guardiola', 'ESP'], ['Jürgen Klopp', 'GER'], ['José Mourinho', 'POR'], ['Carlo Ancelotti', 'ITA'], ['Alex Ferguson', 'SCO'], ['Arsène Wenger', 'FRA'],
  ['Diego Simeone', 'ARG'], ['Antonio Conte', 'ITA'], ['Thomas Tuchel', 'GER'], ['Mauricio Pochettino', 'ARG'], ['Mikel Arteta', 'ESP'], ['Xabi Alonso', 'ESP'],
  ['Hansi Flick', 'GER'], ['Julian Nagelsmann', 'GER'], ['Joachim Löw', 'GER'], ['Didier Deschamps', 'FRA'], ['Lionel Scaloni', 'ARG'], ['Gareth Southgate', 'ENG'],
  ['Guus Hiddink', 'NED'], ['Louis van Gaal', 'NED'], ['Fabio Capello', 'ITA'], ['Marcello Lippi', 'ITA'], ['Ralf Rangnick', 'GER'], ['Marcelo Bielsa', 'ARG'],
  ['Maurizio Sarri', 'ITA'], ['Massimiliano Allegri', 'ITA'], ['Rafael Benítez', 'ESP'], ['Vicente del Bosque', 'ESP'], ['Luis Enrique', 'ESP'], ['Unai Emery', 'ESP'],
  ['Arne Slot', 'NED'], ['Erik ten Hag', 'NED'], ['Ronald Koeman', 'NED'], ['Simone Inzaghi', 'ITA'], ['Gian Piero Gasperini', 'ITA'], ['Luciano Spalletti', 'ITA'],
  ['Roberto Mancini', 'ITA'], ['Jupp Heynckes', 'GER'], ['Ottmar Hitzfeld', 'GER'], ['Arrigo Sacchi', 'ITA'], ['Frank Rijkaard', 'NED'], ['Claudio Ranieri', 'ITA'],
  ['Ange Postecoglou', 'AUS'], ['Rúben Amorim', 'POR'], ['Fernando Santos', 'POR'], ['Luiz Felipe Scolari', 'BRA'], ['Tite', 'BRA'], ['Carlos Queiroz', 'POR'],
  ['Srečko Katanec', 'SVN'], ['Timur Kapadze', 'UZB'], ['Mirjalol Qosimov', 'UZB'], ['Vicente Moreno', 'ESP'], ['Roberto Martínez', 'ESP'], ['Zinedine Zidane', 'FRA'],
];
const COACH_POOL = ['ESP', 'GER', 'POR', 'ITA', 'FRA', 'ARG', 'NED', 'ENG', 'BRA', 'SCO', 'BEL', 'URU', 'CRO', 'SRB', 'AUS', 'SVN', 'UZB', 'KAZ', 'RUS', 'TUR'];
for (const [name, code] of COACHES) {
  add(`Murabbiy ⟦${name}⟧ qaysi mamlakatdan?`,
    `Из какой страны тренер ${name}?`,
    `Which country is coach ${name} from?`,
    [`#${code}`, ...pickN(COACH_POOL, 3, `coach:${name}`, [code]).map((x) => `#${x}`)]);
}

// ---------------- 8) Klub qaysi shaharda
const C = (uz, ru, en) => [uz, ru, en];
const CITY = {
  Madrid: C('Madrid', 'Мадрид', 'Madrid'), Barcelona: C('Barselona', 'Барселона', 'Barcelona'), Sevilla: C('Sevilya', 'Севилья', 'Seville'), Valencia: C('Valensiya', 'Валенсия', 'Valencia'),
  Bilbao: C('Bilbao', 'Бильбао', 'Bilbao'), SanSeb: C('San-Sebastyan', 'Сан-Себастьян', 'San Sebastián'), Villarreal: C('Vilyarreal', 'Вильярреал', 'Villarreal'),
  Manchester: C('Manchester', 'Манчестер', 'Manchester'), Liverpool: C('Liverpul', 'Ливерпуль', 'Liverpool'), London: C('London', 'Лондон', 'London'), Birmingham: C('Birmingem', 'Бирмингем', 'Birmingham'),
  Newcastle: C('Nyukasl', 'Ньюкасл', 'Newcastle'), Leeds: C('Lids', 'Лидс', 'Leeds'), Nottingham: C('Nottingem', 'Ноттингем', 'Nottingham'),
  Munich: C('Myunxen', 'Мюнхен', 'Munich'), Dortmund: C('Dortmund', 'Дортмунд', 'Dortmund'), Gelsen: C('Gelzenkirxen', 'Гельзенкирхен', 'Gelsenkirchen'), Leverkusen: C('Leverkuzen', 'Леверкузен', 'Leverkusen'),
  Bremen: C('Bremen', 'Бремен', 'Bremen'), Hamburg: C('Gamburg', 'Гамбург', 'Hamburg'), Stuttgart: C('Shtutgart', 'Штутгарт', 'Stuttgart'), Frankfurt: C('Frankfurt', 'Франкфурт', 'Frankfurt'),
  Gladbach: C('Myonxengladbax', 'Мёнхенгладбах', 'Mönchengladbach'), Leipzig: C('Leypsig', 'Лейпциг', 'Leipzig'), Cologne: C('Kyoln', 'Кёльн', 'Cologne'), Wolfsburg: C('Volfsburg', 'Вольфсбург', 'Wolfsburg'),
  Turin: C('Turin', 'Турин', 'Turin'), Milan: C('Milan', 'Милан', 'Milan'), Naples: C('Neapol', 'Неаполь', 'Naples'), Rome: C('Rim', 'Рим', 'Rome'), Florence: C('Florensiya', 'Флоренция', 'Florence'),
  Bergamo: C('Bergamo', 'Бергамо', 'Bergamo'), Genoa: C('Genuya', 'Генуя', 'Genoa'), Bologna: C('Bolonya', 'Болонья', 'Bologna'),
  Amsterdam: C('Amsterdam', 'Амстердам', 'Amsterdam'), Eindhoven: C('Eyndxoven', 'Эйндховен', 'Eindhoven'), Rotterdam: C('Rotterdam', 'Роттердам', 'Rotterdam'), Alkmaar: C('Alkmar', 'Алкмар', 'Alkmaar'),
  Lisbon: C('Lissabon', 'Лиссабон', 'Lisbon'), Porto: C('Portu', 'Порту', 'Porto'), Braga: C('Braga', 'Брага', 'Braga'),
  Paris: C('Parij', 'Париж', 'Paris'), Marseille: C('Marsel', 'Марсель', 'Marseille'), Lyon: C('Lion', 'Лион', 'Lyon'), Lille: C('Lill', 'Лилль', 'Lille'), Bordeaux: C('Bordo', 'Бордо', 'Bordeaux'),
  Nantes: C('Nant', 'Нант', 'Nantes'), StEtienne: C('Sent-Etyen', 'Сент-Этьен', 'Saint-Étienne'),
  Glasgow: C('Glazgo', 'Глазго', 'Glasgow'), Edinburgh: C('Edinburg', 'Эдинбург', 'Edinburgh'), Aberdeen: C('Aberdin', 'Абердин', 'Aberdeen'),
  Istanbul: C('Istanbul', 'Стамбул', 'Istanbul'), Ankara: C('Anqara', 'Анкара', 'Ankara'), Izmir: C('Izmir', 'Измир', 'Izmir'), Trabzon: C('Trabzon', 'Трабзон', 'Trabzon'),
  Brussels: C('Bryussel', 'Брюссель', 'Brussels'), Bruges: C('Bryugge', 'Брюгге', 'Bruges'), Liege: C('Lyej', 'Льеж', 'Liège'), Antwerp: C('Antverpen', 'Антверпен', 'Antwerp'),
  BuenosAires: C('Buenos-Ayres', 'Буэнос-Айрес', 'Buenos Aires'), Rosario: C('Rosario', 'Росарио', 'Rosario'), Cordoba: C('Kordova', 'Кордова', 'Córdoba'),
  Rio: C('Rio-de-Janeyro', 'Рио-де-Жанейро', 'Rio de Janeiro'), SaoPaulo: C('San-Paulu', 'Сан-Паулу', 'São Paulo'), Santos: C('Santus', 'Сантус', 'Santos'), PortoAlegre: C('Portu-Alegri', 'Порту-Алегри', 'Porto Alegre'), BeloHorizonte: C('Belu-Orizonti', 'Белу-Оризонти', 'Belo Horizonte'),
  Riyadh: C('Ar-Riyod', 'Эр-Рияд', 'Riyadh'), Jeddah: C('Jidda', 'Джидда', 'Jeddah'), Dammam: C('Dammam', 'Даммам', 'Dammam'),
  Tashkent: C('Toshkent', 'Ташкент', 'Tashkent'), Qarshi: C('Qarshi', 'Карши', 'Qarshi'), Namangan: C('Namangan', 'Наманган', 'Namangan'), Fergana: C('Farg\'ona', 'Фергана', 'Fergana'),
  Almalyk: C('Olmaliq', 'Алмалык', 'Almalyk'), Andijan: C('Andijon', 'Андижан', 'Andijan'), Samarkand: C('Samarqand', 'Самарканд', 'Samarkand'), Bukhara: C('Buxoro', 'Бухара', 'Bukhara'),
  Moscow: C('Moskva', 'Москва', 'Moscow'), StPetersburg: C('Sankt-Peterburg', 'Санкт-Петербург', 'Saint Petersburg'), Kazan: C('Qozon', 'Казань', 'Kazan'),
  Kyiv: C('Kiyev', 'Киев', 'Kyiv'), Kharkiv: C('Xarkov', 'Харьков', 'Kharkiv'), Lviv: C('Lvov', 'Львов', 'Lviv'),
  Piraeus: C('Pirey', 'Пирей', 'Piraeus'), Athens: C('Afina', 'Афины', 'Athens'), Thessaloniki: C('Saloniki', 'Салоники', 'Thessaloniki'),
  Belgrade: C('Belgrad', 'Белград', 'Belgrade'), NoviSad: C('Novi Sad', 'Нови-Сад', 'Novi Sad'), Zagreb: C('Zagreb', 'Загреб', 'Zagreb'), Split: C('Split', 'Сплит', 'Split'),
  Salzburg: C('Zalsburg', 'Зальцбург', 'Salzburg'), Vienna: C('Vena', 'Вена', 'Vienna'), Graz: C('Grats', 'Грац', 'Graz'),
  Basel: C('Bazel', 'Базель', 'Basel'), Bern: C('Bern', 'Берн', 'Bern'), Zurich: C('Syurix', 'Цюрих', 'Zurich'),
  Cairo: C('Qohira', 'Каир', 'Cairo'), Alexandria: C('Iskandariya', 'Александрия', 'Alexandria'),
  Prague: C('Praga', 'Прага', 'Prague'), Brno: C('Brno', 'Брно', 'Brno'), Copenhagen: C('Kopengagen', 'Копенгаген', 'Copenhagen'), Aarhus: C('Orxus', 'Орхус', 'Aarhus'),
  Montevideo: C('Montevideo', 'Монтевидео', 'Montevideo'), Casablanca: C('Kasablanka', 'Касабланка', 'Casablanca'), Rabat: C('Rabot', 'Рабат', 'Rabat'), Marrakesh: C('Marrakash', 'Марракеш', 'Marrakesh'),
};
const CLUB_CITY = [
  ['Real Madrid', 'Madrid', ['Barcelona', 'Sevilla', 'Valencia']], ['Atlético Madrid', 'Madrid', ['Barcelona', 'Bilbao', 'Sevilla']], ['Barcelona', 'Barcelona', ['Madrid', 'Valencia', 'Sevilla']],
  ['Espanyol', 'Barcelona', ['Madrid', 'Valencia', 'Bilbao']], ['Sevilla', 'Sevilla', ['Madrid', 'Valencia', 'Barcelona']], ['Real Betis', 'Sevilla', ['Madrid', 'Valencia', 'Bilbao']],
  ['Valencia', 'Valencia', ['Madrid', 'Sevilla', 'Barcelona']], ['Athletic Bilbao', 'Bilbao', ['SanSeb', 'Madrid', 'Valencia']], ['Real Sociedad', 'SanSeb', ['Bilbao', 'Madrid', 'Barcelona']],
  ['Manchester City', 'Manchester', ['Liverpool', 'London', 'Birmingham']], ['Everton', 'Liverpool', ['Manchester', 'London', 'Leeds']], ['Aston Villa', 'Birmingham', ['Manchester', 'London', 'Liverpool']],
  ['Newcastle United', 'Newcastle', ['Leeds', 'Manchester', 'Liverpool']], ['Leeds United', 'Leeds', ['Newcastle', 'Manchester', 'Nottingham']], ['Nottingham Forest', 'Nottingham', ['Leeds', 'Birmingham', 'Manchester']],
  ['Tottenham Hotspur', 'London', ['Manchester', 'Liverpool', 'Birmingham']], ['Bayern Munich', 'Munich', ['Dortmund', 'Hamburg', 'Stuttgart']], ['Borussia Dortmund', 'Dortmund', ['Gelsen', 'Munich', 'Leverkusen']],
  ['Schalke 04', 'Gelsen', ['Dortmund', 'Cologne', 'Bremen']], ['Bayer Leverkusen', 'Leverkusen', ['Cologne', 'Dortmund', 'Frankfurt']], ['Werder Bremen', 'Bremen', ['Hamburg', 'Munich', 'Stuttgart']],
  ['Hamburg', 'Hamburg', ['Bremen', 'Munich', 'Leipzig']], ['VfB Stuttgart', 'Stuttgart', ['Munich', 'Frankfurt', 'Cologne']], ['Eintracht Frankfurt', 'Frankfurt', ['Stuttgart', 'Cologne', 'Munich']],
  ['Borussia Mönchengladbach', 'Gladbach', ['Dortmund', 'Cologne', 'Leverkusen']], ['RB Leipzig', 'Leipzig', ['Munich', 'Hamburg', 'Wolfsburg']], ['Wolfsburg', 'Wolfsburg', ['Leipzig', 'Bremen', 'Hamburg']],
  ['Juventus', 'Turin', ['Milan', 'Rome', 'Naples']], ['Napoli', 'Naples', ['Rome', 'Milan', 'Turin']], ['Roma', 'Rome', ['Naples', 'Milan', 'Florence']], ['Lazio', 'Rome', ['Milan', 'Naples', 'Turin']],
  ['Fiorentina', 'Florence', ['Rome', 'Bologna', 'Genoa']], ['Atalanta', 'Bergamo', ['Milan', 'Turin', 'Bologna']], ['Sampdoria', 'Genoa', ['Turin', 'Milan', 'Bologna']], ['Bologna', 'Bologna', ['Florence', 'Genoa', 'Milan']],
  ['Ajax', 'Amsterdam', ['Rotterdam', 'Eindhoven', 'Alkmaar']], ['PSV Eindhoven', 'Eindhoven', ['Amsterdam', 'Rotterdam', 'Alkmaar']], ['Feyenoord', 'Rotterdam', ['Amsterdam', 'Eindhoven', 'Alkmaar']],
  ['Benfica', 'Lisbon', ['Porto', 'Braga', 'Madrid']], ['Sporting CP', 'Lisbon', ['Porto', 'Braga', 'Sevilla']], ['Porto', 'Porto', ['Lisbon', 'Braga', 'Madrid']],
  ['Paris Saint-Germain', 'Paris', ['Marseille', 'Lyon', 'Lille']], ['Marseille', 'Marseille', ['Paris', 'Lyon', 'Bordeaux']], ['Lyon', 'Lyon', ['Paris', 'Marseille', 'StEtienne']], ['Lille', 'Lille', ['Paris', 'Lyon', 'Nantes']],
  ['Bordeaux', 'Bordeaux', ['Nantes', 'Marseille', 'Lyon']], ['Saint-Étienne', 'StEtienne', ['Lyon', 'Marseille', 'Nantes']],
  ['Celtic', 'Glasgow', ['Edinburgh', 'Aberdeen', 'London']], ['Rangers', 'Glasgow', ['Edinburgh', 'Aberdeen', 'Manchester']],
  ['Galatasaray', 'Istanbul', ['Ankara', 'Izmir', 'Trabzon']], ['Fenerbahçe', 'Istanbul', ['Ankara', 'Izmir', 'Trabzon']], ['Beşiktaş', 'Istanbul', ['Ankara', 'Izmir', 'Trabzon']],
  ['Anderlecht', 'Brussels', ['Bruges', 'Liege', 'Antwerp']], ['Club Brugge', 'Bruges', ['Brussels', 'Liege', 'Antwerp']],
  ['Boca Juniors', 'BuenosAires', ['Rosario', 'Cordoba', 'Montevideo']], ['River Plate', 'BuenosAires', ['Rosario', 'Cordoba', 'Montevideo']],
  ['Flamengo', 'Rio', ['SaoPaulo', 'Santos', 'PortoAlegre']], ['Fluminense', 'Rio', ['SaoPaulo', 'BeloHorizonte', 'PortoAlegre']], ['Corinthians', 'SaoPaulo', ['Rio', 'Santos', 'BeloHorizonte']],
  ['Palmeiras', 'SaoPaulo', ['Rio', 'PortoAlegre', 'BeloHorizonte']], ['Grêmio', 'PortoAlegre', ['Rio', 'SaoPaulo', 'BeloHorizonte']], ['Cruzeiro', 'BeloHorizonte', ['Rio', 'SaoPaulo', 'PortoAlegre']],
  ['Al-Hilal', 'Riyadh', ['Jeddah', 'Dammam', 'Cairo']], ['Al-Nassr', 'Riyadh', ['Jeddah', 'Dammam', 'Cairo']], ['Al-Ittihad', 'Jeddah', ['Riyadh', 'Dammam', 'Cairo']],
  ['Pakhtakor', 'Tashkent', ['Samarkand', 'Namangan', 'Qarshi']], ['Bunyodkor', 'Tashkent', ['Bukhara', 'Andijan', 'Fergana']], ['Nasaf', 'Qarshi', ['Bukhara', 'Samarkand', 'Tashkent']],
  ['Navbahor', 'Namangan', ['Andijan', 'Fergana', 'Tashkent']], ['Neftchi Fergana', 'Fergana', ['Namangan', 'Andijan', 'Tashkent']], ['AGMK', 'Almalyk', ['Tashkent', 'Samarkand', 'Namangan']],
  ['Andijon', 'Andijan', ['Namangan', 'Fergana', 'Tashkent']], ['Spartak Moscow', 'Moscow', ['StPetersburg', 'Kazan', 'Kyiv']], ['Zenit', 'StPetersburg', ['Moscow', 'Kazan', 'Kyiv']],
  ['Dynamo Kyiv', 'Kyiv', ['Kharkiv', 'Lviv', 'Moscow']], ['Olympiacos', 'Piraeus', ['Athens', 'Thessaloniki', 'Istanbul']], ['Red Star Belgrade', 'Belgrade', ['NoviSad', 'Zagreb', 'Split']],
  ['Dinamo Zagreb', 'Zagreb', ['Split', 'Belgrade', 'Vienna']], ['Hajduk Split', 'Split', ['Zagreb', 'Belgrade', 'Vienna']], ['Red Bull Salzburg', 'Salzburg', ['Vienna', 'Graz', 'Munich']],
  ['Basel', 'Basel', ['Bern', 'Zurich', 'Vienna']], ['Young Boys', 'Bern', ['Basel', 'Zurich', 'Vienna']], ['Al Ahly', 'Cairo', ['Alexandria', 'Riyadh', 'Casablanca']],
  ['Sparta Prague', 'Prague', ['Brno', 'Vienna', 'Zagreb']], ['Copenhagen', 'Copenhagen', ['Aarhus', 'Prague', 'Bruges']], ['Peñarol', 'Montevideo', ['BuenosAires', 'Rosario', 'SaoPaulo']],
  ['Raja Casablanca', 'Casablanca', ['Rabat', 'Marrakesh', 'Cairo']],
];
for (const [club, city, others] of CLUB_CITY) {
  add(`⟦${club}⟧ klubi qaysi shaharda joylashgan?`,
    `В каком городе базируется клуб ${club}?`,
    `In which city is ${club} based?`,
    [CITY[city], ...others.map((k) => { if (!CITY[k]) throw new Error(k); return CITY[k]; })]);
}

// ---------------- Mavjud bank bilan takrorlanmasin; fayllarga yozish
const existing = new Set();
for (const f of fs.readdirSync(DIR).filter((x) => /^q(0\d|1[01])\.json$/.test(x))) {
  for (const q of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) existing.add(q[2].trim().toLowerCase());
}
const seen = new Set();
const out = [];
for (const q of Q) {
  const k = q[2].trim().toLowerCase();
  if (existing.has(k) || seen.has(k)) continue;
  seen.add(k);
  for (const o of q[3]) if (typeof o === 'string' && o.startsWith('#') && !dict[o.slice(1)]) throw new Error(`dict yo'q: ${o} — ${q[2]}`);
  out.push(q);
}
for (const f of fs.readdirSync(DIR).filter((x) => /^q(1[2-9]|2\d)\.json$/.test(x))) fs.unlinkSync(path.join(DIR, f));
const PER = 100;
for (let i = 0; i * PER < out.length; i += 1) {
  const part = out.slice(i * PER, (i + 1) * PER);
  const file = path.join(DIR, `q${String(12 + i).padStart(2, '0')}.json`);
  fs.writeFileSync(file, `[\n${part.map((q) => JSON.stringify(q)).join(',\n')}\n]\n`);
}
console.log('jami yangi:', out.length, 'tashlandi (takror):', Q.length - out.length);
