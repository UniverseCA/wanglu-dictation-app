import { makeEntry } from '../core/vocabulary.js';

// Original practice examples, not official IELTS questions or score predictors.
const sets = [
  ['numbers', '数字与金额', '听清数量、价格与小数', [
    ['1500', '一千五百', 'fifteen hundred', ['1500', '1,500']],
    ['46', '四十六', 'forty six'], ['13.50', '十三点五零', 'thirteen pounds fifty', ['13.50', '£13.50']],
    ['380', '三百八十', 'three hundred and eighty']]],
  ['dates', '日期与时间', '辨别日期和具体时刻', [
    ['15 October', '十月十五日', 'the fifteenth of October', ['15 October', 'October 15', '15th October']],
    ['Tuesday', '星期二', 'Tuesday'], ['9:30', '九点半', 'nine thirty', ['9:30', '9.30']],
    ['21 June', '六月二十一日', 'the twenty first of June', ['21 June', 'June 21', '21st June']]]],
  ['names', '姓名拼写', '把字母听准确', [
    ['Carter', '姓氏 Carter', 'Carter. C, A, R, T, E, R.'], ['Wilson', '姓氏 Wilson', 'Wilson. W, I, L, S, O, N.'],
    ['Helen', '名字 Helen', 'Helen. H, E, L, E, N.'], ['Bennett', '姓氏 Bennett', 'Bennett. B, E, N, N, E, T, T.']]],
  ['addresses', '地址', '门牌号、街名与方位', [
    ['27 Green Road', '格林路 27 号', 'twenty seven Green Road', ['27 Green Road', '27 Green Rd']],
    ['West Street', '西街', 'West Street'], ['18 Park Lane', '公园巷 18 号', 'eighteen Park Lane'],
    ['North Avenue', '北大道', 'North Avenue']]],
  ['endings', '单复数与词尾', '留意最后的声音', [
    ['libraries', '图书馆（复数）', 'libraries'], ['facilities', '设施（复数）', 'facilities'],
    ['equipment', '设备（不可数）', 'equipment'], ['recommended', '推荐的 / recommend 的过去式', 'recommended']]],
  ['phrases', '短语', '把几个词一起记住', [
    ['reference number', '参考编号', 'reference number'], ['public transport', '公共交通', 'public transport'],
    ['annual membership', '年度会员资格', 'annual membership'], ['research assistant', '研究助理', 'research assistant']]],
  ['completion', '句子填空', '结合语境听取关键词', [
    ['library', '图书馆', 'The new library opens at nine.', null, 'The new ____ opens at nine. · ONE WORD'],
    ['Friday', '星期五', 'Please submit the form by Friday.', null, 'Please submit the form by ____. · ONE WORD'],
    ['entrance', '入口', 'Meet us at the main entrance.', null, 'Meet us at the main ____. · ONE WORD'],
    ['bicycle', '自行车', 'A bicycle is available for every visitor.', null, 'A ____ is available for every visitor. · ONE WORD']]],
  ['synonyms', '同义替换', '听到表达，回忆相同意思的词', [
    ['reduce', '减少', 'Make the amount smaller.', ['reduce', 'decrease'], '根据意思回忆：r_____ / d_______ · ONE WORD'],
    ['purchase', '购买', 'Buy something.', ['purchase'], '根据意思回忆：p_______ · ONE WORD'],
    ['nearby', '附近的', 'Not far away.', ['nearby'], '根据意思回忆：n_____ · ONE WORD'],
    ['inexpensive', '便宜的', 'Something that does not cost much.', ['inexpensive'], '根据意思回忆：i__________ · ONE WORD']]]
];

export const specialties = sets.map(([id, name, description, rows]) => ({id, name, description,
  entries: rows.map(([w, m, spoken, answers, context], index) => makeEntry({w, m, spoken, answers, context, tags: [id]}, {id: `special:${id}:${index}`, chapterId: `专项：${name}`, index}))}));
export function specialtyOptions() {return specialties.map(set => [`special:${set.id}`, `专项 · ${set.name}`]);}
export function specialtyEntries(pool) {return pool.startsWith('special:') ? specialties.find(set => set.id === pool.slice(8))?.entries || [] : null;}
