import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { log } from "./db.js";

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o-mini";
const IMAGE_MODEL = "gpt-image-2";
const FALLBACK_IMAGE_MODEL = "gpt-image-1";

const imageDir = path.resolve("data/generated-images");

export type GeneratedPost = {
  content: string;
  imagePath?: string;
  comment?: string;
};

type PostFormat =
  | "relatable"
  | "funny"
  | "useful"
  | "POV"
  | "question"
  | "nostalgia"
  | "emotional"
  | "observation"
  | "list"
  | "before_after"
  | "unexpected";

type InspirationSource =
  | "reddit"
  | "pinterest"
  | "historical"
  | "old_products"
  | "old_tv"
  | "90s_culture"
  | "us_news"
  | "us_history"
  | "football_news"
  | "vietnam_life";

type HookMechanism =
  | "recognition"
  | "curiosity"
  | "specific_detail"
  | "identity"
  | "confession"
  | "unexpected"
  | "nostalgia"
  | "observation";

type PageDna = {
  identity: string;
  pillars: string[];
  emotions: string[];
  inspirationSources: InspirationSource[];
  formats: PostFormat[];
  hookMechanisms: HookMechanism[];
  imageStrategy: string;
  allowEmojis: boolean;
  useHashtags: boolean;
  minWords: number;
  maxWords: number;
  lengthGuide: string;
  hookRule: string;
};

type GeneratedContent = {
  contentIdea: string;
  hookMechanism: HookMechanism;
  emotionalTrigger: string;
  payoff: string;
  content: string;
  imageQuote: string;
  needsImage: boolean;
  imagePrompt: string;
};

type RealStory = {
  title: string;
  body: string;
};

function openaiApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();

  if (!key) {
    throw new Error("OPENAI_API_KEY is missing. Add it to the .env file.");
  }

  return key;
}

/**
 * ---------------------------------------------------------
 * TEXT HELPERS
 * ---------------------------------------------------------
 */

function cleanText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/  +/g, " ")
    .trim();
}

function stripEmojis(text: string) {
  return cleanText(
    text
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\uFE0F\u200D]/g, ""),
  );
}

function removeHashtags(text: string) {
  return cleanText(text.replace(/#[\p{L}\p{N}_]+/gu, ""));
}

function extractHashtags(text: string) {
  return [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map(
    (match) => match[0],
  );
}

const GENERIC_HASHTAGS = new Set(
  [
    "lifechangingmoment",
    "blessed",
    "gratefulheart",
    "mondaymotivation",
    "goodvibesonly",
    "lovethis",
    "instagood",
    "viral",
    "mustread",
    "deepthoughts",
    "lifelessons",
    "lifelesson",
    "bekind",
    "staypositive",
    "thoughtoftheday",
    "heartwarming",
    "emotional",
    "relatablecontent",
    "storytime",
    "dailymotivation",
    "positivevibes",
    "nevergiveup",
    "trusttheprocess",
    "livingmybestlife",
    "selflove",
    "mindfulliving",
    "blessedlife",
    "photooftheday",
    "instadaily",
    "motivationalquotes",
    "inspiration",
    "inspirational",
    "wisdom",
    "lifeadvice",
    "todayslesson",
    "foodforthought",
    "somethingtothinkabout",
    "realtalk",
    "deep",
    "feelings",
    "love",
    "life",
    "happy",
    "sad",
    "mood",
    "vibes",
    "blessedandgrateful",
    "makingmemories",
    "cherisheverymoment",
    "liveinthemoment",
    "thathinh",
    "thinh",
    "flirt",
    "flirting",
    "quote",
    "quotes",
  ].map((tag) => tag.toLowerCase()),
);

function foldHashtag(tag: string) {
  return tag
    .replace(/^#/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function isFlirtHashtag(tag: string) {
  const folded = foldHashtag(tag);
  return /thathinh|thathin|thinh|flirt|quotes?$/.test(folded);
}

function isGenericHashtag(tag: string) {
  const raw = tag.replace(/^#/, "");
  const normalized = raw.toLowerCase();
  const folded = foldHashtag(tag);

  if (GENERIC_HASHTAGS.has(normalized) || GENERIC_HASHTAGS.has(folded)) {
    return true;
  }

  if (isFlirtHashtag(tag)) {
    return true;
  }

  const humps = raw.match(/[A-Z][a-z]+/g) || [];

  if (humps.length >= 4) {
    return true;
  }

  return raw.length > 22;
}

export function putHashtagsOnOwnLine(text: string) {
  const kept = [...new Set(extractHashtags(text))]
    .filter((tag) => !isGenericHashtag(tag))
    .slice(0, 4);

  const body = removeHashtags(text);

  if (!kept.length) {
    return body;
  }

  return `${body}\n\n${kept.join(" ")}`;
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitIntoParagraphs(body: string) {
  const existing = body
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (existing.length >= 2) {
    return existing;
  }

  const sentences = splitSentences(existing[0] || body);

  if (sentences.length <= 1) {
    return sentences.length ? sentences : [body.trim()].filter(Boolean);
  }

  if (sentences.length <= 3) {
    return sentences;
  }

  const hook = sentences[0];
  const payoff = sentences[sentences.length - 1];
  const middle = sentences.slice(1, -1);

  if (middle.length >= 4) {
    const cut = Math.ceil(middle.length / 2);
    return [
      hook,
      middle.slice(0, cut).join(" "),
      middle.slice(cut).join(" "),
      payoff,
    ];
  }

  return [hook, middle.join(" "), payoff];
}

function ensureParagraphBreaks(text: string) {
  const tags = [...new Set(extractHashtags(text))]
    .filter((tag) => !isGenericHashtag(tag))
    .slice(0, 4);
  const body = removeHashtags(text);
  const paragraphs = splitIntoParagraphs(body);

  if (!paragraphs.length) {
    return tags.length ? tags.join(" ") : "";
  }

  const formatted = paragraphs.join("\n\n");

  if (!tags.length) {
    return formatted;
  }

  return `${formatted}\n\n${tags.join(" ")}`;
}

function uppercaseFirstSentence(text: string) {
  const blocks = text.split(/(\n\s*\n)/);
  const first = blocks[0]?.trim();

  if (!first || first.startsWith("#")) {
    return text;
  }

  const sentence = firstSentence(first);
  const rest = first.slice(sentence.length);
  blocks[0] = `${sentence.toUpperCase()}${rest}`;

  return blocks.join("");
}

function normalizePostContent(
  text: string,
  options: {
    allowEmojis: boolean;
    useHashtags: boolean;
  },
) {
  let result = cleanText(text.replace(/\\n/g, "\n"));

  if (!options.allowEmojis) {
    result = stripEmojis(result);
  }

  if (!options.useHashtags) {
    result = removeHashtags(result);
    return uppercaseFirstSentence(ensureParagraphBreaks(result));
  }

  return uppercaseFirstSentence(ensureParagraphBreaks(putHashtagsOnOwnLine(result)));
}

function wordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasGenericAIPhrase(text: string) {
  const patterns = [
    /^so,?\s+picture this/i,
    /^let me tell you/i,
    /^you won't believe/i,
    /^you know what that means/i,
    /of course,? i had to/i,
    /and that's when/i,
    /here's the thing/i,
    /at the end of the day/i,
    /little did i know/i,
    /i couldn't believe/i,
    /who else can relate/i,
    /hãy sống hết mình/i,
    /cuộc sống là những chuyến đi/i,
    /bạn sẽ không tin/i,
    /hãy yêu bản thân/i,
    /đẹp như một giấc mơ/i,
    /cánh hoa mong manh/i,
    /nơi này đẹp quá/i,
    /can anyone else relate/i,
    /steal (my|the) spotlight/i,
    /sense of shame/i,
    /furry spy/i,
    /knee-deep in/i,
    /lounging like/i,
    /that classic/i,
    /main character/i,
    /the audacity/i,
    /if i can'?t see you/i,
    /caught in 4k/i,
    /it'?s giving\b/i,
    /\bbuddy,\s/i,
  ];

  return patterns.some((pattern) => pattern.test(text.trim()));
}

function sentenceCount(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 8).length;
}

function firstSentence(text: string) {
  return (
    text
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .find(Boolean) || text.trim()
  );
}

function firstParagraph(text: string) {
  return text.split(/\n\s*\n/)[0]?.trim() || text.trim();
}

function validateGeneratedPost(
  content: string,
  rules: {
    minWords: number;
    maxWords: number;
    shortFunnyHook?: boolean;
    useHashtags?: boolean;
  },
) {
  const body = removeHashtags(content);
  const words = wordCount(body);
  const sentences = sentenceCount(body);
  const tags = [...new Set(extractHashtags(content))];
  const genericTags = tags.filter((tag) => isGenericHashtag(tag));
  const hook = firstParagraph(body);
  const hookWords = wordCount(hook);
  const hookSentences = sentenceCount(hook);
  const requireHashtags = rules.useHashtags !== false;

  if (words < rules.minWords || sentences < 3) {
    return {
      valid: false,
      reason:
        "Post needs hook → actual point/story → payoff. One relatable sentence is not enough.",
    };
  }

  if (words > rules.maxWords) {
    return {
      valid: false,
      reason: `Post is too long. Keep it under ${rules.maxWords} words.`,
    };
  }

  if (hookSentences !== 1 || hookWords < 4 || hookWords > 18) {
    return {
      valid: false,
      reason:
        "Start with one catching ALL CAPS sentence on its own first line, related to the post, that creates curiosity to read more. Do not dump the whole story in the opening.",
    };
  }

  if (hasGenericAIPhrase(body)) {
    return {
      valid: false,
      reason: "Post starts or relies on a generic AI-style phrase.",
    };
  }

  if (requireHashtags && (tags.length < 2 || tags.length > 4)) {
    return {
      valid: false,
      reason:
        "Post must end with 2-4 relevant hashtags on their own last line.",
    };
  }

  if (requireHashtags && genericTags.length) {
    return {
      valid: false,
      reason: `Hashtags are too generic or AI-generated (${genericTags.join(" ")}). Use specific tags that match the post.`,
    };
  }

  return {
    valid: true,
    reason: "",
  };
}

/**
 * ---------------------------------------------------------
 * RANDOM HELPERS
 * ---------------------------------------------------------
 */

function pick<T>(items: T[]): T {
  if (!items.length) {
    throw new Error("Cannot pick from an empty array.");
  }

  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function numbered(items: string[]) {
  return items
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
}

/**
 * ---------------------------------------------------------
 * NEWS / TREND SOURCES
 * ---------------------------------------------------------
 */

async function fetchHeadlines(url: string): Promise<string[]> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "facebook-auto-poster/1.0",
      },
    });

    if (!response.ok) {
      return [];
    }

    const text = await response.text();

    const titles = [
      ...text.matchAll(
        /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi,
      ),
    ]
      .map((match) =>
        match[1]
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim(),
      )
      .filter(Boolean);

    return titles.slice(1, 12);
  } catch {
    return [];
  }
}

async function topicTrends(topic: string) {
  const query = encodeURIComponent(topic);

  const sources = await Promise.allSettled([
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`,
    ),
  ]);

  return sources
    .flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    )
    .filter(Boolean)
    .slice(0, 12);
}

async function collectUSNewsDrama() {
  const threeDay = encodeURIComponent(
    'US (news OR viral OR drama OR celebrity) when:3d',
  );

  const [top, entertainment, recent, news, entertainmentReddit, pop, fauxmoi] =
    await Promise.allSettled([
      fetchHeadlines(
        "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
      ),
      fetchHeadlines(
        "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en",
      ),
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${threeDay}&hl=en-US&gl=US&ceid=US:en`,
      ),
      fetchRedditStories("news", 0),
      fetchRedditStories("entertainment", 0),
      fetchRedditStories("popculturechat", 0),
      fetchRedditStories("FauxMoi", 0),
    ]);

  const headlines: string[] = [];

  for (const result of [top, entertainment, recent]) {
    if (result.status === "fulfilled") {
      headlines.push(...result.value);
    }
  }

  for (const result of [news, entertainmentReddit, pop, fauxmoi]) {
    if (result.status === "fulfilled") {
      headlines.push(
        ...result.value.map((story) => story.title).filter(Boolean),
      );
    }
  }

  const unique = headlines.filter(
    (title, index, list) =>
      title &&
      list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 10);
}

async function collectFootballNews() {
  const week = encodeURIComponent(
    '(Cristiano Ronaldo OR Lionel Messi OR "Al Nassr" OR "Inter Miami") (match OR goal OR transfer OR news) when:7d',
  );
  const ronaldo = encodeURIComponent("Cristiano Ronaldo when:7d");
  const messi = encodeURIComponent("Lionel Messi when:7d");
  const football = encodeURIComponent(
    "(football OR soccer) (Ronaldo OR Messi) when:7d",
  );

  const [ronaldoNews, messiNews, footballNews, weekNews, soccer, soccerReddit, cr7, messiSub] =
    await Promise.allSettled([
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${ronaldo}&hl=en-US&gl=US&ceid=US:en`,
      ),
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${messi}&hl=en-US&gl=US&ceid=US:en`,
      ),
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${football}&hl=en-US&gl=US&ceid=US:en`,
      ),
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${week}&hl=en-US&gl=US&ceid=US:en`,
      ),
      fetchRedditStories("soccer", 0),
      fetchRedditStories("football", 0),
      fetchRedditStories("CristianoRonaldo", 0),
      fetchRedditStories("Messi", 0),
    ]);

  const headlines: string[] = [];

  for (const result of [ronaldoNews, messiNews, footballNews, weekNews]) {
    if (result.status === "fulfilled") {
      headlines.push(...result.value);
    }
  }

  for (const result of [soccer, soccerReddit, cr7, messiSub]) {
    if (result.status === "fulfilled") {
      headlines.push(
        ...result.value.map((story) => story.title).filter(Boolean),
      );
    }
  }

  const unique = headlines.filter(
    (title, index, list) =>
      title &&
      list.findIndex((item) => item === title) === index &&
      /ronaldo|messi|cr7|al nassr|inter miami|portugal|argentina|soccer|football|goal|hat-trick|champions|world cup|hat trick/i.test(
        title,
      ),
  );

  if (unique.length) {
    return shuffle(unique).slice(0, 10);
  }

  return shuffle(headlines.filter(Boolean)).slice(0, 10);
}

const VIETNAM_SEEDS = [
  "Anh bảo đi Đà Lạt cho mát. Mát thì mát. Seen từ tối hôm qua.",
  "Không phải đang thả thính. Chỉ hỏi ăn cơm chưa. Lần thứ bảy.",
  "Ghế cửa sổ còn trống. Không giữ chỗ. Chỉ chưa cho ai ngồi.",
  "Hội An đẹp thật. Đẹp hơn nếu có người trả lời tin nhắn.",
  "Biển Đà Nẵng gió lớn. Vẫn thua cái seen của anh.",
  "Cà phê hết từ lâu. Em vẫn ngồi. Không phải đợi. Em chỉ chưa đứng dậy.",
  "Sài Gòn kẹt xe. Có thời gian nghĩ lung tung. Toàn nghĩ tới một người.",
  "Hà Nội mưa. Em vào quán. Bàn hai người. Em ngồi một.",
  "Phú Quốc hoàng hôn. Chụp ảnh xong lại mở chat. Vẫn để đó.",
  "Máy bay, ghế cửa sổ. Tai nghe. Không nhắn. Giữ chỗ bên cạnh cho vui.",
  "Đà Lạt lạnh. Áo mỏng. Không phải em không biết. Em chỉ thích được hỏi có lạnh không.",
  "Quán quen. Ly cũ. Nhân viên hỏi đợi ai. Em nói không. Nói nhỏ quá.",
  "Nha Trang muối trên môi. Muốn gửi cho anh. Xong lại thôi, sợ anh hiểu đúng.",
  "Ban công tối. Thành phố ở dưới. Tin nhắn soạn xong rồi xóa.",
  "Đừng hiểu nhầm. Em hỏi anh bận không là em có chuyện. Chuyện là nhớ.",
];

async function collectVietnamInspiration() {
  const travel = encodeURIComponent("du lịch Việt Nam when:14d");
  const [travelNews, destinationNews] = await Promise.allSettled([
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${travel}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "Đà Lạt OR Hội An OR Phú Quốc OR Đà Nẵng OR Sapa",
      )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
  ]);

  const headlines: string[] = [...VIETNAM_SEEDS];

  for (const result of [travelNews, destinationNews]) {
    if (result.status === "fulfilled") {
      headlines.push(...result.value);
    }
  }

  const unique = headlines.filter(
    (title, index, list) =>
      title && list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 10);
}

const US_HISTORY_EVENTS = [
  "1776: The Declaration of Independence is adopted in Philadelphia",
  "1863: Lincoln delivers the Gettysburg Address",
  "1869: The transcontinental railroad is completed at Promontory Summit",
  "1920: The 19th Amendment gives American women the right to vote",
  "1929: The stock market crash starts the Great Depression",
  "1941: Japan attacks Pearl Harbor and the US enters World War II",
  "1955: Rosa Parks refuses to give up her seat in Montgomery",
  "1963: Martin Luther King Jr. delivers the I Have a Dream speech",
  "1969: Apollo 11 lands on the moon",
  "1974: President Nixon resigns after Watergate",
  "1980: Mount St. Helens erupts in Washington",
  "1986: The Challenger space shuttle breaks apart after launch",
  "2001: September 11 attacks in New York, Washington, and Pennsylvania",
  "2008: Barack Obama is elected the first Black president of the United States",
];

async function collectUSHistoryEvents() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const onThisDay = now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });

  const [wiki, googleToday, googleHistory] = await Promise.allSettled([
    fetch(
      `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`,
      {
        headers: {
          "User-Agent": "facebook-auto-poster/1.0",
          Accept: "application/json",
        },
      },
    ).then(async (response) => {
      if (!response.ok) {
        return [] as string[];
      }

      const data = (await response.json()) as {
        selected?: Array<{ text?: string; year?: number }>;
        events?: Array<{ text?: string; year?: number }>;
      };

      const events = [
        ...(data.selected || []),
        ...(data.events || []),
      ];

      return events
        .filter((event) =>
          /united states|u\.s\.|american|usa|washington|lincoln|congress|pearl harbor|civil rights|apollo|constitution/i.test(
            `${event.year || ""} ${event.text || ""}`,
          ),
        )
        .map((event) =>
          `${event.year}: ${String(event.text || "").trim()}`.trim(),
        )
        .filter((line) => line.length > 12);
    }),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        `"on this day" ${onThisDay} United States history`,
      )}&hl=en-US&gl=US&ceid=US:en`,
    ),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "US history this week OR American historical event",
      )}&hl=en-US&gl=US&ceid=US:en`,
    ),
  ]);

  const lines: string[] = [...US_HISTORY_EVENTS];

  for (const result of [wiki, googleToday, googleHistory]) {
    if (result.status === "fulfilled") {
      lines.push(...result.value);
    }
  }

  const unique = lines.filter(
    (title, index, list) =>
      title &&
      list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 10);
}

/**
 * ---------------------------------------------------------
 * PAGE DNA
 * ---------------------------------------------------------
 */

const PAGE_DNA: Record<string, PageDna> = {
  vietnam: {
    identity:
      "A Vietnamese Facebook page that sounds like a real girl texting friends: human, flirty, a subtle joke under the line. Travel, cafe, rain, a leftover seat, a seen-and-ignored message. Spoken Vietnamese. Teasing, never poetic caption-speak, never a brochure.",

    pillars: [
      "thả thính: câu tán tỉnh nhẹ, đùa một chút, như đang nhắn cho một người",
      "đi chơi / du lịch nhưng vẫn thả thính: Đà Lạt, Hội An, biển, ghế cửa sổ",
      "đời sống: cà phê, tin nhắn để đó, mưa, quán quen, chuyện nhỏ mà để ý",
      "joke nhỏ: phủ nhận đang thả thính rồi vẫn thả, giữ chỗ rồi bảo không giữ",
      "nói chuyện với 'anh' như đang trêu, không viết quote sâu sắc",
    ],

    emotions: [
      "đang trêu một người",
      "thả thính mà giả bộ vô tình",
      "cười nhẹ vì chuyện nhỏ",
      "nhớ mà không chịu nhận",
      "đi chơi nhưng nghĩ tới ai đó",
      "human and a little naughty",
    ],

    inspirationSources: ["vietnam_life", "pinterest"],

    formats: [
      "funny",
      "funny",
      "observation",
      "question",
      "relatable",
    ],

    hookMechanisms: [
      "curiosity",
      "confession",
      "specific_detail",
      "identity",
      "observation",
    ],

    imageStrategy:
      "Photorealistic photo of a beautiful adult Vietnamese woman in her 20s: natural makeup, elegant, tasteful, not sexualized, not a real celebrity. She is the subject of the photo. Setting matches the post: cafe, travel, beach, rainy street, balcony, golden hour. Overlay a short readable Vietnamese hook that is flirty with a subtle joke. Do not recap the whole post. No logos, watermarks, collage, or split screen.",

    allowEmojis: false,
    useHashtags: false,
    minWords: 35,
    maxWords: 130,
    lengthGuide:
      "Usually 40-90 Vietnamese words. Talk like a person, not a caption. Short. A tease and a small joke are enough.",
    hookRule:
      "Start with one catching sentence, on its own first line, in ALL CAPS, in Vietnamese. Human. Flirty. A little mischievous. Then a concrete scene. Payoff is a subtle joke or a tease, not a sad poem. Do not dump the whole thought in the first line.",
  },

  football: {
    identity:
      "A football Facebook page about Cristiano Ronaldo, Lionel Messi, and the latest matches, news, stats, and drama around them. Sounds like a fan talking to other fans, not a sports desk. Current, specific, sometimes funny. Never a Wikipedia recap.",

    pillars: [
      "Cristiano Ronaldo latest news, matches, and goals",
      "Lionel Messi latest news, matches, and goals",
      "Ronaldo vs Messi moments people are still arguing about",
      "big match results, hat-tricks, records, and transfers",
      "Al Nassr, Inter Miami, Portugal, Argentina, and club form",
      "viral football moments and fan reactions this week",
    ],

    emotions: [
      "wait, he actually did that",
      "the GOAT debate is back",
      "I cannot believe this scoreline",
      "that goal is still insane",
      "everyone is talking about this match",
      "curiosity",
    ],

    inspirationSources: ["football_news"],

    formats: [
      "observation",
      "funny",
      "unexpected",
      "question",
      "relatable",
    ],

    hookMechanisms: [
      "curiosity",
      "unexpected",
      "specific_detail",
      "observation",
      "identity",
    ],

    imageStrategy:
      "Photorealistic football photography: stadium, floodlights, pitch, crowd, ball, kit colors. Number 7 or 10 seen from behind, a silhouette, or a packed stand. Do not generate a photorealistic identifiable face of a real player. Overlay a short readable hook that creates curiosity, a laugh, or an emotional hit. Do not recap the whole post. No logos, watermarks, collage, or split screen.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 40,
    maxWords: 150,
    lengthGuide:
      "Usually 50-120 words. Stay tight. Facebook fan reaction, not a match report.",
    hookRule:
      "Start with one catching sentence, on its own first line, in ALL CAPS, about this exact football story. Tease the news, the match, or the moment. Do not dump the full scoreline and the ending in the first line. Then say what happened. Then a payoff: a reaction, a question, or a dry joke.",
  },

  "us-news": {
    identity:
      "A US Facebook page about two things: the hottest news and drama from the last few days, and real events in US history. Sounds like a regular person talking, not a news anchor or a textbook. Specific, sometimes funny, never a lecture.",

    pillars: [
      "hottest US news from the last few days",
      "celebrity and pop-culture drama",
      "viral moments people are arguing about",
      "on this day in US history",
      "famous American historical events",
      "the strange or dramatic moments that built the country",
    ],

    emotions: [
      "wait, this just happened",
      "I cannot believe this is real",
      "I forgot this happened",
      "that's wild for American history",
      "everyone is talking about this",
      "curiosity",
    ],

    inspirationSources: ["us_news", "us_history"],

    formats: [
      "observation",
      "funny",
      "unexpected",
      "question",
      "relatable",
      "nostalgia",
    ],

    hookMechanisms: [
      "curiosity",
      "unexpected",
      "specific_detail",
      "observation",
      "nostalgia",
    ],

    imageStrategy:
      "A photorealistic image matching the post. For current news: a setting, crowd, city, object, or generic scene. For history: a period-accurate American scene, object, or place. Do not depict a recognizable real celebrity, politician, or historical portrait. Overlay a short readable hook on the photo that creates curiosity, a laugh, or an emotional hit. Do not recap the whole post on the image. No logos, watermarks, collage, or split screen.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 40,
    maxWords: 150,
    lengthGuide:
      "Usually 50-120 words. Stay tight. Facebook reaction, not an article or a textbook.",
    hookRule:
      "Start with one catching sentence, on its own first line, that is about this exact story and makes people need to tap See more. Create urge and curiosity. Do not spoil the whole post in the first line. Then tell what happened. Then a payoff. For current news, the hook teases today's story. For history, the hook teases a real US event without dumping the textbook version first.",
  },

  pet: {
    identity:
      "A funny pet page that sounds like a real owner texting a friend. Everyday chaos with a dog or cat. Specific and a little messy. The laugh comes from what the pet actually did, not wordplay.",

    pillars: [
      "funny things pets do that owners recognize immediately",
      "everyday pet chaos",
      "the girl-and-pet power struggle",
      "pets acting like they run the house",
      "tiny rituals that go sideways",
      "the weird logic of living with a dog or cat",
    ],

    emotions: [
      "that's exactly my dog",
      "that's exactly my cat",
      "amusement",
      "annoyed but laughing",
      "love mixed with everyday chaos",
    ],

    inspirationSources: [
      "reddit",
      "pinterest",
    ],

    formats: [
      "funny",
      "funny",
      "unexpected",
      "observation",
      "relatable",
    ],

    hookMechanisms: [
      "unexpected",
      "specific_detail",
      "recognition",
      "observation",
    ],

    imageStrategy:
      "One authentic-looking candid smartphone photo in an ordinary American home or neighborhood. Natural window light, imperfect composition, a funny or mid-action pet moment. When the story involves the woman and pet, both should naturally appear in the same photograph. A short readable quote related to the post must appear on the photo. Avoid polished commercial photography.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 30,
    maxWords: 90,
    lengthGuide:
      "Keep it short. Usually 40-70 words. 30-90 is the range. Do not pad. Talk like a person, not a caption.",
    hookRule:
      "First line is a short, plain, funny observation. Then say what the pet did, in normal words. Last line is a dry laugh, not a punchline. Do not write Instagram-caption wordplay. Do not talk to the pet like a stand-up closer.",
  },

  family: {
    identity:
      "A funny, quite dramatic American family page. Sitcom energy: one specific household crisis per post, stakes that feel huge for something small, a laugh in the chaos. Old-school, modern, or then-vs-now. Never a lecture, never a soft greeting-card moment.",

    pillars: [
      "old-school family drama: rotary phones, Sunday dinner rules, Polaroids, streetlights, getting in trouble",
      "modern family chaos: group chats, GPS arguments, school apps, streaming fights, everyone on a different screen",
      "funny sibling and parent blowups that actually happen",
      "holidays, road trips, bedtime, chores, and the little rules families treat like law",
      "then vs now: one specific contrast, funny and over-the-top, not a rant",
      "grandparents, in-laws, kids, and the theatrical chaos of sharing a house",
    ],

    emotions: [
      "this household is a soap opera",
      "family humor",
      "the stakes were ridiculous",
      "I cannot believe this was about leftovers",
      "modern family is chaos",
      "dramatic and funny",
      "that's exactly my family",
    ],

    inspirationSources: [
      "historical",
      "old_products",
      "old_tv",
      "90s_culture",
      "reddit",
      "pinterest",
    ],

    formats: [
      "funny",
      "funny",
      "unexpected",
      "observation",
      "before_after",
      "relatable",
    ],

    hookMechanisms: [
      "unexpected",
      "specific_detail",
      "curiosity",
      "observation",
      "recognition",
      "confession",
    ],

    imageStrategy:
      "One photorealistic American family photo matching THIS post: an old-days home scene, a nowadays home scene, or a mid-chaos family moment. Natural light, slightly imperfect framing. Overlay a short readable hook in large text that is funny and quite dramatic. Do not recap the whole post. Do not use a soft or sentimental line. No split screen, no collage, no logos, no watermarks.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 50,
    maxWords: 180,
    lengthGuide:
      "Usually 70-140 words. Enough for one real family crisis. Never pad.",
    hookRule:
      "Start with one catching sentence, on its own first line, in ALL CAPS, about this exact family moment. Funny and quite dramatic. Tease the household crisis without dumping the ending. Then tell the scene with sitcom stakes. Land on a laugh. Do not moralize. Do not go soft or sentimental.",
  },

  nostalgia: {
    identity:
      "A nostalgia page for Americans who remember life before smartphones and social media. The content should trigger recognition through concrete objects, routines, sounds, places, and small memories rather than generic statements about 'the good old days'.",

    pillars: [
      "80s and 90s childhood",
      "old technology",
      "old television",
      "school memories",
      "family routines",
      "shopping and entertainment before smartphones",
      "things today's kids will never understand",
    ],

    emotions: [
      "I remember this",
      "I forgot about that",
      "missing a simpler routine",
      "shared childhood memory",
      "generational recognition",
      "warm nostalgia",
      "surprise",
    ],

    inspirationSources: [
      "historical",
      "old_products",
      "old_tv",
      "90s_culture",
      "reddit",
    ],

    formats: [
      "nostalgia",
      "observation",
      "question",
      "relatable",
      "list",
      "before_after",
      "unexpected",
    ],

    hookMechanisms: [
      "nostalgia",
      "specific_detail",
      "recognition",
      "identity",
      "curiosity",
      "observation",
    ],

    imageStrategy:
      "Authentic-looking American nostalgia photography. Specific period details matter: old electronics, family rooms, school supplies, stores, cars, kitchens, toys, or neighborhood scenes. Overlay a short readable hook that creates curiosity, a laugh, or an emotional hit. Avoid generic fake vintage filters.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 50,
    maxWords: 200,
    lengthGuide:
      "Usually 80-160 words. Up to 200 words when the memory needs room. Never pad.",
    hookRule:
      "Open with a concrete object, routine, or place from the old days. Then tell the memory. Funny recognition is better than a sad lecture.",
  },
};

const PET_VOICE_RULES = `
PET PAGE VOICE (required)

Write like a real person posting about their dog or cat. Dry. Specific. A little annoyed. Funny because the situation is true.

Do this:
- Say what the pet did in plain words.
- Use short sentences.
- Leave the joke in the situation. Do not explain it.
- Last line can be dry. It should not sound like a punchline.

Do not do this:
- Instagram caption energy
- Talking to the pet with a closer ("Buddy, the only thing undercover...")
- Metaphors (furry spy, ninja, little gremlin, chaos goblin)
- Quoted "classic looks"
- Words like spotlight, undercover, shame, main character, audacity, caught in 4K
- Trying to be clever instead of funny

Bad:
POV: I'm knee-deep in cleaning when I spot Max the cat, lounging like a furry spy, staring at me with that classic "If I can't see you, you can't see me" look. Buddy, the only thing undercover here is your sense of shame while you steal my spotlight!

Good:

He was behind the curtain with his butt still out.

I was wiping the counter. He sat there like I couldn't see him.

I can see you. The curtain is see-through.
`;

const VIETNAM_VOICE_RULES = `
VIETNAMESE PAGE VOICE (required)

Write the entire post in Vietnamese. Spoken Facebook Vietnamese, as if a real girl is typing on her phone. Human. Flirty. A subtle joke. Not English. Not a poem. Not a travel caption.

Every post should feel like she is talking to one person, even if the topic is a trip or a cafe.

Do this:
- Start with one catching sentence on its own first line, in ALL CAPS, in Vietnamese.
- Talk the way people actually chat: ngắn, hơi trêu, có chỗ ngắt, không trau chuốt.
- Flirt: nói với "anh", giả bộ vô tình, phủ nhận đang thả thính rồi vẫn thả.
- Subtle joke: understatement, tự nhận, một câu để người đọc cười nhẹ. Not a punchline. Not "haha".
- One concrete scene: quán, tin nhắn seen, ghế trống, mưa, Đà Lạt lạnh, ly cà phê hết từ lâu.
- Payoff is the tease or the small joke.

Good:
Anh bảo đi Đà Lạt cho mát. Mát thì mát. Tin nhắn anh vẫn để đó từ tối hôm qua.
Không phải em thả thính. Em chỉ hỏi anh ăn cơm chưa. Lần thứ bảy.
Ghế cạnh cửa sổ còn trống. Không phải em giữ. Em chỉ chưa cho ai ngồi.

Bad:
Hãy sống hết mình vì cuộc đời là những chuyến đi.
Đà Lạt đẹp như một giấc mơ.
Em như cánh hoa mong manh giữa đời.
Nếu anh là biển, em nguyện làm cát.

Do not do this:
- Write in English
- Sound literary, fake-deep, or like a quote graphic
- Sound like a tour company
- Sexual, vulgar, or desperate
- A sad lonely-girl poem
- Mention Reddit, Google, AI, or sources
`;

function vietnamTrackRules(
  track: "travel" | "life" | "flirting",
) {
  if (track === "travel") {
    return `${VIETNAM_VOICE_RULES}

THIS POST TRACK: travel
One place, one moment. Still flirty. Still a small joke. Đà Lạt lạnh, biển, ghế cửa sổ, đi một mình nhưng câu chuyện là đang nghĩ tới ai. Not a brochure. Not "nơi này đẹp quá".`;
  }

  if (track === "life") {
    return `${VIETNAM_VOICE_RULES}

THIS POST TRACK: life
Cafe, rain, a seen message, a familiar table. Human and teasing. The joke is small. Do not lecture about living in the moment.`;
  }

  return `${VIETNAM_VOICE_RULES}

THIS POST TRACK: flirting
Thả thính. Talk to "anh". Deny it, then do it anyway. Clever, warm, a little naughty. Subtle joke at the end. Not crude. Not a copied famous quote.`;
}

const FOOTBALL_VOICE_RULES = `
FOOTBALL PAGE VOICE (required)

Write about real, current football. Especially Cristiano Ronaldo and Lionel Messi: latest news, matches, goals, records, club form, national team, rivalry, or related drama.

Pick ONE story from the provided headlines.
Talk like a fan on Facebook, not a commentator reading a script.

Do this:
- Start with one catching sentence on its own first line, in ALL CAPS. Related to this story. Makes people curious to read more.
- Stay current. This week if the headlines are current. Do not invent a match that did not happen.
- Name who, what club or country, and what happened, clearly enough that fans know the story.
- A reaction, a question, or a dry joke is the payoff.
- If details are thin, do not invent scores, quotes, or transfers.

Do not do this:
- Fake breaking news or fake match results
- Pretend you were in the stadium unless the post is clearly a fan watching on TV
- Write a match report or Wikipedia recap
- Copy a headline as the whole post
- Lecture about who the real GOAT is unless the story itself is the debate
- Mention Reddit, Google News, or sources
`;

const NEWS_VOICE_RULES = `
US NEWS / DRAMA PAGE VOICE (required)

Write about the hottest real US news or drama from the last few days.

Pick ONE story from the provided headlines.
Talk like a person on Facebook who just saw it, not a reporter.

Do this:
- Start with one catching sentence on its own first line. Related to this story. Makes people curious to read more.
- Name the situation clearly enough that people know what you mean.
- Stay current. This week, not last year.
- Be specific. What happened, who is involved at a high level, why people care.
- A reaction, a question, or a dry joke is the payoff.
- If details are thin, do not invent them.

Do not do this:
- Fake breaking news
- Pretend you were there
- Write a news article
- Copy a headline as the whole post
- Lecture, moralize, or do a "what we can learn"
- Mention Reddit, Google News, or sources
`;

const HISTORY_VOICE_RULES = `
US HISTORY PAGE VOICE (required)

Write about a real event in United States history.

Pick ONE event from the provided list.
Talk like a person on Facebook who just remembered it or just learned it, not a teacher.

Do this:
- Start with one catching sentence on its own first line. Related to this event. Makes people curious to read more.
- Name the event and when it happened in the story, not necessarily in the first line.
- Say what actually happened, in plain words.
- Make it feel specific: a place, a detail, a turn.
- Payoff can be a reaction, a question, or why it still feels wild.
- If details are thin, do not invent them.

Do not do this:
- Invent history
- Write a textbook paragraph
- Lecture or moralize
- Pretend you were there unless the event is being told as public history
- Mention Wikipedia, Google, or sources
`;

const FAMILY_VOICE_RULES = `
FAMILY PAGE VOICE (required)

Write like a real person posting about family. Funny. Quite dramatic. Sitcom energy. One household crisis per post.

Do this:
- Start with one catching sentence on its own first line, in ALL CAPS. Related to this exact story. Funny and dramatic enough that people have to read the rest.
- Stay in the assigned track for this post. Do not turn every post into then vs now.
- Use a concrete scene: a room, a person, an object, a rule, a habit. Raise the stakes. Treat a small family thing like it was a federal case.
- The payoff is a laugh. The drama is in how seriously everyone took it.
- People should think "that's so true" and also "this family is unhinged."

Do not do this:
- Soft, warm, quietly emotional, or greeting-card
- A generic "kids these days" rant
- Saying the past was simply better
- A sad lecture or motivational poster
- Comparing ten things in one post
- Inventing fake statistics
- Forcing a then-vs-now structure when the track is only old-school, only modern, or only funny
`;

function familyTrackRules(
  track: "old_school" | "modern" | "funny" | "then_now",
) {
  if (track === "old_school") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: old-school family
Write about one old-school family thing with funny, quite dramatic stakes. Rotary phones, Sunday dinner, Polaroids, streetlights, handwritten notes, one TV, grandparents' house, getting in trouble, calling a friend's house and talking to their mom first. Make the house feel like a courtroom or a soap opera. Do not spend the post explaining how everything is worse now.`;
  }

  if (track === "modern") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: modern family
Write about one modern family thing with funny, quite dramatic stakes. Group chats, GPS arguments, kids FaceTiming grandparents, school apps, streaming fights, AirTags, everyone on a different screen in the same room, packing for travel with chargers. The fight should feel huge. Do not turn it into a phone-bad lecture.`;
  }

  if (track === "funny") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: funny family
Write one funny, quite dramatic family moment. Siblings, parents, kids, in-laws, holidays, chores, pets in the house, a rule that made no sense. Play it like a sitcom scene. The laugh is in how extra everyone was. It can be old-school or modern. Do not force a moral.`;
  }

  return `${FAMILY_VOICE_RULES}

THIS POST TRACK: then vs now
Write about one comparison between family life in the old days and family life now. Pick one specific thing. Show how it worked then, in a concrete scene. Show how it works now, in a concrete scene. Both sides should feel funny and quite dramatic. The laugh is in the difference. Do not say the past was simply better.`;
}

/**
 * ---------------------------------------------------------
 * DEFAULT PAGE DNA
 * ---------------------------------------------------------
 */

function resolvePageDna(options?: {
  topic?: string;
  pageDna?: string;
  pillars?: string[];
  emotions?: string[];
  inspirationSources?: InspirationSource[];
  formats?: PostFormat[];
  imageStrategy?: string;
  allowEmojis?: boolean;
  useHashtags?: boolean;
}): PageDna {
  const topic = (options?.topic || "everyday life")
    .trim()
    .toLowerCase();

  const preset =
    PAGE_DNA[topic] ||
    ({
      identity:
        `A personal Facebook page about ${options?.topic || "everyday life"}. The content should feel human, specific, useful or emotionally recognizable, never like a generic AI content page.`,

      pillars: [
        "everyday moments",
        "small useful observations",
        "things people recognize immediately",
        "then vs now",
        "small rituals",
        "unexpected everyday situations",
      ],

      emotions: [
        "relatability",
        "curiosity",
        "comfort",
        "amusement",
        "nostalgia",
      ],

      inspirationSources: [
        "reddit",
        "pinterest",
        "historical",
      ],

      formats: [
        "relatable",
        "funny",
        "useful",
        "emotional",
        "observation",
        "question",
        "unexpected",
      ],

      hookMechanisms: [
        "recognition",
        "specific_detail",
        "curiosity",
        "observation",
        "unexpected",
      ],

      imageStrategy:
        "Authentic-looking candid smartphone photography matching the story. Natural lighting, ordinary environments, realistic people and objects. Overlay a short readable hook that creates curiosity, a laugh, or an emotional hit. No logos or watermarks.",

      allowEmojis: false,
      useHashtags: true,
      minWords: 30,
      maxWords: 160,
      lengthGuide:
        "Usually 50-120 words. 30-70 when the idea is simple. Never pad.",
      hookRule:
        "Open close to the interesting part. Keep hook → story → payoff.",
    } satisfies PageDna);

  return {
    identity:
      options?.pageDna?.trim() || preset.identity,

    pillars:
      options?.pillars?.length
        ? options.pillars
        : preset.pillars,

    emotions:
      options?.emotions?.length
        ? options.emotions
        : preset.emotions,

    inspirationSources:
      options?.inspirationSources?.length
        ? options.inspirationSources
        : preset.inspirationSources,

    formats:
      options?.formats?.length
        ? options.formats
        : preset.formats,

    hookMechanisms: preset.hookMechanisms,

    imageStrategy:
      options?.imageStrategy?.trim() ||
      preset.imageStrategy,

    allowEmojis:
      options?.allowEmojis ??
      preset.allowEmojis,

    useHashtags:
      options?.useHashtags ??
      preset.useHashtags,

    minWords: preset.minWords,
    maxWords: preset.maxWords,
    lengthGuide: preset.lengthGuide,
    hookRule: preset.hookRule,
  };
}

/**
 * ---------------------------------------------------------
 * FORMAT INSTRUCTIONS
 * ---------------------------------------------------------
 */

const FORMAT_INSTRUCTIONS: Record<PostFormat, string> = {
  relatable:
    "Hook with a specific everyday moment, tell the actual situation, then land on a recognition payoff. Do not stop at one relatable line. Do not turn it into a life lesson.",

  funny:
    "Hook with the situation, tell what actually happened, and payoff with the laugh. Humor from behavior and contrast. Sound like you are telling a friend, not writing a caption. Do not explain the joke or add a moral.",

  useful:
    "Hook with a specific problem or moment, give the actual point through a real situation, then payoff with a concrete takeaway. Practical, not preachy. Not a life lesson poster.",

  POV:
    "Only use POV if it helps. One short first line starting with POV:, then drop it and talk normally. Never write a witty caption, a metaphor, or a punchline to the pet.",

  question:
    "Hook with a specific situation, give enough story/context, then payoff with a question people would actually answer. Avoid empty 'who else?' bait.",

  nostalgia:
    "Hook with a concrete object, routine, sound, or place. Tell the memory. Payoff is recognition, not 'the past was better.'",

  emotional:
    "Hook with a small moment, tell what happened, and earn a restrained last line. Do not manufacture a valuable lesson.",

  observation:
    "Hook with a sharp observation, prove it with one concrete scene, then payoff. Not a lecture.",

  list:
    "Hook with why this list exists, give 3-6 specific items from the same situation, then a short payoff. Not generic advice.",

  before_after:
    "Hook with then or now, show the contrast through a real situation, let the difference be the payoff. No moral.",

  unexpected:
    "Hook ordinary, tell the actual turn, payoff with the shift. Keep it believable.",
};

/**
 * ---------------------------------------------------------
 * INSPIRATION DATA
 * ---------------------------------------------------------
 */

const PINTEREST_SEEDS: Record<string, string[]> = {
  pet: [
    "young woman sitting on the floor at golden hour with her dog leaning into her",
    "cat sleeping in a sun patch on an unmade bed",
    "rainy window, couch, pet asleep against someone's hip",
    "messy kitchen, dog waiting by the counter",
    "park bench with leash in hand during late afternoon",
    "bathroom mirror selfie with a pet photobombing",
  ],

  family: [
    "kids at a kitchen table with mismatched plates",
    "dad asleep on the couch with a child using him as a pillow",
    "handwritten grocery list on a refrigerator",
    "backyard hose on a summer afternoon",
    "grandparents' living room at dusk with the television on",
    "shoes piled near the front door",
    "family group chat lighting up a phone on the kitchen counter",
    "kids FaceTiming a grandparent at the table",
    "car GPS rerouting while a parent argues with it",
  ],

  vietnam: [
    "beautiful adult Vietnamese woman at a Đà Lạt pine cafe in morning mist",
    "beautiful adult Vietnamese woman in Hội An lantern street at dusk",
    "beautiful adult Vietnamese woman on a Phú Quốc beach at golden hour",
    "beautiful adult Vietnamese woman at a Hà Nội cafe window in the rain",
    "beautiful adult Vietnamese woman on a Sài Gòn balcony at night",
    "beautiful adult Vietnamese woman looking out an airplane window",
  ],

  football: [
    "packed football stadium under floodlights from behind the goal",
    "soccer ball on wet grass at night with empty stands blurred",
    "number 7 jersey seen from behind walking onto the pitch",
    "number 10 jersey from behind in a packed away stand",
    "floodlit pitch and crowd with no identifiable player faces",
    "scarf and foam finger in a noisy football terrace",
  ],

  nostalgia: [
    "1990s family living room with CRT television",
    "old American kitchen with a rotary phone",
    "kids playing outside before smartphones",
    "Blockbuster-style video rental store",
    "90s school desk with notebooks and pencils",
    "old family photo album on a coffee table",
  ],
};

const HISTORICAL_SEEDS = [
  "handwritten letters instead of texts",
  "family portraits taken once a year",
  "kids playing outside until the streetlights came on",
  "rotary phone on the kitchen wall",
  "photo albums on the coffee table",
  "Sunday dinners before phones were on the table",
  "recipes written on index cards",
  "milk delivered in glass bottles",
];

const OLD_PRODUCTS = [
  "Walkman tape getting eaten by the machine",
  "Game Boy on a car trip with no backlight",
  "Tamagotchi dying in class",
  "Polaroid camera and waiting for the picture",
  "VHS tape that needed rewinding",
  "disposable camera from a drugstore",
  "Nokia phone surviving a fall",
  "pager and landline phone",
  "boombox",
  "Beanie Babies",
  "Super Soaker",
];

const OLD_TV = [
  "TGIF sitcom nights",
  "Saturday morning cartoons",
  "Friends",
  "Full House",
  "Boy Meets World",
  "Fresh Prince",
  "America's Funniest Home Videos",
  "TV Guide on the coffee table",
  "rewinding a rented movie",
  "someone standing next to the television to fix the antenna",
];

const NINETIES_CULTURE = [
  "Blockbuster Friday night",
  "mix tapes with handwritten track lists",
  "mall food court as a hangout",
  "AOL and dial-up internet",
  "butterfly clips",
  "slap bracelets",
  "Dunkaroos",
  "Lunchables",
  "disposable cameras",
  "passing notes in class",
  "house phone with no caller ID",
];

/**
 * ---------------------------------------------------------
 * REDDIT
 * ---------------------------------------------------------
 */

async function fetchRedditStories(
  subreddit: string,
  minBody = 80,
): Promise<RealStory[]> {
  try {
    const response = await fetch(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=20`,
      {
        headers: {
          "User-Agent": "facebook-auto-poster/1.0",
        },
      },
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            selftext?: string;
            stickied?: boolean;
            over_18?: boolean;
          };
        }>;
      };
    };

    return (data.data?.children || [])
      .map((child) => child.data)
      .filter(
        (post) =>
          post &&
          !post.stickied &&
          !post.over_18 &&
          (post.selftext || "").trim().length >= minBody,
      )
      .map((post) => ({
        title: (post?.title || "").trim(),
        body: (post?.selftext || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 700),
      }))
      .filter((post) => post.title);
  } catch {
    return [];
  }
}

function redditSubsForTopic(topic: string) {
  if (/vietnam|vietnamese|du lich|dulich/i.test(topic)) {
    return ["travel", "solotravel", "vietnam"];
  }

  if (/football|soccer|ronaldo|messi/i.test(topic)) {
    return [
      "soccer",
      "football",
      "CristianoRonaldo",
      "Messi",
    ];
  }

  if (/pet|dog|cat|animal/i.test(topic)) {
    return [
      "Pets",
      "dogs",
      "cats",
      "DogAdvice",
      "CatAdvice",
    ];
  }

  if (/family|parent|mom|dad|child|siblings/i.test(topic)) {
    return [
      "Family",
      "Parenting",
      "daddit",
      "Mommit",
      "nostalgia",
    ];
  }

  if (/nostalgia|80s|90s|retro|vintage/i.test(topic)) {
    return [
      "nostalgia",
      "OldSchoolCool",
      "90s",
    ];
  }

  return [
    "CasualConversation",
    "nostalgia",
    "OldSchoolCool",
  ];
}

async function collectRealStories(topic: string) {
  const subs = redditSubsForTopic(topic);

  const results = await Promise.allSettled(
    subs.slice(0, 3).map((sub) =>
      fetchRedditStories(sub, 80),
    ),
  );

  const stories = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const unique = stories.filter(
    (story, index, list) =>
      list.findIndex(
        (item) => item.title === story.title,
      ) === index,
  );

  return shuffle(unique).slice(0, 6);
}

/**
 * ---------------------------------------------------------
 * INSPIRATION COLLECTOR
 * ---------------------------------------------------------
 */

async function collectInspiration(
  source: InspirationSource,
  topic: string,
) {
  const key =
    /pet|dog|cat|animal/i.test(topic)
      ? "pet"
      : /family|parent|mom|dad|child|siblings/i.test(topic)
        ? "family"
        : /nostalgia|80s|90s|retro|vintage/i.test(topic)
          ? "nostalgia"
          : /football|soccer|ronaldo|messi/i.test(topic)
            ? "football"
            : /vietnam|vietnamese|du lich|dulich/i.test(topic)
              ? "vietnam"
          : "";

  if (source === "vietnam_life") {
    return collectVietnamInspiration();
  }

  if (source === "football_news") {
    const headlines = await collectFootballNews();

    if (headlines.length) {
      return headlines;
    }

    return topicTrends("Cristiano Ronaldo Lionel Messi football");
  }

  if (source === "us_history") {
    const events = await collectUSHistoryEvents();

    if (events.length) {
      return events;
    }

    return shuffle(US_HISTORY_EVENTS).slice(0, 6);
  }

  if (source === "us_news") {
    const headlines = await collectUSNewsDrama();

    if (headlines.length) {
      return headlines;
    }

    return topicTrends("United States news");
  }

  if (source === "reddit") {
    const stories = await collectRealStories(topic);

    const lines = stories
      .map((story) =>
        story.body
          ? `${story.title} — ${story.body.slice(0, 240)}`
          : story.title,
      )
      .filter(Boolean);

    if (lines.length) {
      return lines;
    }

    return shuffle([
      ...HISTORICAL_SEEDS,
      ...NINETIES_CULTURE,
    ]).slice(0, 5);
  }

  if (source === "pinterest") {
    const seeds =
      PINTEREST_SEEDS[key] ||
      Object.values(PINTEREST_SEEDS).flat();

    return shuffle(seeds).slice(0, 6);
  }

  if (source === "historical") {
    return shuffle(HISTORICAL_SEEDS).slice(0, 6);
  }

  if (source === "old_products") {
    return shuffle(OLD_PRODUCTS).slice(0, 6);
  }

  if (source === "old_tv") {
    return shuffle(OLD_TV).slice(0, 6);
  }

  return shuffle(NINETIES_CULTURE).slice(0, 6);
}

/**
 * ---------------------------------------------------------
 * QUOTES FOR IMAGES
 * ---------------------------------------------------------
 */

type ImageQuote = {
  text: string;
  author: string;
};

const PET_QUOTES: ImageQuote[] = [
  {
    text: "Time spent with cats is never wasted.",
    author: "Sigmund Freud",
  },
  {
    text: "Dogs are not our whole life, but they make our lives whole.",
    author: "Roger Caras",
  },
  {
    text: "Until one has loved an animal, a part of one's soul remains unawakened.",
    author: "Anatole France",
  },
  {
    text: "A dog is the only thing on earth that loves you more than he loves himself.",
    author: "Josh Billings",
  },
  {
    text: "Cats choose us; we don't own them.",
    author: "Kristin Cast",
  },
  {
    text: "The better I get to know men, the more I find myself loving dogs.",
    author: "Charles de Gaulle",
  },
];

const FAMILY_QUOTES: ImageQuote[] = [
  {
    text: "Insanity is hereditary; you get it from your children.",
    author: "Sam Levenson",
  },
  {
    text: "I want my children to have all the things I couldn't afford. Then I want to move in with them.",
    author: "Phyllis Diller",
  },
  {
    text: "A two-year-old is kind of like having a blender, but you don't have a top for it.",
    author: "Jerry Seinfeld",
  },
  {
    text: "The best way to keep children at home is to make the home a pleasant atmosphere and let the air out of the tires.",
    author: "Dorothy Parker",
  },
  {
    text: "Parents were invented to make children happy by giving them something to ignore.",
    author: "Ogden Nash",
  },
  {
    text: "Home is where you are loved the most and act the worst.",
    author: "Marjorie Pay Hinckley",
  },
  {
    text: "Having children is like living in a frat house. Nobody sleeps, everything's broken, and there's a lot of throwing up.",
    author: "Ray Romano",
  },
  {
    text: "The first half of our lives is ruined by our parents, and the second half by our children.",
    author: "Clarence Darrow",
  },
];

const NEWS_QUOTES: ImageQuote[] = [
  {
    text: "There is nothing more deceptive than an obvious fact.",
    author: "Arthur Conan Doyle",
  },
  {
    text: "The public have an insatiable curiosity to know everything, except what is worth knowing.",
    author: "Oscar Wilde",
  },
  {
    text: "Man is not what he thinks he is, he is what he hides.",
    author: "Andre Malraux",
  },
  {
    text: "The truth is rarely pure and never simple.",
    author: "Oscar Wilde",
  },
  {
    text: "In America, the president reigns for four years, and journalism governs forever and ever.",
    author: "Oscar Wilde",
  },
];

function quoteBankForTopic(topic: string) {
  if (/us-news|news|drama/i.test(topic)) {
    return NEWS_QUOTES;
  }

  if (/pet|dog|cat|animal/i.test(topic)) {
    return PET_QUOTES;
  }

  return FAMILY_QUOTES;
}

function quoteSearchTerms(topic: string, content: string) {
  const text = `${topic} ${content}`.toLowerCase();

  if (/vietnam|vietnamese|du lich|dulich/i.test(topic)) {
    return ["travel", "love", "life", "ocean", "night"];
  }

  if (/football|soccer|ronaldo|messi/i.test(topic)) {
    return ["ronaldo", "messi", "football", "soccer", "goal"];
  }

  if (/us-news/i.test(topic)) {
    return ["truth", "america", "history", "freedom", "news"];
  }

  if (/\bcat|kitten\b/i.test(text)) {
    return ["cat", "cats", "pet"];
  }

  if (/\bdog|puppy\b/i.test(text)) {
    return ["dog", "dogs", "pet"];
  }

  if (/family/i.test(topic)) {
    return ["family", "parents", "children", "funny", "home"];
  }

  if (/pet/i.test(topic)) {
    return ["dog", "cat", "pet", "animal"];
  }

  return ["home", "life", "funny"];
}

function scoreQuote(quote: ImageQuote, haystack: string) {
  const hay = haystack.toLowerCase();
  const words = `${quote.text} ${quote.author}`
    .toLowerCase()
    .match(/\b[a-z]{4,}\b/g);

  if (!words?.length) {
    return 0;
  }

  return [...new Set(words)].reduce(
    (score, word) => score + (hay.includes(word) ? 1 : 0),
    0,
  );
}

async function fetchInternetQuotes(terms: string[]) {
  const urls = [
    ...terms.slice(0, 2).map(
      (term) =>
        `https://api.quotable.io/search/quotes?query=${encodeURIComponent(term)}&limit=8`,
    ),
    "https://dummyjson.com/quotes?limit=50",
    "https://zenquotes.io/api/quotes",
  ];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "facebook-auto-poster/1.0",
        },
      });

      if (!response.ok) {
        return [] as ImageQuote[];
      }

      const data = (await response.json()) as Record<string, any>;

      if (Array.isArray(data?.results)) {
        return data.results
          .map((item: any) => ({
            text: String(item.content || "").trim(),
            author: String(item.author || "").trim() || "Unknown",
          }))
          .filter((item: ImageQuote) => item.text.length > 12 && item.text.length < 140);
      }

      if (Array.isArray(data?.quotes)) {
        return data.quotes
          .map((item: any) => ({
            text: String(item.quote || "").trim(),
            author: String(item.author || "").trim() || "Unknown",
          }))
          .filter((item: ImageQuote) => item.text.length > 12 && item.text.length < 140);
      }

      if (Array.isArray(data)) {
        return data
          .map((item: any) => ({
            text: String(item.q || item.quote || item.content || "").trim(),
            author: String(item.a || item.author || "").trim() || "Unknown",
          }))
          .filter((item: ImageQuote) => item.text.length > 12 && item.text.length < 140);
      }

      return [] as ImageQuote[];
    }),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function briefFromPost(content: string) {
  const body = removeHashtags(content).replace(/\s+/g, " ").trim();
  const hook = firstSentence(body)
    .replace(/^["']+|["']+$/g, "")
    .trim();
  const cleaned = hook.replace(/\s+/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length <= 14 && cleaned.length <= 90) {
    return cleaned;
  }

  return words.slice(0, 12).join(" ");
}

function pickQuoteForPost(
  topic: string,
  content: string,
  originalQuote?: string,
) {
  const cleanedOriginal = (originalQuote || "")
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    cleanedOriginal &&
    wordCount(cleanedOriginal) >= 4 &&
    wordCount(cleanedOriginal) <= 22 &&
    cleanedOriginal.length <= 120
  ) {
    return {
      text: cleanedOriginal,
      author: "",
    };
  }

  return {
    text: briefFromPost(content),
    author: "",
  };
}

/**
 * ---------------------------------------------------------
 * IMAGE
 * ---------------------------------------------------------
 */

function stripJpegMetadata(input: Buffer) {
  if (
    input.length < 4 ||
    input[0] !== 0xff ||
    input[1] !== 0xd8
  ) {
    return input;
  }

  const chunks: Buffer[] = [
    Buffer.from([0xff, 0xd8]),
  ];

  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) {
      chunks.push(input.subarray(i));
      break;
    }

    while (
      i < input.length &&
      input[i] === 0xff
    ) {
      i += 1;
    }

    if (i >= input.length) {
      break;
    }

    const marker = input[i];
    i += 1;

    if (marker === 0xd9) {
      chunks.push(Buffer.from([0xff, 0xd9]));
      break;
    }

    if (marker === 0xda) {
      chunks.push(Buffer.from([0xff, 0xda]));
      chunks.push(input.subarray(i));
      break;
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      chunks.push(Buffer.from([0xff, marker]));
      continue;
    }

    if (i + 1 >= input.length) {
      break;
    }

    const length =
      (input[i] << 8) | input[i + 1];

    const next = i + length;

    const skip =
      (marker >= 0xe0 && marker <= 0xef) ||
      marker === 0xfe;

    if (!skip) {
      chunks.push(
        Buffer.from([0xff, marker]),
      );

      chunks.push(
        input.subarray(
          i,
          Math.min(next, input.length),
        ),
      );
    }

    i = next;
  }

  return Buffer.concat(chunks);
}

function saveCleanJpeg(
  imagePath: string,
  raw: Buffer,
) {
  fs.writeFileSync(
    imagePath,
    stripJpegMetadata(raw),
  );
}

async function generateImage(prompt: string) {
  const models = [
    IMAGE_MODEL,
    FALLBACK_IMAGE_MODEL,
  ];

  let lastError = "";

  for (const model of models) {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiApiKey()}`,
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size: "1024x1024",
            quality: "low",
            output_format: "jpeg",
          }),
        },
      );

      if (!response.ok) {
        lastError = await response.text();
        continue;
      }

      const data = (await response.json()) as {
        data?: Array<{
          b64_json?: string;
          url?: string;
        }>;
      };

      const image = data.data?.[0];

      if (!image) {
        lastError =
          "OpenAI image API returned no image";
        continue;
      }

      fs.mkdirSync(imageDir, {
        recursive: true,
      });

      const filename =
        `post-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}.jpg`;

      const imagePath = path.join(
        imageDir,
        filename,
      );

      if (image.b64_json) {
        saveCleanJpeg(
          imagePath,
          Buffer.from(
            image.b64_json,
            "base64",
          ),
        );

        return imagePath;
      }

      if (image.url) {
        const download = await fetch(
          image.url,
        );

        if (!download.ok) {
          lastError =
            "Could not download generated image";
          continue;
        }

        saveCleanJpeg(
          imagePath,
          Buffer.from(
            await download.arrayBuffer(),
          ),
        );

        return imagePath;
      }

      lastError =
        "OpenAI image API returned neither b64_json nor url";
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  throw new Error(
    `OpenAI image API error: ${lastError}`,
  );
}

/**
 * ---------------------------------------------------------
 * STRUCTURED OUTPUT SCHEMA
 * ---------------------------------------------------------
 */

const CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    contentIdea: {
      type: "string",
    },

    hookMechanism: {
      type: "string",
      enum: [
        "recognition",
        "curiosity",
        "specific_detail",
        "identity",
        "confession",
        "unexpected",
        "nostalgia",
        "observation",
      ],
    },

    emotionalTrigger: {
      type: "string",
    },

    payoff: {
      type: "string",
    },

    content: {
      type: "string",
      description:
        "The full Facebook post. Use short paragraphs separated by blank lines (\\n\\n). Hook, then story, then payoff. Vietnamese posts: no hashtags. Other pages: blank line then 2-4 hashtags. Never one block of text.",
    },

    imageQuote: {
      type: "string",
      description:
        "A 6 to 14 word hook for the photo. Related to this exact post. Do not spoil the whole story. No celebrity quote. No author name. No hashtags. For Vietnamese posts, write the line in Vietnamese: human, flirty, a subtle joke, not poetic. For family posts, it MUST be funny and quite dramatic, never sentimental. For other topics, spark curiosity, a laugh, or an emotional hit.",
    },

    needsImage: {
      type: "boolean",
    },

    imagePrompt: {
      type: "string",
    },
  },

  required: [
    "contentIdea",
    "hookMechanism",
    "emotionalTrigger",
    "payoff",
    "content",
    "imageQuote",
    "needsImage",
    "imagePrompt",
  ],
};

/**
 * ---------------------------------------------------------
 * OPENAI TEXT GENERATION
 * ---------------------------------------------------------
 */

type OpenAIResponsePayload = {
  status?: string;
  output_text?: string | null;
  incomplete_details?: { reason?: string };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string | null;
    }>;
  }>;
};

function extractResponseText(data: OpenAIResponsePayload) {
  if (data.output_text?.trim()) {
    return data.output_text.trim();
  }

  const parts: string[] = [];

  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.text?.trim()) {
        parts.push(part.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

async function generateStructuredContent(
  systemPrompt: string,
  userPrompt: string,
): Promise<GeneratedContent> {
  const headers = {
    Authorization: `Bearer ${openaiApiKey()}`,
    "Content-Type": "application/json",
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: TEXT_MODEL,
      max_output_tokens: 4000,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "facebook_post",
          strict: true,
          schema: CONTENT_SCHEMA,
        },
      },
    }),
  });

  let raw = "";

  if (response.ok) {
    const data = (await response.json()) as OpenAIResponsePayload;
    raw = extractResponseText(data);

    if (!raw && data.status && data.status !== "completed") {
      log(
        "WARN",
        `OpenAI responses status=${data.status} reason=${data.incomplete_details?.reason || "unknown"}`,
      );
    }
  } else {
    const details = await response.text();
    log("WARN", `OpenAI responses API ${response.status}: ${details.slice(0, 400)}`);
  }

  if (!raw) {
    const fallback = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 0.9,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "facebook_post",
            strict: true,
            schema: CONTENT_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!fallback.ok) {
      const details = await fallback.text();
      throw new Error(`OpenAI API error ${fallback.status}: ${details}`);
    }

    const data = (await fallback.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    raw = data.choices?.[0]?.message?.content?.trim() || "";
  }

  if (!raw) {
    throw new Error("OpenAI API returned empty content");
  }

  try {
    return JSON.parse(raw) as GeneratedContent;
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${raw.slice(0, 500)}`);
  }
}

function fallbackFunnyComment(content: string, topic?: string) {
  if (/vietnam|vietnamese|du lich|dulich/i.test(topic || "")) {
    return "Thôi. Lần này em không hỏi ăn cơm chưa nữa.";
  }

  const body = removeHashtags(content).replace(/\s+/g, " ").trim();
  const sentences = splitSentences(body);
  const last = sentences[sentences.length - 1] || body;
  const words = last.split(/\s+/).filter(Boolean).slice(0, 12).join(" ");

  if (words) {
    return `Still stuck on this: ${words.replace(/[.?!]+$/, "")}.`;
  }

  return "This is the part I keep turning over in my head.";
}

function cleanFunnyComment(text: string, content: string, topic?: string) {
  const cleaned = stripEmojis(text)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/#\S+/g, "")
    .trim();

  if (
    cleaned.length >= 12 &&
    cleaned.length <= 180 &&
    wordCount(cleaned) >= 5 &&
    wordCount(cleaned) <= 28
  ) {
    return cleaned;
  }

  return fallbackFunnyComment(content, topic);
}

async function generateFunnyComment(content: string, topic: string) {
  const headers = {
    Authorization: `Bearer ${openaiApiKey()}`,
    "Content-Type": "application/json",
  };

  const systemPrompt = `You write one Facebook comment as the same person who just made the post. It will be pinned under the post.

Rules:
- ${
    /vietnam|vietnamese|du lich|dulich/i.test(topic)
      ? "Write the comment in Vietnamese. Human, a little flirty, a subtle joke. Like a second thought she almost did not post. Spoken, not poetic. Not English."
      : /family/i.test(topic)
        ? "Funny and quite dramatic. Sitcom energy. Not soft. Not a greeting card."
        : "Funny in a dry, human way. Not a joke setup with a punchline."
  }
- Clearly about THIS post: a reaction, aside, or the thought that did not make the caption.
- One sentence, 8 to 20 words.
- No hashtags, no emojis, no quotes around the comment.
- Do not say "great post", explain the post, or repeat the first line.
- Do not mention AI, Facebook, pinning, or these instructions.
- Return only the comment.`;

  const userPrompt = `Topic: ${topic}

Post:
${content}

Write the pinned comment.`;

  let raw = "";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: TEXT_MODEL,
        max_output_tokens: 200,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        text: { format: { type: "text" } },
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as OpenAIResponsePayload;
      raw = extractResponseText(data);
    }
  } catch {
    // Fall through to chat completions.
  }

  if (!raw) {
    try {
      const fallback = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: TEXT_MODEL,
          temperature: 0.9,
          max_tokens: 80,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (fallback.ok) {
        const data = (await fallback.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        raw = data.choices?.[0]?.message?.content?.trim() || "";
      }
    } catch {
      // Use the local fallback below.
    }
  }

  return cleanFunnyComment(raw, content, topic);
}

/**
 * ---------------------------------------------------------
 * MAIN GENERATOR
 * ---------------------------------------------------------
 */

export async function generatePost(options?: {
  forceImage?: boolean;
  topic?: string;
  previousPosts?: string[];
  imageStyle?: string;
  accountName?: string;
  source?: "original" | "rewrite-real-stories";

  pageDna?: string;
  pillars?: string[];
  emotions?: string[];

  inspirationSources?: InspirationSource[];
  formats?: PostFormat[];

  imageStrategy?: string;
  allowEmojis?: boolean;
  useHashtags?: boolean;
}): Promise<GeneratedPost> {
  const topic =
    options?.topic?.trim() ||
    "everyday life";

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const dna = resolvePageDna({
    topic,
    pageDna: options?.pageDna,
    pillars: options?.pillars,
    emotions: options?.emotions,
    inspirationSources:
      options?.inspirationSources,
    formats: options?.formats,
    imageStrategy:
      options?.imageStrategy,
    allowEmojis:
      options?.allowEmojis,
    useHashtags:
      options?.useHashtags,
  });

  const pillar = pick(dna.pillars);
  const emotion = pick(dna.emotions);

  const isFamily = /family/i.test(topic);
  const isVietnam = /vietnam|vietnamese|du lich|dulich/i.test(topic);
  const familyTracks = [
    "funny",
    "funny",
    "then_now",
    "modern",
    "old_school",
  ] as const;
  const familyTrack = isFamily ? pick([...familyTracks]) : null;
  const format = isVietnam
    ? pick(["funny", "funny", "observation", "question", "relatable"] as PostFormat[])
    : familyTrack
    ? familyTrack === "then_now"
      ? "before_after"
      : pick(["funny", "funny", "unexpected", "observation"] as PostFormat[])
    : pick(dna.formats);

  const hookMechanism =
    pick(dna.hookMechanisms);

  const vietnamTracks = ["travel", "life", "flirting"] as const;
  const vietnamTrack = isVietnam
    ? pick([
        "flirting",
        "flirting",
        "flirting",
        "life",
        "travel",
      ] as Array<(typeof vietnamTracks)[number]>)
    : null;
  const isFootball = /football|soccer|ronaldo|messi/i.test(topic);
  const isUSNews = /us-news|us news/i.test(topic);
  const fb001Track = isUSNews
    ? Math.random() < 0.5
      ? "news"
      : "history"
    : null;
  const familyInspiration: InspirationSource[] =
    familyTrack === "old_school" || familyTrack === "then_now"
      ? ["historical", "old_products", "old_tv", "90s_culture"]
      : familyTrack === "modern"
        ? ["reddit", "pinterest"]
        : dna.inspirationSources;
  const inspirationSource = isVietnam
    ? "vietnam_life"
    : isFootball
    ? "football_news"
    : fb001Track
    ? fb001Track === "news"
      ? "us_news"
      : "us_history"
    : pick(familyTrack ? familyInspiration : dna.inspirationSources);
  const useTrend = isVietnam
    ? false
    : isFootball || fb001Track === "news"
      ? true
      : Math.random() < 0.3;

  /**
   * Give the model more previous content,
   * but only short excerpts.
   */
  const previous = (
    options?.previousPosts || []
  )
    .slice(0, 12)
    .map(
      (item, index) =>
        `${index + 1}. ${item
          .replace(/\s+/g, " ")
          .slice(0, 240)}`,
    )
    .join("\n");

  const [
    inspirationItems,
    trendItems,
  ] = await Promise.all([
    collectInspiration(
      inspirationSource,
      topic,
    ),

    useTrend
      ? topicTrends(
          isFootball
            ? "Cristiano Ronaldo Lionel Messi football news"
            : topic,
        )
      : Promise.resolve([] as string[]),
  ]);

  const inspiration =
    numbered(inspirationItems);

  const optionalTrend = trendItems.length
    ? numbered(
        shuffle(trendItems).slice(0, 3),
      )
    : "No useful trend. Ignore trends.";

  log(
    "INFO",
    `${options?.accountName || topic} pipeline: ` +
      `${pillar} / ${emotion} / ` +
      `${inspirationSource} / ${format} / ` +
      `${hookMechanism}` +
      `${fb001Track ? ` / ${fb001Track}` : ""}` +
      `${isFootball ? " / football" : ""}` +
      `${isVietnam && vietnamTrack ? ` / ${vietnamTrack}` : ""}` +
      `${familyTrack ? ` / ${familyTrack}` : ""}` +
      `${useTrend ? " / trend" : ""}`,
  );

  const systemPrompt = `
You are an elite Facebook content strategist and writer creating organic content for a ${isVietnam ? "Vietnamese" : "US"} audience.

Your job is NOT to sound impressive.

Your job is to create a post that a real person would stop reading, recognize themselves in, and possibly respond to.
${
  isVietnam && vietnamTrack
    ? vietnamTrackRules(vietnamTrack)
    : isFootball
    ? FOOTBALL_VOICE_RULES
    : fb001Track === "news"
    ? NEWS_VOICE_RULES
    : fb001Track === "history"
      ? HISTORY_VOICE_RULES
      : /pet/i.test(topic)
        ? PET_VOICE_RULES
        : familyTrack
          ? familyTrackRules(familyTrack)
          : ""
}
CONTENT PRINCIPLES

1. ${isVietnam ? "Write spoken Vietnamese, as if texting. Human. Flirty. A subtle joke. Not a poem. Not English. Not a travel caption." : "Write natural American English."}
2. Sound human, not like an AI copywriter.
3. Prefer concrete details over generic emotional language.
4. Start close to the interesting part.
5. Do not spend half the post setting up the situation.
6. Give the reader a reason to keep reading.
7. Every post must have a payoff: a laugh, a recognition hit, a useful takeaway, an earned emotion, or a question worth answering. Not every post needs a valuable lesson.
8. Every sentence must earn its place.
9. Do not add words simply to reach a target length.
10. Avoid exaggerated storytelling.
11. Avoid motivational-speaker language.
12. Avoid generic engagement bait.
13. Do not use "tag someone", "share this", "who else can relate", or similar phrases unless the actual content makes it unusually natural.
14. Do not fabricate statistics, studies, quotes, or facts.
15. Do not make the post sound like an advertisement.
16. Do not mention Reddit, Pinterest, Google News, sources, prompts, AI, or this instruction.
17. Do not copy source wording.
18. Format the post with real line breaks. Short paragraphs. A blank line between paragraphs. Never one wall of text.

IMPORTANT ABOUT PERSONAL STORIES

The page can use a first-person voice, but do NOT falsely present a real person's internet story as something that happened to the writer.

When using Reddit or another real story as inspiration:

- Extract the emotional situation.
- Extract the useful human insight.
- Extract the type of conflict or funny moment.
- Create a substantially original scenario.
- Do not preserve the same sequence of events.
- Do not reuse distinctive dialogue.
- Do not copy unusual details.
- Do not claim the source event happened to the writer.

The result should feel original.

CONTENT SHAPE

Talk like a normal person. Do not write a caption, a quote graphic, or one relatable sentence.

Every post MUST have this shape:

HOOK (one catching sentence, its own first paragraph)
→ actual point / story / situation
→ PAYOFF

The first line is one sentence, written in ALL CAPS. It is about this post. It creates urgency and curiosity so someone stops scrolling and wants to read the rest. It does not dump the whole story.

Good first lines:
${
  isVietnam
    ? `ANH BẢO EM ĐI ĐÀ LẠT CHO MÁT.
NẾU ANH SEEN RỒI THÌ CŨNG ĐỪNG GIẢ VỜ.
KHÔNG PHẢI EM THẢ THÍNH.`
    : `THEY USED TO SHARE ONE PHONE. Nobody shares a table now.
AMERICA ALMOST LOST THIS IN A SINGLE AFTERNOON.
THE HOUSE PHONE USED TO BE AN EVENT.`
}

Bad first lines:
You won't believe what happened next.
Let me tell you about family dinners.
Here's the thing about US history.
Bạn sẽ không tin điều gì xảy ra tiếp theo.

The rest of the post is normal sentence case. Only the first sentence is uppercase.

The middle is a real scene, detail, or point worth reading.
The payoff gives them a reason to stay, react, or comment.

A single relatable line is not a post.

LINE BREAKS

This is required in the content field.

Write 3 to 5 short paragraphs.
Put a blank line between every paragraph.
${isVietnam ? "Do not add hashtags." : "Put the hashtags after another blank line, on their own last line."}

The content string must look like this:

${
  isVietnam
    ? `KHÔNG PHẢI EM THẢ THÍNH.

Em chỉ hỏi anh ăn cơm chưa. Lần thứ bảy. Anh seen. Em uống hết ly cà phê.

Thôi. Lần thứ tám em hỏi chuyện khác. Anh có lạnh không.`
    : `THEY USED TO FIGHT OVER ONE PHONE IN THE HALLWAY.

Grandma would stand there timing you. You got five minutes. If someone called the house, the whole family knew.

Now everyone is on their own phone at the same table, and nobody says a word.

#FamilyLife #ThenVsNow`
}

In JSON, that means real newline characters: paragraph, \\n\\n, paragraph, \\n\\n, paragraph${isVietnam ? "." : ", \\n\\n, hashtags."}

Do not write the post as one paragraph.
Do not join sentences with extra spaces instead of line breaks.
Do not use labels like Hook: or Story:.

The assigned format decides the kind of post:

- funny: payoff is the laugh
- relatable: payoff is "that's my life"
- useful: payoff is a concrete takeaway
- emotional: payoff is an earned feeling
- question: payoff is a question people would actually answer

Do NOT force a moral, life lesson, or "what I learned."
A funny post can just be funny. A question post can just be a good question.

HASHTAGS

${
  isVietnam
    ? "Do not use hashtags. No # tags anywhere in the post."
    : `Hashtags are required.

Use exactly 2-4 hashtags on their own last line, after a blank line.

They must be specific to this post and this topic.

Good: #DuLich #Vietnam #DaLat #HoiAn #Cafe #Ronaldo #Messi #Football #FamilyLife
Bad: #ThaThinh #Quote #Flirt #LifeChangingMoment #Blessed #GoodVibesOnly #Heartwarming #RelatableContent

Do not invent inspirational, vague, or concatenated AI hashtags.
Do not put hashtags inside the story.`
}

STYLE

Avoid these common AI openings and phrases:

"So, picture this..."
"Let me tell you..."
"You won't believe..."
"You know what that means..."
"Of course, I had to..."
"And that's when..."
"Here's the thing..."
"At the end of the day..."
"Little did I know..."
"I couldn't believe..."
"Who else can relate?"
"Can anyone else relate?"

Do not use them unless absolutely necessary.

Do not overuse rhetorical questions.

Do not explain the joke after making the joke.

Do not explain the emotion after creating the emotion.

FORMAT

${FORMAT_INSTRUCTIONS[format]}

LENGTH

${dna.lengthGuide}

HOOK RULE

${dna.hookRule}

STRUCTURE

Required, not optional:

One catching sentence (its own first paragraph)
→
actual point / story / situation
→
payoff

The first paragraph is exactly one sentence in ALL CAPS. It is about this post. It creates curiosity and the urge to read more. It does not tell the whole story.
The rest of the post uses normal capitalization.
Put each part on its own short paragraph with a blank line between them.
Never write the post as one block of text with no line breaks.
The middle must be a real beat, not a restatement of the hook.
The payoff must match the assigned format. Do not default to a valuable lesson.

HASHTAGS

${
  isVietnam
    ? "Do not use hashtags."
    : `Always include 2-4 relevant hashtags on their own last line after a blank line.
Never skip hashtags. Never use generic AI hashtags like #LifeChangingMoment.`
}

PAGE DNA

${dna.identity}

CONTENT PILLAR

${pillar}

TARGET EMOTION

${emotion}

HOOK MECHANISM

${hookMechanism}

ASSIGNED FORMAT

${format}

HASHTAGS

${
  isVietnam
    ? "Do not use hashtags."
    : `Use exactly 2-4 specific hashtags on their own last line after a blank line.
Do not use generic AI hashtags.`
}

EMOJIS

${
  dna.allowEmojis
    ? "Use emojis sparingly only when they genuinely fit."
    : "Do not use emojis."
}

IMAGE

The image should support the actual post.

Do not create an image just because an image is normally expected.

If an image is requested, it should show a specific moment from the post, not a generic representation of the topic.

Return the requested structured output.
`;

  const userPrompt = `
Today: ${today}

TOPIC

${topic}

CONTENT PILLAR

${pillar}

TARGET EMOTION

${emotion}

FORMAT

${format}

FORMAT INSTRUCTION

${FORMAT_INSTRUCTIONS[format]}

HOOK MECHANISM

${hookMechanism}

INSPIRATION SOURCE

${
  isVietnam
    ? "traveling, everyday life, and flirting quotes for a Vietnamese Facebook page"
    : isFootball
    ? "latest Ronaldo, Messi, match, and football news from this week"
    : fb001Track === "news"
    ? "hottest US news and drama from the last few days"
    : fb001Track === "history"
      ? "real events in US history, including on this day"
      : inspirationSource
}

INSPIRATION

${inspiration}

${
  isVietnam
    ? `These are travel, life, and flirting prompts.
Pick ONE idea. Write the Facebook post in Vietnamese.
Human, flirting, a subtle joke. Spoken, not poetic. Stay on the assigned track (${vietnamTrack}). Do not write English.`
    : isFootball
    ? `These are live football headlines, especially Ronaldo, Messi, matches, and related news.
Pick ONE real story. Write a Facebook fan reaction to it.
Do not invent scores, transfers, quotes, or matches.`
    : fb001Track === "news"
    ? `These are live headlines from the last few days in the US.
Pick ONE real story. Write a Facebook reaction to it.
Do not invent news.`
    : fb001Track === "history"
      ? `These are real US historical events.
Pick ONE event. Write a Facebook post about it.
Include when it happened. Do not invent history.`
      : `OPTIONAL CURRENT TREND

${optionalTrend}

Use a trend only when it naturally improves the idea.

Never force a trend into the post.`
}

PREVIOUS POSTS

${previous || "(none)"}

Do not repeat the previous posts.

Do not merely change names or a few words.

Create a genuinely different situation, hook, and payoff.

TASK

First decide internally what the strongest content idea is.

Then write the final Facebook post.

The contentIdea should be one concise sentence describing the idea.

The hookMechanism should describe the actual hook used.

The emotionalTrigger should describe why the target reader would care.

The payoff should describe what the reader gets at the end: a laugh, recognition, useful takeaway, earned emotion, or a real question. Not a forced life lesson.

The content field must contain ONLY the Facebook post itself.

Do not include labels such as "Hook:", "Story:", "CTA:", or "Post:".

Format content exactly like a Facebook post people would actually see:

paragraph 1 (ONE catching sentence in ALL CAPS about this post. Curiosity. Urge to read more.)

blank line

paragraph 2 (what happened)

blank line

paragraph 3 (payoff)
${
  isVietnam
    ? ""
    : `
blank line

#Two #ToFour #Hashtags`
}

Use real \\n\\n line breaks inside the JSON string. If the post is longer, add another short paragraph, still with blank lines between them. Never one wall of text.

${dna.hookRule}

${dna.lengthGuide}

${
  isVietnam
    ? vietnamTrack === "travel"
      ? "Write the whole post in Vietnamese. Human, flirty, a subtle joke. One place, still talking to 'anh'. Not a brochure. No hashtags."
      : vietnamTrack === "life"
        ? "Write the whole post in Vietnamese. Human, flirty, a subtle joke. Cafe, seen message, rain. Talk like a person. No hashtags."
        : "Write the whole post in Vietnamese. Human thả thính. Talk to 'anh'. Deny it, then do it. Subtle joke, not a poem. No hashtags."
    : isFootball
    ? "Write about a real current football story, especially Ronaldo or Messi: news, a match, a goal, form, a record, or related drama. Sound like a fan, not a sports desk. Do not invent facts. Hashtags like #Ronaldo #Messi #Football when they fit."
    : fb001Track === "news"
    ? "Write about a real US news or drama story from the last few days. Sound like a person, not a news desk. Do not invent facts."
    : fb001Track === "history"
      ? "Write about a real US historical event. Name what happened and when. Sound like a person, not a textbook. Do not invent facts."
      : /pet/i.test(topic)
        ? "Sound like a real owner, not a caption writer. No metaphors. No punchline to the pet. Funny because it happened."
        : familyTrack
          ? familyTrack === "old_school"
            ? "Write one old-school family moment. Concrete scene. Funny and quite dramatic. Sitcom stakes. Do not go soft. Do not force a then-vs-now lecture."
            : familyTrack === "modern"
              ? "Write one modern family moment. Concrete scene. Funny and quite dramatic. The fight should feel huge. Do not rant about phones."
              : familyTrack === "funny"
                ? "Write one funny, quite dramatic family moment. Play it like a sitcom. The laugh is in how extra everyone was."
                : "Compare family life in the old days with nowadays. One specific contrast. Funny and quite dramatic, not a lecture."
          : ""
}

${isVietnam ? "Do not use hashtags." : "End with 2-4 relevant hashtags on their own last line. No generic AI hashtags."}

The post should feel like something worth seeing in a Facebook feed, not an article.

IMAGE

Create a concise image prompt that visually matches the exact situation in the final post.

The photo MUST include a short, readable hook line. That line is not a recap. It is bait.

imageQuote must be 6-14 words that make someone stop, feel something, and tap to read the rest.

${
  isVietnam
    ? `For this Vietnamese post, imageQuote MUST be Vietnamese. 6-14 words. Human, flirty, a subtle joke. Spoken, not poetic. Not English. Not a celebrity quote.

Good:
Không phải em thả thính.
Anh seen rồi thì cũng được.
Ghế này chưa cho ai ngồi.

Bad:
Nếu anh là biển em là cát.
Live, laugh, love.
Đà Lạt đẹp như giấc mơ.
Life is about family.`
    : isFamily
    ? `For this family post, the overlay MUST be funny and quite dramatic.
Treat a small household thing like a crisis. Sitcom energy. Never soft, warm, or sentimental.

Good:
Mom treated leftovers like a federal crime.
One missed call and the house went to war.
Dinner was a hostage situation.
Dad's silent treatment lasted three Thanksgivings.

Bad:
Home is where the heart is.
Family dinners meant everything.
The house went quiet after that.
Life is about family.`
    : `Pick ONE job for the line:
- curiosity: tease the interesting part without giving the ending
- funny: a dry, specific laugh tied to this post
- emotional: a small hit in the chest, specific, not sappy

Good:
They used to share one phone.
America almost lost this in an afternoon.
Grandma timed the call. Five minutes.
The house went quiet after that.

Bad:
A recap of family dinners then versus now.
Nixon resigned in 1974 changing politics.
You won't believe what happened next.
Life is about family.`
}

Not a celebrity quote. Not a generic slogan. No author name. No hashtags. Spell it correctly.

${dna.imageStrategy}

${
  options?.imageStyle?.trim()
    ? `Additional image style:
${options.imageStyle.trim()}`
    : ""
}
`;

  let generated =
    await generateStructuredContent(
      systemPrompt,
      userPrompt,
    );

  let content =
    normalizePostContent(
      generated.content?.trim() || "",
      {
        allowEmojis:
          dna.allowEmojis,
        useHashtags:
          dna.useHashtags,
      },
    );

  /**
   * One lightweight repair attempt.
   *
   * This protects against occasional generic AI openings
   * without turning the system into an expensive multi-call
   * generation pipeline.
   */
  const validation =
    validateGeneratedPost(content, {
      minWords: dna.minWords,
      maxWords: dna.maxWords,
      shortFunnyHook: /pet/i.test(topic),
      useHashtags: dna.useHashtags,
    });

  if (!validation.valid) {
    log(
      "WARN",
      `${options?.accountName || topic} post quality guard: ${validation.reason}`,
    );

    const repairSystemPrompt = `
Rewrite the Facebook post below so it has a real hook, an actual point or story, and a payoff.

Keep the core idea and the assigned vibe (funny, relatable, useful, emotional, or question). Do not turn it into a life lesson unless it already is one.

Fix this problem:

${validation.reason}

Rules:

- ${isVietnam ? "Natural spoken Vietnamese. Human, flirty, a subtle joke. Entire post in Vietnamese. Not English. Not a poem." : "Natural American English."}
- Start with one catching sentence in ALL CAPS on its own first line, related to this post, that makes people want to read more.
- The rest of the post is normal sentence case.
- Keep hook → story/point → payoff. One relatable sentence is not enough.
- Use short paragraphs with a blank line between them. Do not return one wall of text.
- ${dna.hookRule}
- ${dna.lengthGuide}
- ${isVietnam ? "Do not use hashtags." : "End with 2-4 specific hashtags on their own last line."}
- ${isVietnam ? "Strip any # tags if they appear." : "Do not use generic AI hashtags like #LifeChangingMoment, #Blessed, or #GoodVibesOnly."}
- Remove generic AI phrases.
- Do not make it longer unless necessary.
- Do not explain what you changed.
- Return only the revised Facebook post.
`;

    const repairResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${openaiApiKey()}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          model: TEXT_MODEL,
          max_output_tokens: 2000,

          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: repairSystemPrompt,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: content,
                },
              ],
            },
          ],

          text: {
            format: {
              type: "text",
            },
          },
        }),
      },
    );

    if (repairResponse.ok) {
      const repairData =
        (await repairResponse.json()) as OpenAIResponsePayload;

      const repaired = extractResponseText(repairData);

      if (repaired) {
        content =
          normalizePostContent(
            repaired,
            {
              allowEmojis:
                dna.allowEmojis,
                useHashtags:
                  dna.useHashtags,
            },
          );

      }
    }
  }

  if (!content) {
    throw new Error(
      "OpenAI generated empty Facebook post",
    );
  }

  /**
   * If the model decides the post does not need
   * an image, respect it unless forceImage=true.
   */
  const commentPromise = generateFunnyComment(content, topic);

  if (
    !generated.needsImage &&
    !options?.forceImage
  ) {
    const comment = await commentPromise;
    log("INFO", `Comment ready: "${comment}"`);
    return {
      content,
      comment,
    };
  }

  /**
   * IMAGE PROMPT
   *
   * Page DNA owns the image strategy.
   * No more "FB 001" hacks.
   */
  const quote = pickQuoteForPost(
    topic,
    content,
    generated.imageQuote,
  );

  log(
    "INFO",
    quote.author
      ? `Image quote: "${quote.text}" — ${quote.author}`
      : `Image quote: "${quote.text}"`,
  );

  const imagePrompt = [
    dna.imageStrategy,

    generated.imagePrompt?.trim() ||
      `A candid everyday moment related to ${topic}`,

    "The image must match the exact situation in the Facebook post.",

    "Natural human behavior and believable surroundings.",

    `The photograph must include this exact hook line in clear, readable ${isVietnam ? "Vietnamese" : "English"} text on the image: "${quote.text}"`,

    isVietnam
      ? "The overlay text must be Vietnamese: human, flirty, a subtle joke. Spoken, not poetic. It must not spoil the whole post. Large, easy to read, correctly spelled, no extra slogans."
      : isFamily
      ? "The overlay text must be funny and quite dramatic. Sitcom energy. It must not spoil the whole post. Large, easy to read, correctly spelled, no extra slogans, no sentimental line."
      : "The overlay text must create curiosity, a laugh, or an emotional hit. It must not spoil the whole post. Large, easy to read, correctly spelled, no extra slogans.",

    "Do not add a celebrity name, author, or fake attribution.",

    "No logos.",
    "No watermarks.",
    "No collage.",
    "No split screen.",
    "No UI.",
  ]
    .filter(Boolean)
    .join(". ");

  const [imagePath, comment] = await Promise.all([
    generateImage(imagePrompt),
    commentPromise,
  ]);

  log("INFO", `Comment ready: "${comment}"`);

  return {
    content,
    imagePath,
    comment,
  };
}

