import raw from '../../data/vocab.json' with { type: 'json' };

const spellingPairs = [
  ['organise', 'organize'], ['organisation', 'organization'], ['colour', 'color'],
  ['licence', 'license'], ['licences', 'licenses'], ['practise', 'practice'],
  ['defence', 'defense'], ['offence', 'offense'], ['labour', 'labor'],
  ['behaviour', 'behavior'], ['favourite', 'favorite'], ['neighbour', 'neighbor'],
  ['honour', 'honor'], ['recognise', 'recognize'], ['specialise', 'specialize'],
  ['specialised', 'specialized'], ['analyse', 'analyze'], ['travelled', 'traveled'],
  ['travelling', 'traveling'], ['catalogue', 'catalog'], ['programme', 'program'],
  ['programmes', 'programs'], ['centre', 'center'], ['fertiliser', 'fertilizer']
];
const canonical = new Map(spellingPairs.flatMap(([uk, us]) => [[uk, us], [us, us]]));

export function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[‐‑–]/g, '-').replace(/\s+/g, ' ');
}

export function answerKey(value) {
  return normalize(value).replace(/[a-z]+/g, token => canonical.get(token) || token);
}

export function makeEntry(word, { id, chapterId = '个人词表', index = 0, meaning, phonetic, tags = [] } = {}) {
  const display = String(word.w ?? word.display ?? '').trim();
  if (!display || display.length > 512) throw new Error('词条不能为空或超过 512 字符');
  const note = display.match(/^(.+?)\(([^)]+)\)$/);
  const answers = word.answers?.length ? word.answers.map(String)
    : display.includes('=') ? display.split('=').map(s => s.trim()).filter(Boolean)
      : note ? [note[1].trim(), note[2].trim()] : [display];
  const m = String(meaning ?? word.m ?? word.meaning ?? '');
  const p = String(phonetic ?? word.p ?? word.phonetic ?? '');
  return {
    id: id || word.id || `${chapterId}:${index + 1}`, chapterId, sourceIndex: index + 1,
    display, answers, spoken: word.spoken || answers[0].replace(/\bsth\./gi, 'something').replace(/\bsb\./gi, 'somebody'),
    meaning: m, phonetic: /[<>]/.test(p) ? '' : p,
    needsReview: /[<>]/.test(p) || display === 'OHPEN',
    lexemeId: `${answerKey(answers[0])}¦${normalize(m)}`, tags
  };
}

export const chapters = Object.entries(raw).map(([id, words]) => ({
  id, group: `第 ${id.split('.')[0]} 章`,
  entries: words.map((word, index) => makeEntry(word, {chapterId: id, index}))
}));
export const vocabulary = chapters.flatMap(chapter => chapter.entries);
export const byId = new Map(vocabulary.map(entry => [entry.id, entry]));

export function isCorrect(typed, entry) {
  const key = answerKey(typed);
  return !!key && entry.answers.some(answer => answerKey(answer) === key);
}

export function shuffled(entries, random = Math.random) {
  const result = [...entries];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function spellingHint(typed, entry) {
  if (!typed.trim()) return '未作答';
  const a = answerKey(typed), b = answerKey(entry.answers[0]);
  if (a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`) return '可能是单复数差异';
  if (a.replace(/[ -]/g, '') === b.replace(/[ -]/g, '')) return '检查空格或连字符';
  return '检查拼写或词尾；错因可自行标记';
}

export function parseWordList(text, listId) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 5000) throw new Error('请粘贴 1–5000 行词条');
  return lines.map((line, index) => {
    const [word, meaning = '', phonetic = ''] = line.split(/\t|\|/).map(s => s.trim());
    return makeEntry({w: word, m: meaning, p: phonetic}, {id: `${listId}:${index + 1}`, chapterId: '个人词表', index});
  });
}
