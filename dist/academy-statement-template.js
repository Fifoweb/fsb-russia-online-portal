import { statementGlyphWidths } from './academy-statement-metrics.js';
import { statementOrnaments, statementSeal } from './academy-statement-art.js';
// Shared with the server renderer. Only validated text is used on the server;
// escaping here also keeps the live, unfinished browser draft safe.
export const STATEMENT_WIDTH = 1240;
export const STATEMENT_HEIGHT = 1754;
const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const clean = (value, fallback, limit = 800) => [...String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/[\ud800-\udfff\ufffe\uffff]/gu, '\ufffd').replace(/\s+/gu, ' ').trim()].slice(0,limit).join('') || fallback;

// Actual font advances keep long words inside the page in both renderers.
function units(char) {
  return (statementGlyphWidths[char.codePointAt(0)] ?? 1) * 1.06;
}
export function statementLines(text, width, size) {
  const lines = []; let line = '', used = 0;
  for (const word of String(text).split(/\s+/u)) {
    const length = [...word].reduce((sum, ch) => sum + units(ch) * size, 0);
    if (line && used + size * .32 + length > width) { lines.push(line); line = ''; used = 0; }
    for (const char of (line ? ' ' : '') + word) {
      const advance = units(char) * size;
      if (used + advance > width && line) { lines.push(line); line = ''; used = 0; }
      line += char; used += advance;
    }
  }
  if (line) lines.push(line);
  return lines;
}
export function academyStatement(snapshot = {}, createdAt = new Date().toISOString(), applicationId = '') {
  const name = clean(snapshot.game_name, 'Имя и фамилия персонажа', 100);
  const passport = clean(snapshot.passport_number, 'не указан', 20);
  const discord = snapshot.discord || {};
  const username = clean(discord.username, 'не указан', 80);
  const discordId = clean(discord.id, 'не указан', 20);
  const knowledge = snapshot.law_knowledge === '' || snapshot.law_knowledge == null ? 'не указано' : `${snapshot.law_knowledge} из 10`;
  const about = clean(snapshot.about, 'Здесь появится ваш рассказ о персонаже.');
  const activity = clean(snapshot.organization_activity, 'Здесь появится ваш ответ о работе организации.');
  const date = new Intl.DateTimeFormat('ru-RU', {timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(createdAt));
  const header = ['Начальнику Академии ФСБ', 'Россия Онлайн', `Кандидат: ${name}`, `Игровой паспорт № ${passport}`];
  let hy = 124;
  const head = header.flatMap(value => statementLines(value, 490, 24).map(line => {
    const result = `<text x="650" y="${hy}" font-size="24">${xml(line)}</text>`; hy += 36; return result;
  })).join('');
  const ruleY = Math.max(292, hy + 24);
  const titleY = ruleY + 72;
  const blocks = [
    ['Прошу принять меня на обучение в Академию ФСБ игровой фракции проекта «Россия Онлайн». Прошу рассмотреть мою кандидатуру на основании представленной анкеты.', false],
    [`Знание законодательной базы: ${knowledge}.`, false],
    ['О себе', true], [about, false],
    ['Деятельность организации', true], [activity, false],
    ['К заявлению прилагаются', true],
    ['Ссылки на фотографии игровых документов: медицинской карты, военного билета, лицензии на оружие и водительского удостоверения категории B.', false],
    [`Контакт Discord: ${username}. ID: ${discordId}.`, false],
  ];
  let content = '', endY = 0, fontSize = 28;
  // Reserve the lower area for the decorative faction seal, even for long answers.
  for (const size of [28, 26, 24, 22, 20, 18, 16, 14, 12]) {
    let y = titleY + 72; const parts = [];
    for (const [value, heading] of blocks) {
      if (heading) y += 12;
      for (const line of statementLines(value, 1040, size)) {
        parts.push(`<text x="100" y="${y}" font-size="${size}"${heading?' font-weight="700" fill="#1d3650"':''}>${xml(line)}</text>`);
        y += Math.ceil(size * 1.5);
      }
      y += heading ? 4 : 16;
    }
    content = parts.join(''); endY = y; fontSize = size;
    if (y <= 1310) break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${STATEMENT_WIDTH} ${STATEMENT_HEIGHT}" width="${STATEMENT_WIDTH}" height="${STATEMENT_HEIGHT}" role="img" aria-label="Заявление в академию ФСБ: ${xml(name)}"><rect width="1240" height="1754" fill="#fffefa"/><g fill="#202832" font-family="Manrope, sans-serif">${statementOrnaments(ruleY)}${head}<text x="620" y="${titleY}" text-anchor="middle" font-size="36" font-weight="700" letter-spacing="4" fill="#1d3650">ЗАЯВЛЕНИЕ</text>${content}<text x="100" y="1440" font-size="14" letter-spacing="2" fill="#777366">ДАТА ПОДАЧИ</text><text x="100" y="1480" font-size="24">${xml(date)}</text><text x="100" y="1536" font-size="18" fill="#777366">Сформировано на портале игровой фракции</text>${statementSeal()}<path d="M100 1632H1140" stroke="#d9cfb8"/><text x="100" y="1680" font-size="16" fill="#666">Россия Онлайн · Игровой документ</text><text x="1140" y="1680" text-anchor="end" font-size="16" fill="#666">${xml(applicationId ? `Заявка ${applicationId.slice(0,8)}` : 'Анкета кандидата')}</text></g></svg>`;
  return {svg, fontSize, endY, text: [...header,'ЗАЯВЛЕНИЕ',...blocks.map(([text])=>text),date,name,'Россия Онлайн · Игровой документ'].join('\n')};
}
