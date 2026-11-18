/* 词哒 · SnapWord Built-in Curriculum & Fun Gadget Decks (v0.1.4)
 * Textbook alignment: 2026 Autumn Jiangsu Grade 5 Volume 1 (Units 5 & 6 verified against print p.58–81, p.111–113).
 * Unit 6 official wordlist strictly contains 24 items (19 core unstarred + 5 starred non-core).
 * Foundation review items use sourceScope: 'foundation_bridge' so unit counts stay 100% faithful to print textbook.
 */
const SNAPWORD_CURRICULUM = (() => {
  const ITEMS = [
    // ==================== Unit 5 Official Textbook Wordlist & Weekdays ====================
    {
      id: 'u5_saturday', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 58,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'Saturday', acceptedVariants: [], zh: '星期六',
      helpKind: 'spelling_focus',
      displayChunks: 'Sat ｜ ur ｜ day',
      helpNote: '整词连读听音；重点留意首字母大写 S 和中间容易漏掉的 ur。',
      bridgeNote: '星期名称首字母永远大写：Saturday（周六）。',
      snap: {
        pieces: ['Sat', 'ur', 'day'],
        decoys: [
          { text: 'sat', tip: '🎩 星期大哥出门，头顶得戴大写礼帽 S 哦！' },
          { text: 'er', tip: '🔎 再看一眼中间那块，周六藏的是 u-r！' }
        ]
      },
      cloze: { prefix: 'Sat', blank: 'ur', suffix: 'day', hint: '补上中间容易漏写的两个字母' },
      sentencePrompt: { template: 'I usually play football on ______.', zh: '我通常在星期六踢足球。', expected: 'Saturday' },
      context: { en: 'I usually play football on Saturday.', zh: '我通常在星期六踢足球。', origin: '家庭练习句' }
    },
    {
      id: 'u5_sunday', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 58,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'Sunday', acceptedVariants: [], zh: '星期日',
      helpKind: 'morphology',
      displayChunks: 'Sun + day',
      helpNote: '太阳 Sun（u 发 /ʌ/，别按拼音写成 a）＋ day；首字母大写 S。',
      bridgeNote: '对比记忆：Sunday（单指星期日） → on Sundays（每逢星期日，词尾加 s）。',
      snap: {
        pieces: ['Sun', 'day'],
        decoys: [
          { text: 'san', tip: '☀️ 星期日是太阳 Sun (S-u-n)，大写 S 加字母 u！' },
          { text: 'sun', tip: '🎩 别忘了给星期日戴上大写礼帽 S！' }
        ]
      },
      cloze: { prefix: '', blank: 'Sun', suffix: 'day', hint: '注意首字母大写和中间的元音字母 u' },
      sentencePrompt: { template: 'We visit my grandparents on ______.', zh: '我们在星期日看望祖父母。（填单数星期名）', expected: 'Sunday' },
      context: { en: 'We visit my grandparents on Sundays.', zh: '我们每逢星期日看望祖父母。', origin: '家庭练习句' }
    },
    {
      id: 'u5_tuesday', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 58,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'Tuesday', acceptedVariants: [], zh: '星期二',
      helpKind: 'spelling_focus', displayChunks: 'Tues ｜ day',
      helpNote: '首字母大写 T，注意 Tues 结尾有 s，与星期四 Thursday 区分。',
      bridgeNote: '对比：Tuesday（周二，Tues-） vs Thursday（周四，Thurs-）。',
      snap: { pieces: ['Tues', 'day'], decoys: [{ text: 'tues', tip: '🎩 星期词首字母要大写 T！' }, { text: 'Thur', tip: '📅 带 r 的是周四 Thursday，周二是 Tues-day！' }] },
      cloze: { prefix: '', blank: 'Tues', suffix: 'day', hint: '周二前四位字母（首字母大写，别漏 s）' },
      sentencePrompt: { template: 'We have English on ______.', zh: '我们在星期二有英语课。', expected: 'Tuesday' },
      context: { en: 'We have English on Tuesday.', zh: '我们在星期二有英语课。', origin: '家庭练习句' }
    },
    {
      id: 'u5_wednesday', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 58,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'Wednesday', acceptedVariants: [], zh: '星期三',
      helpKind: 'spelling_focus', displayChunks: 'Wed ｜ nes ｜ day',
      helpNote: '整词读 /ˈwenzdeɪ/，虽然 d 不发音，但拼写藏着 Wed + nes + day 三块！',
      bridgeNote: '拼写口诀：Wed-nes-day，别漏掉不吭声的 d 和中间的 nes。',
      snap: { pieces: ['Wed', 'nes', 'day'], decoys: [{ text: 'Wen', tip: '🤫 星期三藏着一个安静不发音的字母 d：W-e-d！' }, { text: 'ens', tip: '🧩 中间那块是 n-e-s 哦！' }] },
      cloze: { prefix: 'Wed', blank: 'nes', suffix: 'day', hint: '补全周三中间的三个字母' },
      sentencePrompt: { template: 'I play ping-pong on ______.', zh: '我在星期三打乒乓球。', expected: 'Wednesday' },
      context: { en: 'I play ping-pong on Wednesday.', zh: '我在星期三打乒乓球。', origin: '家庭练习句' }
    },
    {
      id: 'u5_thursday', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 58,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'Thursday', acceptedVariants: [], zh: '星期四',
      helpKind: 'spelling_focus', displayChunks: 'Thurs ｜ day',
      helpNote: '咬舌音 Th 开头（大写 T）＋ ur ＋ s ＋ day。',
      bridgeNote: '和周六一样中间藏着 ur：Thurs-day / Sat-ur-day。',
      snap: { pieces: ['Th', 'urs', 'day'], decoys: [{ text: 'Tues', tip: '📅 Tues 是周二，周四开头咬舌尖 Th-urs-day！' }] },
      cloze: { prefix: 'Th', blank: 'urs', suffix: 'day', hint: '补全中间三个字母 u-r-s' },
      sentencePrompt: { template: 'She dances on ______ afternoon.', zh: '她在星期四下午跳舞。', expected: 'Thursday' },
      context: { en: 'She dances on Thursday afternoon.', zh: '她在星期四下午跳舞。', origin: '家庭练习句' }
    },
    {
      id: 'u5_always', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 60,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'always', acceptedVariants: [], zh: '总是，每次都是',
      helpKind: 'spelling_focus', displayChunks: 'al ｜ ways',
      helpNote: '开头只有一个 l（al-），后面是 ways（路/方式，带 s）。',
      bridgeNote: '频度排第一（100%）：always > usually > often > sometimes > never。',
      snap: { pieces: ['al', 'ways'], decoys: [{ text: 'all', tip: '✂️ all 进入 always 时要瘦身减掉一个 l，变成 al-ways！' }, { text: 'way', tip: '✨ 尾巴上还有一个 s 哦：always！' }] },
      cloze: { prefix: '', blank: 'al', suffix: 'ways', hint: '开头两个字母（只有一个 l）' },
      sentencePrompt: { template: 'He ______ takes notes in class.', zh: '他总是在课堂上记笔记。', expected: 'always' },
      context: { en: 'He always takes notes in class.', zh: '他总是在课堂上记笔记。', origin: '家庭练习句' }
    },
    {
      id: 'u5_usually', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 63,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'usually', acceptedVariants: [], zh: '通常地，一般地',
      helpKind: 'spelling_focus', displayChunks: 'u ｜ su ｜ al ｜ ly',
      helpNote: '整词听读，留意结尾是 al + ly（总共两个 l）。',
      bridgeNote: '在句子里放在主语后、实义动词前：I usually read books.',
      snap: { pieces: ['u', 'su', 'ally'], decoys: [{ text: 'aly', tip: '👯 尾巴上有两个并排的 l：-ally！' }] },
      cloze: { prefix: 'usu', blank: 'ally', suffix: '', hint: '补全结尾四个字母（两个 l）' },
      sentencePrompt: { template: 'I ______ visit my grandparents at weekends.', zh: '我通常在周末看望祖父母。', expected: 'usually' },
      context: { en: 'I usually visit my grandparents at weekends.', zh: '我通常在周末看望祖父母。', origin: '家庭练习句' }
    },
    {
      id: 'u5_sometimes', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 63,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'word', en: 'sometimes', acceptedVariants: [], zh: '有时',
      helpKind: 'morphology',
      displayChunks: 'some + time + s',
      helpNote: '全词共两个音节；拼写用“一些 some ＋ 时间 time ＋ 尾巴 s”记最稳（别漏掉 some 里的 e）。',
      bridgeNote: '巧合彩蛋：some (U6 p.73) 和 time (U6 p.79) 都是第六单元核心词！',
      snap: {
        pieces: ['some', 'time', 's'],
        decoys: [
          { text: 'som', tip: '🧩 一些是 s-o-m-e，尾巴上有个不吭声的 e！' },
          { text: 'timey', tip: '⏱️ 时间是 t-i-m-e，后面直接加 s 就好啦！' }
        ]
      },
      cloze: { prefix: '', blank: 'some', suffix: 'times', hint: '前半截是“一些 ____”（4个字母，别漏 e）' },
      sentencePrompt: { template: 'I ______ fly a kite in the park.', zh: '我有时在公园里放风筝。', expected: 'sometimes' },
      context: { en: 'Sometimes we fly a kite in the park.', zh: '有时我们在公园里放风筝。', origin: '家庭练习句' }
    },
    {
      id: 'u5_have_a_picnic', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 61,
      textbookCore: false, classRequirement: 'dictation_verified',
      type: 'phrase', en: 'have a picnic', acceptedVariants: [], zh: '野餐',
      helpKind: 'word_boundary',
      displayChunks: 'have ␣ a ␣ pic·nic',
      helpNote: '三个独立的词，纸上写时词与词之间要留出空格；野餐固定搭配用 have a picnic。',
      bridgeNote: '搭配提醒：去野餐说 have a picnic（不用 go to the picnic）。',
      snap: {
        pieces: ['have', '␣', 'a', '␣', 'picnic'],
        decoys: [
          { text: 'go', tip: '🧺 野餐在课本里的固定搭档是 have a picnic 哦！' },
          { text: 'the', tip: '🍎 中间是 have a picnic！' }
        ]
      },
      cloze: { prefix: 'have a ', blank: 'picnic', suffix: '', hint: '拼出“野餐” p-i-c-n-i-c' },
      sentencePrompt: { template: "Why don't we ______ here?", zh: '我们为什么不在这儿野餐呢？', expected: 'have a picnic' },
      context: { en: "Why don't we have a picnic here?", zh: '我们为什么不在这儿野餐呢？', origin: '教材五上 U6 p.72' }
    },
    {
      id: 'u5_play_the_piano', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 59,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'phrase', en: 'play the piano', acceptedVariants: [], zh: '弹钢琴',
      helpKind: 'word_boundary', displayChunks: 'play ␣ the ␣ pi·a·no',
      helpNote: '西洋乐器前面一定要带上小跟班 the！三个词之间留空格。',
      bridgeNote: '对比：球类棋类不加 the（play football / play Chinese chess），乐器加 the（play the piano）。',
      snap: { pieces: ['play', '␣', 'the', '␣', 'piano'], decoys: [{ text: 'a', tip: '🎹 弹西洋乐器中间固定用 the，不是 a 哦！' }] },
      cloze: { prefix: 'play ', blank: 'the piano', suffix: '', hint: '别忘了乐器前的冠词 the' },
      sentencePrompt: { template: 'Can you ______?', zh: '你会弹钢琴吗？', expected: 'play the piano' },
      context: { en: 'She likes playing the piano.', zh: '她喜欢弹钢琴。', origin: '家庭练习句' }
    },
    {
      id: 'u5_chat_internet', version: 1, unit: 5, sourceScope: 'textbook_wordlist', bookPage: 59,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'phrase', en: 'chat on the internet', acceptedVariants: ['chat on the Internet'], zh: '在网上聊天',
      helpKind: 'word_boundary', displayChunks: 'chat ␣ on ␣ the ␣ in·ter·net',
      helpNote: '先有动词 chat（聊天），“在网上”介词用 on（不用 in）！',
      bridgeNote: '2026 江苏五上词表 p.111 小写 internet，大写 Internet 也算对。',
      snap: { pieces: ['chat', '␣', 'on', '␣', 'the', '␣', 'internet'], decoys: [{ text: 'in', tip: '🌐 在网上、在电视上都用介词 on，不用 in 哦！' }] },
      cloze: { prefix: '', blank: 'chat on', suffix: ' the internet', hint: '动词“聊天”＋介词“在……上”' },
      sentencePrompt: { template: 'They sometimes ______.', zh: '他们有时在网上聊天。', expected: 'chat on the internet' },
      context: { en: 'They sometimes chat on the internet.', zh: '他们有时在网上聊天。', origin: '家庭练习句' }
    },

    // ==================== Foundation Bridge Extension Pool (sourceScope: 'foundation_bridge') ====================
    {
      id: 'fnd_morning', version: 1, unit: 0, sourceScope: 'foundation_bridge', bookPage: null,
      textbookCore: false, classRequirement: 'unverified_family',
      type: 'word', en: 'morning', acceptedVariants: [], zh: '早晨；上午',
      helpKind: 'spelling_focus',
      displayChunks: 'mor ｜ ning',
      helpNote: '整词听读，留意前一半里的字母组合 or，别漏掉 r。',
      bridgeNote: '常见搭配：on Saturday morning（在周六上午，具体某天上午用 on）。',
      snap: {
        pieces: ['mor', 'ning'],
        decoys: [
          { text: 'mo', tip: '⏰ 少了字母 r 啦，m-o-r 才完整！' },
          { text: 'in', tip: '🔔 结尾是 -ning 哦！' }
        ]
      },
      cloze: { prefix: 'm', blank: 'or', suffix: 'ning', hint: '补全中间的字母组合（别漏 r）' },
      sentencePrompt: { template: 'I read books on Sunday ______.', zh: '我在星期日上午读书。', expected: 'morning' },
      context: { en: 'I read books on Sunday morning.', zh: '我在星期日上午读书。', origin: '家庭练习句' }
    },
    {
      id: 'fnd_homework', version: 1, unit: 0, sourceScope: 'foundation_bridge', bookPage: null,
      textbookCore: false, classRequirement: 'unverified_family',
      type: 'word', en: 'homework', acceptedVariants: [], zh: '家庭作业（单字）',
      helpKind: 'morphology',
      displayChunks: 'home + work',
      helpNote: '构词记忆：home（家）＋ work（工作/作业），合起来连写不留空格。',
      bridgeNote: '词义区分：work（工作/作业，w-o-r-k） ≠ walk（走路，w-a-l-k，U4 p.50）。',
      snap: {
        pieces: ['home', 'work'],
        decoys: [
          { text: 'walk', tip: '🚶 walk 是去散步走路，做作业要找 work (w-o-r-k)！' },
          { text: 'wrok', tip: '🔧 字母顺序是 w-o-r-k 哟！' }
        ]
      },
      cloze: { prefix: 'home', blank: 'work', suffix: '', hint: '家 home + 作业 ____（别写成走路 walk）' },
      sentencePrompt: { template: 'I always do my ______ first.', zh: '我总是先做我的家庭作业。', expected: 'homework' },
      context: { en: 'I always do my homework first.', zh: '我总是先做我的家庭作业。', origin: '家庭练习句' }
    },
    {
      id: 'fnd_football', version: 1, unit: 0, sourceScope: 'foundation_bridge', bookPage: null,
      textbookCore: false, classRequirement: 'unverified_family',
      type: 'word', en: 'football', acceptedVariants: [], zh: '足球',
      helpKind: 'morphology',
      displayChunks: 'foot + ball',
      helpNote: '构词记忆：foot（脚）＋ ball（球），中间连写不空格。',
      bridgeNote: '同类词串记：ball（球） → wall（墙，U6 p.70） → football（足球）。',
      snap: {
        pieces: ['foot', 'ball'],
        decoys: [
          { text: 'bool', tip: '⚽ 球是 ball (b-a-l-l)，不是 bool 哦！' },
          { text: 'bell', tip: '🔔 bell 是铃铛，球是 b-a-l-l！' }
        ]
      },
      cloze: { prefix: 'foot', blank: 'ball', suffix: '', hint: '脚 foot + 球 ____（注意是 a-l-l）' },
      sentencePrompt: { template: 'He plays ______ after school.', zh: '他放学后踢足球。', expected: 'football' },
      context: { en: 'He plays football after school.', zh: '他放学后踢足球。', origin: '家庭练习句' }
    },
    {
      id: 'fnd_with', version: 1, unit: 0, sourceScope: 'foundation_bridge', bookPage: null,
      textbookCore: false, classRequirement: 'unverified_family',
      type: 'word', en: 'with', acceptedVariants: [], zh: '和……一起',
      helpKind: 'spelling_focus',
      displayChunks: 'wi ｜ th',
      helpNote: '标准读音 /wɪð/ 或 /wɪθ/，结尾是咬舌字母组合 th，表示“和谁一起”。',
      bridgeNote: '句子用词区分：play football with my friends（和朋友一起，不用 was）。',
      snap: {
        pieces: ['wi', 'th'],
        decoys: [
          { text: 'was', tip: '🤝 表示“和朋友一起”要用 with，was 是“过去是”哦！' },
          { text: 'sh', tip: '👅 结尾是咬舌尖的 t-h！' }
        ]
      },
      cloze: { prefix: 'wi', blank: 'th', suffix: '', hint: '补全结尾两个字母' },
      sentencePrompt: { template: 'I play football ______ my friends.', zh: '我和我的朋友们一起踢足球。', expected: 'with' },
      context: { en: 'I play football with my friends.', zh: '我和我的朋友们一起踢足球。', origin: '家庭练习句' }
    },
    {
      id: 'fnd_stay_up_late', version: 1, unit: 0, sourceScope: 'foundation_bridge', bookPage: 14,
      textbookCore: false, classRequirement: 'unverified_family',
      type: 'phrase', en: 'stay up late', acceptedVariants: [], zh: '熬夜；很晚睡',
      helpKind: 'word_boundary',
      displayChunks: 'stay ␣ up ␣ late',
      helpNote: '三个独立的词！尤其注意 up 和 late 中间一定要留出空格，不能连成 uplate。',
      bridgeNote: '好习惯表达：I never stay up late.（我从不熬夜。）',
      snap: {
        pieces: ['stay', '␣', 'up', '␣', 'late'],
        decoys: [
          { text: 'uplate', tip: '✂️ up 和 late 是两个词，中间必须留出呼吸空格 ␣！' }
        ]
      },
      cloze: { prefix: 'stay ', blank: 'up late', suffix: '', hint: '两个词，记得中间敲一个空格' },
      sentencePrompt: { template: 'I never ______.', zh: '我从不熬夜。', expected: 'stay up late' },
      context: { en: 'I never stay up late.', zh: '我从不熬夜。', origin: '家庭练习句' }
    },

    // ==================== Unit 6 Official 24 Items (Print p.70–79, Wordlist p.111–112: 19 Core + 5 Starred) ====================
    // --- Get ready (p.70–71) ---
    {
      id: 'u6_get_along_with', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 70,
      textbookCore: false, classRequirement: 'read_meaning_use',
      type: 'phrase', en: 'get along with', acceptedVariants: [], zh: '与……和睦相处',
      helpKind: 'word_boundary', displayChunks: 'get ␣ a·long ␣ with',
      helpNote: '单元标题短语（教材带 * 词）：三个词留清空格，结尾用 with（和……一起）。',
      bridgeNote: '单元大问题：How can you get along well with others?',
      snap: { pieces: ['get', '␣', 'along', '␣', 'with'], decoys: [{ text: 'was', tip: '🤝 和别人相处要用 with！' }] },
      cloze: { prefix: 'get ', blank: 'along with', suffix: '', hint: 'a-l-o-n-g 空格 w-i-t-h' },
      sentencePrompt: { template: 'We should ______ each other.', zh: '我们应该彼此和睦相处。', expected: 'get along with' },
      context: { en: 'How can you get along well with others?', zh: '你怎样才能和他人和睦相处？', origin: '教材五上 U6 p.71' }
    },
    {
      id: 'u6_between', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 70,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'between', acceptedVariants: [], zh: '在……中间，介于……之间',
      helpKind: 'spelling_focus', displayChunks: 'be ｜ tween',
      helpNote: '前面是熟悉的 be，后面 tween 中间有两个 e（ee 发长音 /iː/）。',
      bridgeNote: '搭配：between their houses（在他们两家房子中间）。',
      snap: { pieces: ['be', 'tw', 'een'], decoys: [{ text: 'ea', tip: '👀 between 里面藏着双胞胎字母 e-e！' }, { text: 'bi', tip: '🐝 开头是 b-e 哦！' }] },
      cloze: { prefix: 'be', blank: 'tween', suffix: '', hint: 't-w 加双胞胎 e-e 再加 n' },
      sentencePrompt: { template: 'There is a space ______ two houses.', zh: '两栋房子中间有一块空地。', expected: 'between' },
      context: { en: 'There is a narrow space between two houses.', zh: '两栋房子中间有一块窄空地。', origin: '改编自教材 p.70/75' }
    },
    {
      id: 'u6_wall', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 70,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'wall', acceptedVariants: [], zh: '围墙；墙，壁',
      helpKind: 'morphology', displayChunks: 'w + all',
      helpNote: 'w ＋ all（全部），四个字母一气呵成。',
      bridgeNote: '同类词类比：ball（球） → wall（墙） → football（足球）。',
      snap: { pieces: ['w', 'all'], decoys: [{ text: 'ool', tip: '🧱 墙和球一样，尾巴都是 a-l-l！' }, { text: 'al', tip: '🧱 尾巴有两个 l：w-a-l-l！' }] },
      cloze: { prefix: 'w', blank: 'all', suffix: '', hint: '和 ball（球）拥有相同的后三个字母' },
      sentencePrompt: { template: 'A ______ is not important.', zh: '一堵墙并不重要。', expected: 'wall' },
      context: { en: 'A wall is not important. We should be friendly.', zh: '一堵墙并不重要，我们应该友好相处。', origin: '教材五上 U6 p.76' }
    },
    {
      id: 'u6_neighbour', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 70,
      textbookCore: false, classRequirement: 'read_meaning_use',
      type: 'word', en: 'neighbour', usVariant: 'neighbor', acceptedVariants: [], zh: '邻居，邻人',
      helpKind: 'spelling_focus', displayChunks: 'neigh ｜ bour',
      helpNote: '教材带 * 词（先保听读认义）：前半 neigh，后半英式 -bour（美式 neighbor）。',
      bridgeNote: '六尺巷主旨：become good neighbours（成为好邻居）。',
      snap: { pieces: ['neigh', 'bour'], decoys: [{ text: 'niegh', tip: '🏡 这词比较特殊，是 e-i-g-h 开头哦！' }] },
      cloze: { prefix: 'neigh', blank: 'bour', suffix: '', hint: '补全英式词尾 b-o-u-r' },
      sentencePrompt: { template: 'Mr Green is our friendly ______.', zh: '格林先生是我们友好的邻居。', expected: 'neighbour' },
      context: { en: 'The two families become good neighbours.', zh: '两家人成为了好邻居。', origin: '改编自教材 p.76' }
    },

    // --- Cartoon time & Sounds in focus (p.72–74) ---
    {
      id: 'u6_heavy', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 72,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'heavy', acceptedVariants: [], zh: '重的，沉的',
      helpKind: 'spelling_focus', displayChunks: 'hea ｜ vy',
      helpNote: '整词读 /ˈhevi/，注意中间是字母组合 ea（发短音 /e/，别漏掉 a）。',
      bridgeNote: '反义联系：heavy（重的） ↔ light（轻的）。',
      snap: { pieces: ['h', 'ea', 'vy'], decoys: [{ text: 'e', tip: '🎒 包太重啦，里面装了 e 和 a 两个元音字母：h-e-a-v-y！' }] },
      cloze: { prefix: 'h', blank: 'ea', suffix: 'vy', hint: '中间是两个元音字母组合 e-a' },
      sentencePrompt: { template: 'My bag is so ______.', zh: '我的包太重了。', expected: 'heavy' },
      context: { en: 'My bag is so heavy.', zh: '我的包太重了。', origin: '教材五上 U6 p.72' }
    },
    {
      id: 'u6_drink', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 72,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'drink', acceptedVariants: [], zh: '喝，饮',
      helpKind: 'spelling_focus', displayChunks: 'dr ｜ ink',
      helpNote: 'U6 p.74 重点语音词：辅音连缀 dr- ＋ ink。',
      bridgeNote: 'dr 语音组（p.74）：drink、dress、drawing、children（词中也有 dr！）。',
      snap: { pieces: ['dr', 'ink'], decoys: [{ text: 'tr', tip: '🥤 喝水开头是浊音 d-r (drink)，不是 t-r 哦！' }] },
      cloze: { prefix: '', blank: 'dr', suffix: 'ink', hint: '本单元重点学习的两个辅音字母组合' },
      sentencePrompt: { template: 'I want to ______ some water.', zh: '我想喝点水。', expected: 'drink' },
      context: { en: 'I want to drink some water.', zh: '我想喝点水。', origin: '教材五上 U6 p.72' }
    },
    {
      id: 'u6_some', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 73,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'some', acceptedVariants: [], zh: '有些事物，有些人；一些',
      helpKind: 'spelling_focus', displayChunks: 's ｜ ome',
      helpNote: '四个字母 s-o-m-e，词尾的 e 不发音但千万不能漏。',
      bridgeNote: '构词串联：some（一些）＋ time（时间）＋ s ＝ sometimes（有时）。',
      snap: { pieces: ['so', 'me'], decoys: [{ text: 'sam', tip: '🍰 一些是 s-o-m-e 哦！' }] },
      cloze: { prefix: 's', blank: 'ome', suffix: '', hint: '后三个字母是 o-m-e' },
      sentencePrompt: { template: 'You can have ______ of my food.', zh: '你可以吃一些我的食物。', expected: 'some' },
      context: { en: 'You can have some of my food.', zh: '你可以吃一些我的食物。', origin: '教材五上 U6 p.73' }
    },
    {
      id: 'u6_way_back', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 73,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'phrase', en: "on one's way back", acceptedVariants: [],
      contextVariants: ['on their way back', 'on my way back', 'on his way back', 'on her way back'],
      zh: '在某人回去的路上',
      helpKind: 'word_boundary', displayChunks: "on ␣ one's ␣ way ␣ back",
      helpNote: "词表原形为 on one's way back；在具体句子中把 one's 换成 their / my / his 等人称。",
      bridgeNote: '课本原句：Bobby, Sam and Billy are on their way back. (p.73)',
      snap: { pieces: ['on', '␣', "one's", '␣', 'way', '␣', 'back'], decoys: [{ text: 'in', tip: '🛣️ 在路上介词用 on 哦！' }] },
      cloze: { prefix: 'on their ', blank: 'way back', suffix: '', hint: '回去的路：w-a-y 空格 b-a-c-k' },
      sentencePrompt: { template: 'Bobby, Sam and Billy are ______.', zh: 'Bobby、Sam 和 Billy 在他们回去的路上。', expected: 'on their way back' },
      sentenceVariants: [
        { key: 'their', label: '第三人称复数 (their)', template: 'Bobby, Sam and Billy are ______.', zh: 'Bobby、Sam 和 Billy 在他们回去的路上。', expected: 'on their way back', chunks: 'on ␣ their ␣ way ␣ back' },
        { key: 'my', label: '第一人称 (my)', template: 'I meet my friend ______.', zh: '我在我回去的路上遇到了朋友。', expected: 'on my way back', chunks: 'on ␣ my ␣ way ␣ back' }
      ],
      context: { en: 'Bobby, Sam and Billy are on their way back.', zh: 'Bobby、Sam 和 Billy 在他们回去的路上。', origin: '教材五上 U6 p.73' }
    },

    // --- Story time: Liu Chi Xiang (p.75–77) ---
    {
      id: 'u6_next_to', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'phrase', en: 'next to', acceptedVariants: [], zh: '紧邻，在……近旁',
      helpKind: 'word_boundary', displayChunks: 'next ␣ to',
      helpNote: '两个词中间留空格：next（紧接着）＋ to。',
      bridgeNote: '位置短语对比：next to（紧挨着） vs between（在两者中间）。',
      snap: { pieces: ['next', '␣', 'to'], decoys: [{ text: 'too', tip: '📍 紧挨着是 next to（一个 o），too（两个 o）是“太/也”！' }] },
      cloze: { prefix: '', blank: 'next', suffix: ' to', hint: 'n-e-x-t' },
      sentencePrompt: { template: 'The Wu family live ______ the Zhang family.', zh: '吴家住在张家隔壁。', expected: 'next to' },
      context: { en: 'The Wu family live next to the Zhang family.', zh: '吴家住在张家隔壁。', origin: '教材五上 U6 p.75' }
    },
    {
      id: 'u6_space', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'space', acceptedVariants: [], zh: '空地，空间',
      helpKind: 'spelling_focus', displayChunks: 'sp ｜ ace',
      helpNote: 'a-c-e 结构，a 读 /eɪ/，c 在 e 前发 /s/，词尾 e 不发音。',
      bridgeNote: '同类词：face（脸） → place（地方） → space（空地）。',
      snap: { pieces: ['sp', 'ace'], decoys: [{ text: 'ase', tip: '🌌 空地 s-p-a-c-e 里藏着字母 c，和 face（脸）一样！' }] },
      cloze: { prefix: 'sp', blank: 'ace', suffix: '', hint: '和 face 后三个字母一样' },
      sentencePrompt: { template: 'You can use the ______.', zh: '你们可以使用这块空地。', expected: 'space' },
      context: { en: 'You can use the space.', zh: '你们可以使用这块空地。', origin: '教材五上 U6 p.76' }
    },
    {
      id: 'u6_their', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'their', acceptedVariants: [], zh: '他们的，她们的，它们的',
      helpKind: 'spelling_focus', displayChunks: 'th ｜ eir',
      helpNote: 'the 后面加上 i-r 就是“他们的” their。',
      bridgeNote: '区分：their houses（他们的房子） vs there（那里）。',
      snap: { pieces: ['the', 'ir'], decoys: [{ text: 're', tip: '🏠 there 是“那里”，表示“他们的房子”要用 t-h-e-i-r！' }] },
      cloze: { prefix: 'the', blank: 'ir', suffix: '', hint: 'the 后面补上两个字母表示“他们的”' },
      sentencePrompt: { template: 'The space is between ______ houses.', zh: '空地在他们两家的房子之间。', expected: 'their' },
      context: { en: 'There is a space between their houses.', zh: '他们两家房子之间有一块空地。', origin: '改编自教材 p.75' }
    },
    {
      id: 'u6_too', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'too', acceptedVariants: [], zh: '太，过于',
      helpKind: 'spelling_focus', displayChunks: 't ｜ oo',
      helpNote: 't 后面跟两个圆圆的 o：too close to（离……太近了）。',
      bridgeNote: '区分：too（太/也，两个 o） vs to（向/到，一个 o）。',
      snap: { pieces: ['t', 'oo'], decoys: [{ text: 'o', tip: '👀 表示“太近了 / 我也是”要有两个圆圆的 o：t-o-o！' }] },
      cloze: { prefix: 't', blank: 'oo', suffix: '', hint: '两个相同的元音字母' },
      sentencePrompt: { template: 'Your house is ______ close to our house!', zh: '你们的房子离我们的房子太近了！', expected: 'too' },
      context: { en: 'Your house is too close to our house!', zh: '你们的房子离我们的房子太近了！', origin: '教材五上 U6 p.75' }
    },
    {
      id: 'u6_close_to', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'phrase', en: 'close to', acceptedVariants: [], zh: '接近',
      helpKind: 'word_boundary', displayChunks: 'close ␣ to',
      helpNote: 'close（接近，读 /kləʊs/）＋ 空格 ＋ to。',
      bridgeNote: '常与 too 连用：too close to our house（离我们家太近）。',
      snap: { pieces: ['close', '␣', 'to'], decoys: [{ text: 'too', tip: '📏 靠近某处后面跟介词 to（一个 o）！' }] },
      cloze: { prefix: '', blank: 'close', suffix: ' to', hint: 'c-l-o-s-e' },
      sentencePrompt: { template: 'My school is ______ my home.', zh: '我的学校离我家很近。', expected: 'close to' },
      context: { en: 'Do not stand too close to the river.', zh: '不要站得离河边太近。', origin: '家庭练习句' }
    },
    {
      id: 'u6_use', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'use', acceptedVariants: [], zh: '使用，利用',
      helpKind: 'spelling_focus', displayChunks: 'u ｜ se',
      helpNote: 'u-s-e，字母 u 读 /juː/，词尾不发音的 e 不能漏。',
      bridgeNote: '情态动词后跟原形：can use / shouldn’t use。',
      snap: { pieces: ['u', 'se'], decoys: [{ text: 'us', tip: '🔧 us 是“我们”，使用需要在尾巴加上不发音的 e：u-s-e！' }] },
      cloze: { prefix: '', blank: 'use', suffix: '', hint: '三个字母 u-s-e' },
      sentencePrompt: { template: 'Can I ______ your pen?', zh: '我可以用一下你的钢笔吗？', expected: 'use' },
      context: { en: 'Can I use your ruler?', zh: '我可以用一下你的尺子吗？', origin: '家庭练习句' }
    },
    {
      id: 'u6_letter', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'letter', acceptedVariants: [], zh: '信，函',
      helpKind: 'spelling_focus', displayChunks: 'let ｜ ter',
      helpNote: '中间是双写字母 tt，结尾是 er：let + ter。',
      bridgeNote: '搭配：write a letter to...（给……写一封信）。',
      snap: { pieces: ['let', 'ter'], decoys: [{ text: 'er', tip: '✉️ 信封中间有两个 t：let-ter！' }] },
      cloze: { prefix: 'le', blank: 'tt', suffix: 'er', hint: '中间双写哪两个辅音字母？' },
      sentencePrompt: { template: "Why don't we write a ______ to him?", zh: '我们为什么不给他写封信呢？', expected: 'letter' },
      context: { en: "Why don't we write a letter to Zhang Ying?", zh: '我们为什么不给张英写封信呢？', origin: '教材五上 U6 p.75' }
    },
    {
      id: 'u6_advice', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 75,
      textbookCore: false, classRequirement: 'read_meaning_use',
      type: 'word', en: 'advice', acceptedVariants: [], zh: '建议',
      helpKind: 'spelling_focus', displayChunks: 'ad ｜ vice',
      helpNote: '教材带 * 词：ad ＋ vice（c 发 /s/），不可数名词，不加 s。',
      bridgeNote: '搭配：give good advice（给出好建议）。',
      snap: { pieces: ['ad', 'vice'], decoys: [{ text: 'vise', tip: '💡 名词“建议”里面是字母 c：ad-v-i-c-e！' }] },
      cloze: { prefix: 'ad', blank: 'vice', suffix: '', hint: 'v-i-c-e' },
      sentencePrompt: { template: 'He can give good ______.', zh: '他能给出好建议。', expected: 'advice' },
      context: { en: 'He can give good advice.', zh: '他能给出好建议。', origin: '教材五上 U6 p.75' }
    },
    {
      id: 'u6_important', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 76,
      textbookCore: false, classRequirement: 'read_meaning_use',
      type: 'word', en: 'important', acceptedVariants: [], zh: '重要的',
      helpKind: 'spelling_focus', displayChunks: 'im ｜ por ｜ tant',
      helpNote: '教材带 * 词：三段好记 im + por + tant（结尾是 -ant）。',
      bridgeNote: '六尺巷名句：A wall is not important.（一堵墙并不重要。）',
      snap: { pieces: ['im', 'por', 'tant'], decoys: [{ text: 'tent', tip: '⭐ 结尾藏着小蚂蚁 ant：im-por-tant！' }] },
      cloze: { prefix: 'im', blank: 'por', suffix: 'tant', hint: '中间三个字母 p-o-r' },
      sentencePrompt: { template: 'Being friendly is very ______.', zh: '友好待人非常重要。', expected: 'important' },
      context: { en: 'A wall is not important.', zh: '一堵墙并不重要。', origin: '教材五上 U6 p.76' }
    },
    {
      id: 'u6_friendly', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 76,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'friendly', acceptedVariants: [], zh: '友好的，友爱的',
      helpKind: 'morphology', displayChunks: 'friend + ly',
      helpNote: '先把词根 friend（朋友，注意中间字母组合 i-e）记牢，尾巴加 -ly 变成“友好的”。',
      bridgeNote: '一箭双雕：记熟 friend，复数加 s 是 friends，形容词加 ly 是 friendly！',
      snap: { pieces: ['fr', 'ie', 'nd', 'ly'], decoys: [{ text: 'i', tip: '🧑‍🤝‍🧑 朋友 friend 中间是 i 和 e 手拉手：f-r-i-e-n-d！' }, { text: 'ei', tip: '🧑‍🤝‍🧑 顺序是 i 在前、e 在后：f-r-i-e-n-d！' }] },
      cloze: { prefix: 'fr', blank: 'ie', suffix: 'ndly', hint: '补全 friend 中间的两个元音字母组合' },
      sentencePrompt: { template: 'We should be ______ to others.', zh: '我们应该对他人友好。', expected: 'friendly' },
      context: { en: 'We should be friendly.', zh: '我们应该友好待人。', origin: '教材五上 U6 p.76' }
    },

    // --- Grammar time (p.78–79) ---
    {
      id: 'u6_then', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 78,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'then', acceptedVariants: [], zh: '到那时，当时',
      helpKind: 'spelling_focus', displayChunks: 'th ｜ en',
      helpNote: '咬舌音 th ＋ en（区别于 than）。',
      bridgeNote: '日常告别常用：See you then!（到时候见！）',
      snap: { pieces: ['th', 'en'], decoys: [{ text: 'an', tip: '👋 到时候见是 t-h-e-n (then) 哦！' }] },
      cloze: { prefix: 'th', blank: 'en', suffix: '', hint: '结尾两个字母 e-n' },
      sentencePrompt: { template: 'Good. See you ______!', zh: '好的，到时候见！', expected: 'then' },
      context: { en: 'See you then!', zh: '到时候见！', origin: '教材五上 U6 p.78' }
    },
    {
      id: 'u6_time', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 79,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'time', acceptedVariants: [], zh: '时候；时间',
      helpKind: 'spelling_focus', displayChunks: 't ｜ ime',
      helpNote: 't-i-m-e，词尾不发音 e 让中间 i 读 /aɪ/。',
      bridgeNote: '串联：have time（有空） / at that time（在那时） / sometimes（有时）。',
      snap: { pieces: ['ti', 'me'], decoys: [{ text: 'tim', tip: '⏰ 时间 t-i-m-e 尾巴上有不发音的 e！' }] },
      cloze: { prefix: 't', blank: 'ime', suffix: '', hint: 'i-m-e' },
      sentencePrompt: { template: "Sorry, I don't have ______ today.", zh: '抱歉，我今天没有时间。', expected: 'time' },
      context: { en: "Sorry, I don't have time today.", zh: '抱歉，我今天没空。', origin: '教材五上 U6 p.79' }
    },
    {
      id: 'u6_favourite', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 79,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'favourite', usVariant: 'favorite', acceptedVariants: [], zh: '特别喜爱的',
      helpKind: 'spelling_focus', displayChunks: 'fa ｜ vour ｜ ite',
      helpNote: '整词先听熟 /ˈfeɪvərɪt/；江苏教材主用英式 favourite（重点留意 our；课本同时附注美式 favorite）。',
      bridgeNote: '搭配：your favourite pen（你特别喜爱的钢笔，p.79）。',
      snap: { pieces: ['fav', 'our', 'ite'], decoys: [{ text: 'er', tip: '🌟 英式拼写中间藏着 o-u-r：fav-our-ite！' }] },
      cloze: { prefix: 'fav', blank: 'our', suffix: 'ite', hint: '按江苏课本英式拼写，中间三个字母是 o-u-r' },
      sentencePrompt: { template: 'He uses my ______ pen.', zh: '他用了我特别喜爱的钢笔。', expected: 'favourite' },
      context: { en: 'Your classmate uses your favourite pen.', zh: '你的同班同学用了你特别喜爱的钢笔。', origin: '教材五上 U6 p.79' }
    },
    {
      id: 'u6_problem', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 79,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'word', en: 'problem', acceptedVariants: [], zh: '问题，困难',
      helpKind: 'spelling_focus', displayChunks: 'prob ｜ lem',
      helpNote: '两段拼写：prob ＋ lem。',
      bridgeNote: '日常口语：No problem!（没问题！）',
      snap: { pieces: ['prob', 'lem'], decoys: [{ text: 'lam', tip: '🧩 后半截是 l-e-m 哦：prob-lem！' }] },
      cloze: { prefix: 'prob', blank: 'lem', suffix: '', hint: '后三个字母 l-e-m' },
      sentencePrompt: { template: 'What ______ do you have with others?', zh: '你和他人相处有什么问题？', expected: 'problem' },
      context: { en: 'What problem do you have with others?', zh: '你和别人相处有什么困扰？', origin: '教材五上 U6 p.79' }
    },
    {
      id: 'u6_do_homework', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 79,
      textbookCore: true, classRequirement: 'unverified_family',
      type: 'phrase', en: 'do your homework', selfVariant: 'do my homework', acceptedVariants: [],
      zh: '做家庭作业（词表：do your homework）',
      helpKind: 'word_boundary', displayChunks: 'do ␣ your ␣ home·work',
      helpNote: '三个独立的词留出空格；对别人说用 do your homework，讲“我自己做作业”用 do my homework（按句子主语选人称）。',
      bridgeNote: '锁死后半截：home + work（不是 walk）！',
      snap: { pieces: ['do', '␣', 'your', '␣', 'homework'], decoys: [{ text: 'homewalk', tip: '🚶 又抓到一只伪装虫！做作业是 home-work，不是 walk！' }] },
      cloze: { prefix: 'do your home', blank: 'work', suffix: '', hint: '工作/作业 w-o-r-k' },
      sentencePrompt: { template: 'I usually ______ before dinner.', zh: '我通常在晚饭前做我的家庭作业。', expected: 'do my homework' },
      sentenceVariants: [
        { key: 'my', label: '第一人称语境 (do my homework)', template: 'I usually ______ before dinner.', zh: '我通常在晚饭前做我的家庭作业。', expected: 'do my homework', chunks: 'do ␣ my ␣ home·work' },
        { key: 'your', label: '第二人称语境 (do your homework)', template: 'At that time, you ______.', zh: '在那个时候，你在做你的家庭作业。', expected: 'do your homework', chunks: 'do ␣ your ␣ home·work' }
      ],
      context: { en: 'At that time, you do your homework.', zh: '在那个时候，你在做家庭作业。', origin: '改编自教材五上 U6 p.79' }
    },
    {
      id: 'u6_classmate', version: 1, unit: 6, sourceScope: 'textbook_wordlist', bookPage: 79,
      textbookCore: false, classRequirement: 'read_meaning_use',
      type: 'word', en: 'classmate', acceptedVariants: [], zh: '同班同学',
      helpKind: 'morphology', displayChunks: 'class + mate',
      helpNote: '教材带 * 词：class（班级）＋ mate（伙伴），连写不空格！',
      bridgeNote: '复数直接加 s：classmates（同班同学们）。',
      snap: { pieces: ['class', 'mate'], decoys: [{ text: 'meat', tip: '🥩 meat 是肉，伙伴是 m-a-t-e（和 late 一样）！' }] },
      cloze: { prefix: 'class', blank: 'mate', suffix: '', hint: '班级 class + 伙伴 m-a-t-e' },
      sentencePrompt: { template: 'My ______ shares books with me.', zh: '我的同班同学和我分享书本。', expected: 'classmate' },
      context: { en: 'Your classmate uses your favourite pen.', zh: '你的同班同学用了你特别喜爱的钢笔。', origin: '教材五上 U6 p.79' }
    },

    // ==================== Unit 5 Key Dictation Sentences 01–06 (Cartoon time p.60–61, sourceScope: 'textbook_sentence') ====================
    {
      id: 'u5_sent_01', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 60,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: 'He always watches TV and eats a lot at weekends.', acceptedVariants: [],
      zh: '01 · 他总是在周末看电视，还吃很多。',
      helpKind: 'sentence_grammar', displayChunks: 'He always ｜ watches TV ｜ and eats ｜ a lot ｜ at weekends.',
      helpNote: '抓牢5处得分点：①句首大写 He；②always 仅一个 l；③He 管两个动作，都要变三单 watches (+es) 与 eats (+s)，TV 全大写；④“很多”分写成两词 a lot；⑤“在周末” at weekends 带 s 加句号 .。',
      bridgeNote: '并联三单口诀：主语是 He，and 前后 watches 和 eats 小尾巴齐步走！',
      snap: {
        pieces: ['He always', 'watches TV', 'and eats', 'a lot', 'at weekends.'],
        decoys: [
          { text: 'watch TV', tip: '📺 主语是单数 He，watch 以 ch 结尾要加 -es：watches TV！' },
          { text: 'and eat', tip: '🍔 and 后面的吃也是 He 做的，eat 也要加 -s 变成 eats！' },
          { text: 'alot', tip: '✂️ “很多”是两个独立的词 a lot，中间记得留空格！' }
        ]
      },
      cloze: { prefix: 'He always ', blank: 'watches TV', suffix: ' and eats a lot at weekends.', hint: '补全“看电视”（注意三单 -es 和大写 TV）' },
      sentencePrompt: { template: 'He always ______ and eats a lot at weekends.', zh: '他总是在周末看电视，还吃很多。（填“看电视”）', expected: 'watches TV' },
      context: { en: 'He always watches TV and eats a lot at weekends.', zh: '他总是在周末看电视，还吃很多。', origin: '教材五上 U5 Cartoon time p.60 重点句01' }
    },
    {
      id: 'u5_sent_02', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 60,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: 'He never goes out.', acceptedVariants: [],
      zh: '02 · 他从不出去。',
      helpKind: 'sentence_grammar', displayChunks: 'He ｜ never ｜ goes out.',
      helpNote: '抓牢3处得分点：①句首大写 He；②从不 never (n-e-v-e-r)；③单数 He 后面 go 加 -es 变成 goes，句末写实心句号 .。',
      bridgeNote: '加 -es 三兄弟串记：do → does，go → goes，watch → watches！',
      snap: {
        pieces: ['He', 'never', 'goes out.'],
        decoys: [
          { text: 'go out.', tip: '🚪 主语是单数 He，go 要加 -es 变成 goes out. 哦！' },
          { text: 'he', tip: '🎩 句子开头第一个字母要戴大写礼帽 H（He）！' }
        ]
      },
      cloze: { prefix: 'He never ', blank: 'goes', suffix: ' out.', hint: 'go 的第三人称单数形式（4个字母）' },
      sentencePrompt: { template: 'He never ______.', zh: '他从不出去。（填“出去”注意三单）', expected: 'goes out' },
      context: { en: 'He never goes out.', zh: '他从不出去。', origin: '教材五上 U5 Cartoon time p.60 重点句02' }
    },
    {
      id: 'u5_sent_03', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 60,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: 'They often play basketball in spring.', acceptedVariants: [],
      zh: '03 · 他们在春天经常打篮球。',
      helpKind: 'sentence_grammar', displayChunks: 'They often ｜ play ｜ basketball ｜ in spring.',
      helpNote: '抓牢4处得分点：①复数主语 They 后用动词原形 play（不加 s，球类前不加 the）；②经常 often 藏着不发音的 t；③合成词 basket+ball 连写；④季节前用 in（in spring 小写 s）加句号 .。',
      bridgeNote: '主谓对比：单数 He 用 watches / goes，复数 They 用原形 play！',
      snap: {
        pieces: ['They often', 'play', 'basketball', 'in spring.'],
        decoys: [
          { text: 'plays', tip: '🏀 主语是复数“他们 They”，动词用原形 play，不加 s 哦！' },
          { text: 'play the', tip: '🏀 球类运动中间不加 the，直接说 play basketball！' },
          { text: 'on spring.', tip: '🌱 在某个季节前面介词固定用 in：in spring.！' }
        ]
      },
      cloze: { prefix: 'They ', blank: 'often play', suffix: ' basketball in spring.', hint: '补全“经常打（篮球）”（注意 often 里的 t 与动词原形）' },
      sentencePrompt: { template: 'They ______ in spring.', zh: '他们在春天经常打篮球。（填“经常打篮球”）', expected: 'often play basketball' },
      context: { en: 'They often play basketball in spring.', zh: '他们在春天经常打篮球。', origin: '教材五上 U5 Cartoon time p.60 重点句03' }
    },
    {
      id: 'u5_sent_04', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 61,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: "Let's go swimming.", acceptedVariants: [],
      zh: '04 · 让我们去游泳吧。',
      helpKind: 'sentence_grammar', displayChunks: "Let's ｜ go ｜ swimming.",
      helpNote: "抓牢3处得分点：①句首大写 Let's（Let us 缩写，千万别漏撇号 's）；②后接动词原形 go；③去游泳 go swimming 双写两个 m（swim-ming）加句号 .。",
      bridgeNote: "重读闭音节双写：swim → swimming（双写 m 再加 ing）！",
      snap: {
        pieces: ["Let's", 'go', 'swimming.'],
        decoys: [
          { text: 'swiming.', tip: '🏊 swim 变 -ing 时尾巴的 m 要双写变成双胞胎：swimming.！' },
          { text: 'Lets', tip: "🎩 让我们 Let's 右上角有一顶小撇号 's 哦！" }
        ]
      },
      cloze: { prefix: "Let's go ", blank: 'swimming', suffix: '.', hint: '拼出“游泳”（注意双写字母 m：s-w-i-m-m-i-n-g）' },
      sentencePrompt: { template: "Let's ______.", zh: '让我们去游泳吧。（填“去游泳”）', expected: 'go swimming' },
      context: { en: "Let's go swimming.", zh: '让我们去游泳吧。', origin: '教材五上 U5 Cartoon time p.61 重点句04' }
    },
    {
      id: 'u5_sent_05', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 61,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: "Let's go and have a picnic.", acceptedVariants: [],
      zh: '05 · 让我们去野餐吧。',
      helpKind: 'sentence_grammar', displayChunks: "Let's ｜ go and ｜ have a ｜ picnic.",
      helpNote: "抓牢4处得分点：①句首大写 Let's（带撇号 's）；②课本原句用 go and 连接两个原形动词；③野餐短语 have a picnic（别漏冠词 a，词间留空）；④句末加句号 .。",
      bridgeNote: "两句邀请对比：Let's go swimming. vs Let's go and have a picnic.（多一个 go and）！",
      snap: {
        pieces: ["Let's", 'go and', 'have a', 'picnic.'],
        decoys: [
          { text: 'have picnic.', tip: '🧺 野餐中间别漏掉小冠词 a：have a picnic.！' },
          { text: 'go to', tip: "🌳 课本原句用 go and 连接两个原形动词：Let's go and have a picnic.！" }
        ]
      },
      cloze: { prefix: "Let's ", blank: 'go and have a picnic', suffix: '.', hint: '补全“去野餐”（5个词留清空格：go and have a picnic）' },
      sentencePrompt: { template: "Let's ______.", zh: '让我们去野餐吧。（填 go and...）', expected: 'go and have a picnic' },
      context: { en: "Let's go and have a picnic.", zh: '让我们去野餐吧。', origin: '教材五上 U5 Cartoon time p.61 重点句05' }
    },
    {
      id: 'u5_sent_06', version: 1, unit: 5, sourceScope: 'textbook_sentence', bookPage: 61,
      textbookCore: true, classRequirement: 'dictation_verified',
      type: 'sentence', en: 'He tries to get out.', acceptedVariants: [],
      zh: '06 · 他尝试出去。',
      helpKind: 'sentence_grammar', displayChunks: 'He ｜ tries ｜ to get out.',
      helpNote: '抓牢3处得分点：①句首大写 He；②“尝试”原形是 try，遇到单数 He 要把辅音后的 y 变成 i 再加 -es（tries，t-r-i-e-s）；③努力做某事 try to get out. 加句号。',
      bridgeNote: '关键变形锁死：try（原形） → tries（y 变 i 加 es）＋ to get out！',
      snap: {
        pieces: ['He', 'tries', 'to get out.'],
        decoys: [
          { text: 'trys', tip: '🔑 辅音字母 r + y 结尾的 try，变三单要把 y 改成 i 再加 -es：tries！' },
          { text: 'try', tip: '🚪 主语是单数 He，try 要变身成第三人称单数 tries 哦！' }
        ]
      },
      cloze: { prefix: 'He ', blank: 'tries', suffix: ' to get out.', hint: 'try 的第三人称单数（把 y 变 i 再加 es）' },
      sentencePrompt: { template: 'He ______.', zh: '他尝试出去。（填“尝试出去”）', expected: 'tries to get out' },
      context: { en: 'He tries to get out.', zh: '他尝试出去。', origin: '教材五上 U5 Cartoon time p.61 重点句06' }
    }
  ];

  const PACKS = [
    {
      id: 'pack-baseline',
      title: '00 · 首次 10 分钟纸笔基线短测',
      subtitle: '摸清哪些词已稳（6 词 + 1 句无提示纸写，支持分批施测）',
      modeHint: 'baseline',
      itemIds: ['u5_saturday', 'u5_sunday', 'fnd_morning', 'fnd_homework', 'fnd_football', 'u5_sometimes'],
      extraSentence: { zh: '我和我的朋友们一起踢足球。', en: 'I play football with my friends.', focus: 'with 的理解选用与词间空格' },
      altCheckWords: ['u5_tuesday', 'u5_usually', 'u5_play_the_piano']
    },
    {
      id: 'pack-autumn-1',
      title: '01 · 秋假第1次：星期大哥戴礼帽',
      subtitle: '精练 Saturday / Sunday / morning（约 15 分钟）',
      modeHint: 'standard',
      itemIds: ['u5_saturday', 'u5_sunday', 'fnd_morning'],
      bugId: 'bug_1'
    },
    {
      id: 'pack-autumn-2',
      title: '02 · 秋假第2次：作业与足球构词拆解',
      subtitle: '搞清 home+work 与 foot+ball，区分 work / walk',
      modeHint: 'standard',
      itemIds: ['fnd_homework', 'fnd_football', 'u6_do_homework'],
      bugId: 'bug_2'
    },
    {
      id: 'pack-autumn-3',
      title: '03 · 秋假第3次：合成词与短语留空',
      subtitle: '拆解 some+time+s，练准 with、野餐与不熬夜',
      modeHint: 'standard',
      itemIds: ['u5_sometimes', 'fnd_with', 'u5_have_a_picnic', 'fnd_stay_up_late'],
      bugId: 'bug_3'
    },
    {
      id: 'pack-autumn-4',
      title: '04 · 秋假第4次：旧词巩固 + U6 导入预读',
      subtitle: '到期旧词优先复测；预读 wall / between / drink 及情境短句',
      modeHint: 'standard',
      itemIds: ['u6_wall', 'u6_between', 'u6_drink', 'u6_get_along_with'],
      preread: {
        source: '教材五上 U6 Cartoon time (p.72)',
        lines: [
          'Billy: My bag is so heavy. I’m very tired.',
          'Sam: I can help! Let me take your bag.'
        ],
        question: '听读上面两句后口头回答：谁主动帮 Billy 拿了很重的包？'
      },
      bugId: 'bug_4'
    },
    {
      id: 'pack-autumn-5',
      title: '05 · 秋假第5次：六尺巷故事预读与友好相处',
      subtitle: '旧词优先复测；预看 p.75–76 词句并试答建议句',
      modeHint: 'standard',
      itemIds: ['u6_friendly', 'u6_letter', 'u6_next_to', 'u6_neighbour'],
      preread: {
        source: '教材五上 U6 Story time《六尺巷》(p.76)',
        lines: [
          'Zhang Ying is right. A wall is not important. We should be friendly.',
          'Right. Why not move our wall back three chi?'
        ],
        question: '听读思考：张家人读完信后决定把自家的墙怎么处理？（试着用 Good idea! 回应一句建议）'
      },
      bugId: 'bug_5'
    },
    {
      id: 'pack-u6-p75',
      title: '06 · 五上 U6：六尺巷核心词（p.75）',
      subtitle: 'space / their / too / close to / use / *advice',
      modeHint: 'standard',
      itemIds: ['u6_space', 'u6_their', 'u6_too', 'u6_close_to', 'u6_use', 'u6_advice'],
      bugId: 'bug_6'
    },
    {
      id: 'pack-u6-p78',
      title: '07 · 五上 U6：语法页词表（p.78–79）',
      subtitle: 'then / time / favourite / problem / *classmate',
      modeHint: 'standard',
      itemIds: ['u6_then', 'u6_time', 'u6_favourite', 'u6_problem', 'u6_classmate'],
      bugId: 'bug_7'
    },
    {
      id: 'pack-u5-sent-all',
      title: '08 · 📌 必默重点句：五上 U5 重点句子全通关（01–06 全6句）',
      subtitle: '串成比利宅家吃胖卡门四格漫画记！一次练透三单 watches/goes/tries 与双写 swimming',
      modeHint: 'standard',
      paperCap: 6,
      preserveFullPack: true,
      slotDeckId: 'slot_u5_billy',
      itemIds: ['u5_sent_01', 'u5_sent_02', 'u5_sent_03', 'u5_sent_04', 'u5_sent_05', 'u5_sent_06'],
      preread: {
        source: '教材五上 U5 Cartoon time 四幕故事串联记忆法 (p.60–61)',
        lines: [
          'Scene 1 (秋冬季宅家): He always watches TV and eats a lot at weekends. He never goes out.',
          'Scene 2 (春天伙伴运动): They often play basketball in spring.',
          "Scene 3 (连环邀约): Let's go swimming. Let's go and have a picnic.",
          'Scene 4 (太胖卡门口): He tries to get out. (Oh no, Billy is too fat!)'
        ],
        question: '按上面四格漫画顺序回想：比利周末干什么（句01–02）？春天伙伴干什么（句03）？约他去哪两件事（句04–05）？最后发生了什么（句06）？'
      },
      bugId: 'bug_u5_sent_1'
    },
    {
      id: 'pack-u5-sent-a',
      title: '09 · 📌 必默重点句（上半场 01–03）：宅家日常与春日篮球',
      subtitle: '轻量分步练前 3 句：攻克 watches TV / eats a lot / goes out / play basketball',
      modeHint: 'standard',
      paperCap: 3,
      preserveFullPack: true,
      slotDeckId: 'slot_u5_billy',
      itemIds: ['u5_sent_01', 'u5_sent_02', 'u5_sent_03'],
      bugId: 'bug_u5_sent_1'
    },
    {
      id: 'pack-u5-sent-b',
      title: '10 · 📌 必默重点句（下半场 04–06）：游泳野餐与卡门而出',
      subtitle: "轻量分步练后 3 句：攻克 Let's 撇号 / swimming 双写 m / go and have a picnic / tries",
      modeHint: 'standard',
      paperCap: 3,
      preserveFullPack: true,
      slotDeckId: 'slot_u5_billy',
      itemIds: ['u5_sent_04', 'u5_sent_05', 'u5_sent_06'],
      bugId: 'bug_u5_sent_2'
    }
  ];

  const SLOT_DECKS = [
    {
      id: 'slot_u5_weekend',
      name: '🎲 周末日常摇奖机（U5 频度副词 + 动词三单变化）',
      subjects: [
        { en: 'I', zh: '我', thirdSingular: false },
        { en: 'My dad', zh: '我老爸', thirdSingular: true },
        { en: 'Billy', zh: '比利', thirdSingular: true },
        { en: 'My friends and I', zh: '我和朋友们', thirdSingular: false }
      ],
      adverbs: [
        { en: 'always', zh: '总是' },
        { en: 'usually', zh: '通常' },
        { en: 'sometimes', zh: '有时' },
        { en: 'never', zh: '从不' }
      ],
      actions: [
        { base: 'do homework on Saturday', sForm: 'does homework on Saturday', zh: '在周六做作业', highlight: 'homework' },
        { base: 'play football with friends', sForm: 'plays football with friends', zh: '和朋友一起踢足球', highlight: 'with' },
        { base: 'have a picnic in autumn', sForm: 'has a picnic in autumn', zh: '在秋天去野餐', highlight: 'have a picnic' },
        { base: 'stay up late on Sundays', sForm: 'stays up late on Sundays', zh: '在周日熬夜', highlight: 'on Sundays' },
        { base: 'chat on the internet', sForm: 'chats on the internet', zh: '在网上聊天', highlight: 'on' }
      ]
    },
    {
      id: 'slot_u6_advice',
      name: '💡 好邻居点子摇奖机（U6 Why don’t we + 动词原形）',
      subjects: [
        { en: "Why don't we", zh: '我们为什么不', thirdSingular: false },
        { en: "Why don't you", zh: '你为什么不', thirdSingular: false }
      ],
      adverbs: [
        { en: '', zh: '' }
      ],
      actions: [
        { base: 'have a picnic here?', sForm: 'have a picnic here?', zh: '在这儿野餐呢？（答：Good idea!）', highlight: 'have a picnic' },
        { base: 'drink some water first?', sForm: 'drink some water first?', zh: '先喝点水呢？（答：Great!）', highlight: 'drink' },
        { base: 'write a letter to him?', sForm: 'write a letter to him?', zh: '给他写封信呢？（答：Good idea!）', highlight: 'letter' },
        { base: 'move our wall back?', sForm: 'move our wall back?', zh: '把我们的墙往后退呢？（答：That’s a good idea!）', highlight: 'wall' }
      ]
    },
    {
      id: 'slot_u5_billy',
      name: '🐹 比利宅家与春日运动摇奖机（U5 重点句 01–06 主谓三单对比）',
      subjects: [
        { en: 'He', zh: '他', thirdSingular: true },
        { en: 'Billy', zh: '比利', thirdSingular: true },
        { en: 'They', zh: '他们', thirdSingular: false },
        { en: 'We', zh: '我们', thirdSingular: false }
      ],
      adverbs: [
        { en: 'always', zh: '总是' },
        { en: 'often', zh: '经常' },
        { en: 'never', zh: '从不' }
      ],
      actions: [
        { base: 'watch TV and eat a lot at weekends.', sForm: 'watches TV and eats a lot at weekends.', zh: '在周末看电视，还吃很多。', highlight: 'watches TV' },
        { base: 'go out.', sForm: 'goes out.', zh: '出去。', highlight: 'goes' },
        { base: 'play basketball in spring.', sForm: 'plays basketball in spring.', zh: '在春天打篮球。', highlight: 'basketball' },
        { base: 'try to get out.', sForm: 'tries to get out.', zh: '尝试出去。', highlight: 'tries' }
      ]
    }
  ];

  const BUG_CARDS = [
    {
      id: 'bug_1',
      title: '🕵️ 马虎特工的周末日记（揪出 2 只臭虫！）',
      zh: '我通常在星期六上午读书。',
      tokens: [
        { text: 'I' }, { text: 'usually' }, { text: 'read' }, { text: 'books' }, { text: 'on' },
        { text: 'satday', isBug: true, fix: 'Saturday', choices: ['Saturday', 'satday'], tip: '大写 S ＋ 中间不能漏掉 ur！' },
        { text: 'moning.', isBug: true, fix: 'morning.', choices: ['morning.', 'moning.'], tip: 'm-o-r-n-i-n-g，别漏掉字母 r！' }
      ]
    },
    {
      id: 'bug_2',
      title: '🕵️ 谁把作业写成散步啦？（揪出 2 只臭虫！）',
      zh: '我先做家庭作业，然后去踢足球。',
      tokens: [
        { text: 'I' }, { text: 'do' }, { text: 'my' },
        { text: 'homewalk', isBug: true, fix: 'homework', choices: ['homework', 'homewalk'], tip: '做作业是 home + work，walk 是走路！' },
        { text: 'and' }, { text: 'play' },
        { text: 'footbool.', isBug: true, fix: 'football.', choices: ['football.', 'footbool.'], tip: '足球是 foot + ball (a-l-l)！' }
      ]
    },
    {
      id: 'bug_3',
      title: '🕵️ 揪出伪装词与连体词（揪出 2 只臭虫！）',
      zh: '我和朋友一起踢球，而且从不熬夜。',
      tokens: [
        { text: 'I' }, { text: 'play' }, { text: 'football' },
        { text: 'was', isBug: true, fix: 'with', choices: ['with', 'was'], tip: '“和……一起”用介词 with！' },
        { text: 'my' }, { text: 'friends,' }, { text: 'and' }, { text: 'I' }, { text: 'never' }, { text: 'stay' },
        { text: 'uplate.', isBug: true, fix: 'up late.', choices: ['up late.', 'uplate.'], tip: 'up 和 late 是两个词，中间必须留空格！' }
      ]
    },
    {
      id: 'bug_4',
      title: '🕵️ 野餐与墙边找茬（揪出 2 只臭虫！）',
      zh: '有时我们在两堵墙中间喝点水。',
      tokens: [
        { text: 'Somtimeys', isBug: true, fix: 'Sometimes', choices: ['Sometimes', 'Somtimeys'], tip: 'Some + time + s，首字母大写且别漏掉 e！' },
        { text: 'we' }, { text: 'drink' }, { text: 'some' }, { text: 'water' },
        { text: 'bitween', isBug: true, fix: 'between', choices: ['between', 'bitween'], tip: 'be + tween（开头是 be，中间两个 e）！' },
        { text: 'two' }, { text: 'walls.' }
      ]
    },
    {
      id: 'bug_5',
      title: '🕵️ 六尺巷友好侦探（揪出 2 只臭虫！）',
      zh: '我们应该友好相处，我们为什么不写封信呢？',
      tokens: [
        { text: 'We' }, { text: 'should' }, { text: 'be' },
        { text: 'frindly.', isBug: true, fix: 'friendly.', choices: ['friendly.', 'frindly.'], tip: 'friend 中间藏着字母组合 i-e！' },
        { text: 'Why' }, { text: "don't" }, { text: 'we' }, { text: 'write' }, { text: 'a' },
        { text: 'leter?', isBug: true, fix: 'letter?', choices: ['letter?', 'leter?'], tip: '信封 letter 中间有两个 t！' }
      ]
    },
    {
      id: 'bug_6',
      title: '🕵️ 两个 o 还是一个 o？（揪出 2 只臭虫！）',
      zh: '他们的房子离我们的太近了！',
      tokens: [
        { text: 'There', isBug: true, fix: 'Their', choices: ['Their', 'There'], tip: '“他们的房子”要用形容词性物主代词 Their (t-h-e-i-r)！' },
        { text: 'house' }, { text: 'is' },
        { text: 'to', isBug: true, fix: 'too', choices: ['too', 'to'], tip: '表示“太近了”要用两个 o 的 too！' },
        { text: 'close' }, { text: 'to' }, { text: 'ours!' }
      ]
    },
    {
      id: 'bug_7',
      title: '🕵️ 最喜爱的科目找茬（揪出 2 只臭虫！）',
      zh: '到那时我有时间，英语是我最喜爱的科目。',
      tokens: [
        { text: 'I' }, { text: 'have' },
        { text: 'tim', isBug: true, fix: 'time', choices: ['time', 'tim'], tip: '时间 t-i-m-e 词尾有不发音的 e！' },
        { text: 'then.' }, { text: 'English' }, { text: 'is' }, { text: 'my' },
        { text: 'faverite', isBug: true, fix: 'favourite', choices: ['favourite', 'faverite'], tip: '按江苏课本英式拼写是 fav-our-ite！' },
        { text: 'subject.' }
      ]
    },
    {
      id: 'bug_u5_sent_1',
      title: '🕵️ 比利的宅家病历单（揪出 3 只三单臭虫！）',
      zh: '他总是在周末看电视吃很多，而且他从不出去。',
      tokens: [
        { text: 'He' }, { text: 'always' },
        { text: 'watch', isBug: true, fix: 'watches', choices: ['watches', 'watch'], tip: '主语是单数 He，watch 要加 -es 变成 watches！' },
        { text: 'TV' }, { text: 'and' },
        { text: 'eat', isBug: true, fix: 'eats', choices: ['eats', 'eat'], tip: 'and 后面的动作也归 He 管，eat 要加 -s 变成 eats！' },
        { text: 'a' }, { text: 'lot' }, { text: 'at' }, { text: 'weekends,' }, { text: 'and' }, { text: 'he' }, { text: 'never' },
        { text: 'go', isBug: true, fix: 'goes', choices: ['goes', 'go'], tip: '单数 he 后面 go 要加 -es 变成 goes！' },
        { text: 'out.' }
      ]
    },
    {
      id: 'bug_u5_sent_2',
      title: '🕵️ 春日游泳野餐邀请函（揪出 3 只拼写臭虫！）',
      zh: '让我们去游泳吧！他尝试出去。',
      tokens: [
        { text: 'Lets', isBug: true, fix: "Let's", choices: ["Let's", 'Lets'], tip: "让我们 Let's 是 Let us 的缩写，别漏撇号 's！" },
        { text: 'go' },
        { text: 'swiming.', isBug: true, fix: 'swimming.', choices: ['swimming.', 'swiming.'], tip: '去游泳 swimming 中间要双写两个 m！' },
        { text: 'He' },
        { text: 'trys', isBug: true, fix: 'tries', choices: ['tries', 'trys'], tip: 'try 遇到单数 He 要把 y 变成 i 再加 -es：tries！' },
        { text: 'to' }, { text: 'get' }, { text: 'out.' }
      ]
    }
  ];

  const ERROR_TAGS = [
    { id: 'missing_letter', label: '漏字母/漏块' },
    { id: 'letter_swap', label: '换错字母' },
    { id: 'verb_form', label: '三单/词形漏变(watches/tries/swimming)' },
    { id: 'chunk_replace', label: '词块替换(如walk/work)' },
    { id: 'case_missing', label: '星期/句首未大写' },
    { id: 'space_missing', label: '词间缺空格' },
    { id: 'word_choice', label: '选词不当(如with/was)' },
    { id: 'boundary_punct', label: '撇号/句末标点缺失' }
  ];

  return { ITEMS, PACKS, SLOT_DECKS, BUG_CARDS, ERROR_TAGS };
})();

if (typeof module !== 'undefined') module.exports = SNAPWORD_CURRICULUM;
