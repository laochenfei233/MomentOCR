/** 翻译目标语言的单一事实来源：设置页与主界面下拉都用这份列表 */
export const TRANSLATE_TARGETS: string[] = [
  '中文', '英文', '日文', '韩文', '法文', '德文', '俄文', '西班牙文', '葡萄牙文', '阿拉伯文',
];

/** 大模型/HY-MT 直接用中文名进提示词；只有 Google 免费接口需要语言码 */
export const GOOGLE_TARGET_CODES: Record<string, string> = {
  '中文': 'zh-CN',
  '英文': 'en',
  '日文': 'ja',
  '韩文': 'ko',
  '法文': 'fr',
  '德文': 'de',
  '俄文': 'ru',
  '西班牙文': 'es',
  '葡萄牙文': 'pt',
  '阿拉伯文': 'ar',
};
