import "./env.js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getSetting, log, setSetting } from "./db.js";

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-4o-mini";
const IMAGE_MODEL = "gpt-image-2";
const FALLBACK_IMAGE_MODEL = "gpt-image-1";

const imageDir = path.resolve("data/generated-images");

export type GeneratedPost = {
  content: string;
  imagePath?: string;
  imagePaths?: string[];
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
  | "vietnam_life"
  | "family_news";

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
  return [...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((match) => match[0]);
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

export function stripAiMentions(text: string) {
  return cleanText(
    text
      .replace(
        /\b(chatgpt|chat gpt|openai|midjourney|dall-?e|stable diffusion|sora)\b/gi,
        "",
      )
      .replace(
        /\b(ai[-\s]?generated|generated by ai|made with ai|imagined with ai|created by ai)\b/gi,
        "",
      )
      .replace(/\b(content credentials|c2pa|synthid)\b/gi, "")
      .replace(/\b(tạo bởi ai|do ai tạo|ảnh ai|ai tạo ra)\b/gi, ""),
  );
}

function normalizePostContent(
  text: string,
  options: {
    allowEmojis: boolean;
    useHashtags: boolean;
    keepFirstLineCase?: boolean;
  },
) {
  let result = stripAiMentions(cleanText(text.replace(/\\n/g, "\n")));

  if (!options.allowEmojis) {
    result = stripEmojis(result);
  }

  if (!options.useHashtags) {
    result = removeHashtags(result);
    result = ensureParagraphBreaks(result);
    return options.keepFirstLineCase ? result : uppercaseFirstSentence(result);
  }

  result = ensureParagraphBreaks(putHashtagsOnOwnLine(result));
  return options.keepFirstLineCase ? result : uppercaseFirstSentence(result);
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
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
    /ngọt ngào/i,
    /dịu dàng/i,
    /lung linh/i,
    /lấp lánh/i,
    /lãng đãng/i,
    /bình yên/i,
    /ký ức/i,
    /ánh mắt/i,
    /trái tim/i,
    /tâm hồn/i,
    /xao xuyến/i,
    /thổn thức/i,
    /mỏi lòng/i,
    /rung động/i,
    /thả thính/i,
    /ăn cơm chưa/i,
    /wifi nhà em/i,
    /bắt sóng anh/i,
    /anh seen/i,
    /anh mang em về/i,
    /trà trộn vào đời/i,
    /pin 1%/i,
    /lần thứ bảy/i,
    /lần bảy rồi/i,
    /biết đâu/i,
    /thật tình mà nói/i,
    /cảm giác lãng/i,
    /gió nhẹ/i,
    /lá rụng/i,
    /sáng rực/i,
    /nhớ anh quá/i,
    /mong chờ hơn anh/i,
    /gây ấn tượng/i,
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
    /cực khó chịu/i,
    /khó chịu luôn/i,
    /tự hỏi/i,
    /có ai cũng/i,
    /có ai giống/i,
    /không nhỉ/i,
    /tội lỗi không/i,
    /réo ầm/i,
    /ầm ĩ/i,
    /hôm nay anh (bảo|nói)/i,
    /tự dưng nghĩ/i,
    /đang ngắm/i,
    /cạn kiệt/i,
    /năng lượng/i,
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

function looksLikeScenicLazyOpener(hook: string) {
  const line = hook.toLowerCase().replace(/\s+/g, " ").trim();

  if (
    /^(ngồi|đứng|nằm)\s+(bên|cạnh|trên|ở)\b/.test(line) &&
    /(hồ|biển|bể|pool|resort|rooftop|cafe|ban công|view|hồ bơi)/.test(line)
  ) {
    return true;
  }

  if (/mà thấy/.test(line) && /(lười|mệt|buồn|chán|ngán)/.test(line)) {
    return true;
  }

  if (/\b(lười|mệt|chán|buồn)\s+ghê\b/.test(line) || /thấy lười/.test(line)) {
    return true;
  }

  return false;
}

function looksLikeCaptionVoice(text: string) {
  const hook = firstParagraph(text);
  const letters = hook.replace(/[^a-zA-ZÀ-ỹ]/g, "");
  const allCaps =
    letters.length >= 3 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase();

  if (allCaps) {
    return true;
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const telegrams = lines.filter((line) => {
    const words = wordCount(line);
    return words > 0 && words <= 3 && /[.!?…]$/.test(line);
  });

  return telegrams.length >= 2;
}

function looksLikeForcedVietnamChat(text: string) {
  const body = text.toLowerCase().replace(/\s+/g, " ").trim();

  if (
    /có ai (cũng|giống|nghe|như|biết)|ai cũng thấy|tự hỏi|không nhỉ\s*\??$|không vậy\s*\??$|mình tội lỗi|cực khó chịu|khó chịu luôn|réo ầm|ầm ĩ/.test(
      body,
    )
  ) {
    return true;
  }

  // Fake diary / fake dialogue / overthinking (not real chat)
  if (
    /hôm nay anh (bảo|nói)|anh bảo\s*:|anh nói\s*:|tự dưng nghĩ|đang ngắm|cạn kiệt|năng lượng|học xong mà|không làm gì à|không làm gì chắc|mới sáng đã/.test(
      body,
    )
  ) {
    return true;
  }

  // Long quoted speech looks written, not typed
  if (/["“”].{20,}["“”]/.test(text)) {
    return true;
  }

  if (/bụng kêu/.test(body) && /(khó chịu|tội lỗi|có ai|tự hỏi)/.test(body)) {
    return true;
  }

  // Written diary voice: long clauses with "mà ... ," then emotion stamp
  if (
    /mà .{8,40},/.test(body) &&
    /(cực|rất|quá trời|khó chịu|bứt rứt|day dứt)/.test(body)
  ) {
    return true;
  }

  // Narrative opener: "Đang X, ..."
  if (/^đang\s+\S+.{8,}/.test(body)) {
    return true;
  }

  return false;
}

function lastParagraph(text: string) {
  const parts = splitIntoParagraphs(text);
  return parts[parts.length - 1]?.trim() || "";
}

function normalizeEnding(text: string) {
  return lastParagraph(text)
    .replace(/[.!?…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validateGeneratedPost(
  content: string,
  rules: {
    minWords: number;
    maxWords: number;
    shortFunnyHook?: boolean;
    useHashtags?: boolean;
    casualVietnam?: boolean;
    shortVietnam?: boolean;
    vietnamFriends?: boolean;
    vietnamIcons?: boolean;
    familyPets?: boolean;
    funnyFamily?: boolean;
    familyJokes?: boolean;
    previousEndings?: string[];
    previousHay?: string;
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
  const beats = splitIntoParagraphs(body).length;

  if (rules.casualVietnam) {
    if (rules.shortVietnam) {
      if (beats > 1) {
        return {
          valid: false,
          reason:
            "One line only. No blank line, no second paragraph. One coherent thought.",
        };
      }

      if (words < 4) {
        return {
          valid: false,
          reason: "Too empty. One short clear line about this photo.",
        };
      }

      if (words > 12) {
        return {
          valid: false,
          reason:
            "Too long. One short clear line, about 4-10 words. One idea only.",
        };
      }

      const glued = body.split(/\s+mà\s+/i);
      if (
        glued.length >= 2 &&
        glued.every((part) => part.trim().split(/\s+/).filter(Boolean).length >= 2)
      ) {
        return {
          valid: false,
          reason:
            'Do not glue two actions with mà. Bad: "Gọi nước mà nhìn vào gương hỏi bao giờ mới xong bữa tập đây?" Good: "Bao giờ mới xong bữa tập đây?"',
        };
      }

      // Two telegram scraps in one line still feel disjointed
      if ((body.match(/[.!?…]/g) || []).length >= 2 && words < 12) {
        return {
          valid: false,
          reason:
            "Meaning not liền mạch. Write ONE connected thought, not two scraps.",
        };
      }

      if (looksLikeScenicLazyOpener(hook)) {
        return {
          valid: false,
          reason: "Do not open with ngồi bên hồ / mà thấy lười ghê.",
        };
      }

      if (rules.vietnamIcons && !/\p{Extended_Pictographic}/u.test(body)) {
        return {
          valid: false,
          reason: "This caption needs 2-4 emojis that fit the photo.",
        };
      }

      if (/\bluôn\b/i.test(body) || /ghê luôn/i.test(body)) {
        return {
          valid: false,
          reason: "Do not use luôn. Find a new wording.",
        };
      }

      if (hasGenericAIPhrase(body)) {
        return {
          valid: false,
          reason: "No ngọt ngào, no ăn cơm chưa, no wifi, no thả thính.",
        };
      }

      if (looksLikeForcedVietnamChat(body)) {
        return {
          valid: false,
          reason:
            "Too written. No cực khó chịu luôn, no tự hỏi / có ai cũng... không nhỉ, no Hôm nay anh bảo:, no tự dưng nghĩ. One short spoken line only.",
        };
      }

      if (
        /\b(anh|thính)\b/i.test(body) ||
        /ăn cơm chưa|wifi nhà|mê tôi|mê tín|anh seen/i.test(body)
      ) {
        return {
          valid: false,
          reason:
            "No flirting. She is cá tính, mạnh mẽ, năng động. One short line about what she is doing. Do not talk to anh.",
        };
      }

      if (rules.vietnamFriends && !/(bạn|tụi|đám)/i.test(body)) {
        return {
          valid: false,
          reason:
            "Weekend post. ONE short line about going out with friends. The photo has friends.",
        };
      }

      return { valid: true, reason: "" };
    }

    if (words < rules.minWords) {
      return {
        valid: false,
        reason:
          "Too empty. One short youth-chat beat about the scene, then stop.",
      };
    }

    if (words > rules.maxWords) {
      return {
        valid: false,
        reason:
          "Too long. One short coherent line, or two punchline lines max. Không viết đoạn văn.",
      };
    }

    if (beats < 2) {
      return {
        valid: false,
        reason: "Two short lines max. Like a Facebook status, not one wall.",
      };
    }

    if (hookWords < 3 || hookWords > 12) {
      return {
        valid: false,
        reason:
          "First line: one short spoken chat sentence. Not a slogan, not a paragraph.",
      };
    }

    if (looksLikeScenicLazyOpener(hook)) {
      return {
        valid: false,
        reason:
          "Do not open with ngồi bên hồ / đứng bên biển / mà thấy lười ghê. That stamp is banned. Start with a thought or a small hassle, not by announcing the scenery.",
      };
    }

    if (looksLikeCaptionVoice(body)) {
      return {
        valid: false,
        reason:
          "Too caption-like. No ALL CAPS first line. No 3-word telegram lines (ĐÓI. Tan làm. Về.). Write real spoken sentences.",
      };
    }

    if (/\bluôn\b/i.test(body) || /ghê luôn/i.test(body)) {
      return {
        valid: false,
        reason:
          "Do not use luôn (especially ghê luôn). That stamp is banned. Find a new wording.",
      };
    }

    if (/\bghê\b/i.test(body) && /\bghê\b/i.test(rules.previousHay || "")) {
      return {
        valid: false,
        reason: "Do not repeat ghê. Be more creative. New words this post.",
      };
    }

    if (hasGenericAIPhrase(body)) {
      return {
        valid: false,
        reason:
          "Sounds like AI or lộ thính: no ngọt ngào, no ăn cơm chưa, no wifi, no anh seen, no thả thính. Soft implication only.",
      };
    }

    if (looksLikeForcedVietnamChat(body)) {
      return {
        valid: false,
        reason:
          "Too written. No Hôm nay anh bảo:, no quotes, no đang ngắm / tự dưng nghĩ / cạn kiệt năng lượng. Text like a friend: short beats, concrete detail, stop.",
      };
    }

    const ending = normalizeEnding(body);

    if (!ending || /^thôi$/i.test(ending)) {
      return {
        valid: false,
        reason:
          "Do not end with a lone Thôi. Stop on a concrete detail, or use a different last fragment.",
      };
    }

    if (rules.previousEndings?.some((item) => item && item === ending)) {
      return {
        valid: false,
        reason:
          "Last line repeats a previous post. End this one differently. Never stamp Thôi.",
      };
    }

    return { valid: true, reason: "" };
  }

  if (rules.familyPets) {
    if (!/\b(dogs?|cats?|pupp(?:y|ies)|kittens?|pup)\b/i.test(body)) {
      return {
        valid: false,
        reason:
          "The photo is the pet. Write a funny dog or cat story, then a punchline people would laugh at.",
      };
    }

    if (
      /pets are family|fur baby|rainbow bridge|unconditional love|my best friend/i.test(
        body,
      )
    ) {
      return {
        valid: false,
        reason:
          "Not cute or sentimental. Funny pet story plus a punchline. Make people laugh.",
      };
    }
  }

  if (rules.familyJokes && /\b(dog|cat|puppy|kitten|pet)\b/i.test(body)) {
    return {
      valid: false,
      reason:
        "This one is a family joke about people: mom, dad, siblings, kids, leftovers, chores. No dog or cat.",
    };
  }

  if (rules.funnyFamily && looksLikeUnfunnyFamilyPost(body)) {
    return {
      valid: false,
      reason:
        "Post must be about ONE real family thing that sparks a laugh, discussion, or argument: leftovers, thermostat, remote, chores, bedtime, group chat, dog on the couch, etc. Sitcom stakes + punchline. No soft essay.",
    };
  }

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
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
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
      ...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi),
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

async function collectFamilyNewsEvents() {
  const queries = [
    '(family OR parenting OR parents OR "mom" OR "dad" OR kids OR toddlers OR siblings OR "in-laws" OR grandparents) (viral OR news OR story OR debate OR controversy) when:7d',
    "viral family story OR parenting news OR school parents OR holiday family drama when:7d",
    "family reunion OR kids at school OR parents argue OR viral dad OR viral mom when:7d",
  ];

  const results = await Promise.allSettled(
    queries.map((query) =>
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${encodeURIComponent(
          query,
        )}&hl=en-US&gl=US&ceid=US:en`,
      ),
    ),
  );

  const reddit = await Promise.allSettled([
    fetchRedditStories("news", 0),
    fetchRedditStories("Parenting", 0),
    fetchRedditStories("daddit", 0),
  ]);

  const headlines = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  for (const result of reddit) {
    if (result.status === "fulfilled") {
      headlines.push(
        ...result.value.map((story) => story.title).filter(Boolean),
      );
    }
  }

  const unique = headlines.filter(
    (title, index, list) =>
      title && list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 10);
}

async function fetchFamilyMemeTrends() {
  const queries = [
    "viral family tiktok OR relatable parents meme OR sibling tiktok OR facebook family funny OR that's my mom when:7d",
    "family dog meme OR cat destroying house tiktok OR relatable pet parents OR guilty dog OR cat dad when:7d",
    "viral parenting tiktok OR mom vs dad meme OR kids these days funny OR family group chat meme when:7d",
  ];

  const results = await Promise.allSettled(
    queries.map((query) =>
      fetchHeadlines(
        `https://news.google.com/rss/search?q=${encodeURIComponent(
          query,
        )}&hl=en-US&gl=US&ceid=US:en`,
      ),
    ),
  );

  const headlines = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const unique = headlines.filter(
    (title, index, list) =>
      title && list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 12);
}

async function topicTrends(topic: string) {
  const query = encodeURIComponent(topic);

  const sources = await Promise.allSettled([
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`,
    ),
  ]);

  return sources
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter(Boolean)
    .slice(0, 12);
}

async function collectUSNewsDrama() {
  const threeDay = encodeURIComponent(
    "US (news OR viral OR drama OR celebrity) when:3d",
  );

  const [top, entertainment, recent, news, entertainmentReddit, pop, fauxmoi] =
    await Promise.allSettled([
      fetchHeadlines("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"),
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
      title && list.findIndex((item) => item === title) === index,
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

  const [
    ronaldoNews,
    messiNews,
    footballNews,
    weekNews,
    soccer,
    soccerReddit,
    cr7,
    messiSub,
  ] = await Promise.allSettled([
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

type VietnamTrack =
  | "flirting"
  | "life"
  | "travel"
  | "mood"
  | "food"
  | "punchline"
  | "active";

const VIETNAM_SCENES = [
  {
    id: "beach",
    keywords: ["biển", "cát"],
    beat: "ở biển",
    tracks: ["life", "travel", "mood", "flirting", "punchline"],
    photo:
      "candid iPhone photo of the same woman on a real Vietnamese beach, ordinary sand and sea, sundress, daylight, other beach chairs in the background, slightly imperfect framing, not a travel poster",
  },
  {
    id: "cafe",
    keywords: ["cafe", "trà sữa"],
    beat: "ngồi cafe",
    tracks: ["life", "food", "mood", "flirting", "punchline", "active"],
    photo:
      "candid iPhone photo of the same woman at a familiar Vietnamese cafe table, iced drink, wooden table, plants, window light, casual clothes, real cafe clutter, not a luxury glass showroom",
  },
  {
    id: "restaurant",
    keywords: ["nhà hàng", "ăn"],
    beat: "ngồi nhà hàng",
    tracks: ["life", "food", "flirting", "punchline"],
    photo:
      "candid iPhone photo of the same woman at a real restaurant table, plates and glasses, warm indoor lights, modest pretty outfit, looks like a friend took it, not empty cinematic dining hall",
  },
  {
    id: "resort",
    keywords: ["resort", "hồ bơi"],
    beat: "ở resort",
    tracks: ["life", "travel", "mood", "punchline"],
    photo:
      "candid iPhone photo of the same woman at a normal Vietnamese resort pool with lounge chairs and towels, summer dress, afternoon sun, real hotel pool, not an infinity-pool CGI villa",
  },
  {
    id: "seaside-eats",
    keywords: ["biển", "nhà hàng"],
    beat: "nhà hàng gần biển",
    tracks: ["life", "food", "travel", "punchline"],
    photo:
      "candid iPhone photo of the same woman at a seaside restaurant, plastic or wooden chairs, sea in the background, modest clothes, ordinary lunch spot, not a magazine cover",
  },
  {
    id: "hotel-breakfast",
    keywords: ["khách sạn", "buffet"],
    beat: "ăn sáng khách sạn",
    tracks: ["life", "food", "mood", "travel"],
    photo:
      "candid iPhone photo of the same woman at a hotel breakfast table, coffee and plates, ordinary hotel restaurant, casual outfit, natural indoor light",
  },
  {
    id: "hoian",
    keywords: ["Hội An", "phố"],
    beat: "đi phố Hội An",
    tracks: ["life", "travel", "flirting", "punchline"],
    photo:
      "candid iPhone photo of the same woman on a Hội An street, shops and lanterns, casual dress, dusk, looks handheld, not a glowing postcard",
  },
  {
    id: "dalat-cafe",
    keywords: ["Đà Lạt", "cafe"],
    beat: "cafe Đà Lạt",
    tracks: ["life", "food", "mood", "travel", "punchline", "active"],
    photo:
      "candid iPhone photo of the same woman at a Đà Lạt cafe terrace, jacket, coffee, pine trees behind, morning, real cafe, not misty fantasy forest",
  },
  {
    id: "park",
    keywords: ["công viên", "ghế"],
    beat: "ngồi công viên",
    tracks: ["life", "mood", "flirting", "travel", "active"],
    photo:
      "candid iPhone photo of the same woman on a park bench or cafe in a park, trees, daylight, casual clothes, ordinary city park",
  },
  {
    id: "night-cafe",
    keywords: ["cafe đêm", "đèn"],
    beat: "cafe buổi tối",
    tracks: ["life", "food", "mood", "flirting", "punchline"],
    photo:
      "candid iPhone photo of the same woman at a cafe at night, warm indoor lamps, drink on the table, modest outfit, slightly grainy phone look",
  },
  {
    id: "resort-lobby",
    keywords: ["resort", "sảnh"],
    beat: "sảnh resort",
    tracks: ["life", "travel", "mood"],
    photo:
      "candid iPhone photo of the same woman sitting in a resort lobby or waiting area, sofa, plants, casual travel clothes, real hotel interior",
  },
  {
    id: "beach-walk",
    keywords: ["biển", "đi bộ"],
    beat: "đi bộ gần biển",
    tracks: ["life", "travel", "mood", "flirting", "active"],
    photo:
      "candid iPhone photo of the same woman walking a beach path or promenade, sundress, sea nearby, daytime, other people far away, not empty CGI shore",
  },
  {
    id: "gym",
    keywords: ["gym", "tập"],
    beat: "đi gym",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman at a normal gym or fitness studio, athletic top and leggings fully covering, water bottle, mirrors in background, after a set, not a fitness influencer shoot, not sexy",
  },
  {
    id: "yoga",
    keywords: ["yoga", "mat"],
    beat: "tập yoga",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman on a yoga mat in a bright studio or living room corner, modest sportswear, water bottle nearby, calm but imperfect phone framing, fully clothed, not sexy",
  },
  {
    id: "running",
    keywords: ["chạy", "jogging"],
    beat: "đi chạy",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman after a jog in a city park, sportswear and sneakers, slightly messy hair, daylight, ordinary path, not a marathon ad",
  },
  {
    id: "badminton",
    keywords: ["cầu lông", "vợt"],
    beat: "đánh cầu lông",
    tracks: ["active", "life"],
    photo:
      "candid iPhone photo of the same woman holding a badminton racket at an outdoor or indoor court, sports clothes, shoes, ordinary Vietnamese sports court, daylight, not a pro athlete shot",
  },
  {
    id: "cycling",
    keywords: ["xe đạp", "đạp"],
    beat: "đạp xe",
    tracks: ["active", "life", "travel"],
    photo:
      "candid iPhone photo of the same woman with a city bicycle in a park or quiet street, casual active clothes, helmet optional, daylight, ordinary Vietnam street, not a cycling magazine cover",
  },
  {
    id: "swim-lane",
    keywords: ["bơi", "hồ bơi"],
    beat: "đi bơi",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman at a public or hotel pool lane, modest one-piece swimsuit or swim dress covering the body, goggles or towel nearby, real pool tiles, not bikini, not sexy, not CGI infinity pool",
  },
  {
    id: "bookstore",
    keywords: ["hiệu sách", "sách"],
    beat: "đi hiệu sách",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman in a bookstore aisle holding a paperback, casual pretty outfit, shelves behind her, warm indoor light, real shop clutter, not a fashion editorial",
  },
  {
    id: "reading-cafe",
    keywords: ["đọc sách", "sách"],
    beat: "ngồi đọc sách",
    tracks: ["active", "life", "mood", "food"],
    photo:
      "candid iPhone photo of the same woman at a cafe table reading a book, iced drink beside her, casual clothes, window light, real cafe, book cover not a famous brand logo focus",
  },
  {
    id: "study-desk",
    keywords: ["học", "laptop"],
    beat: "ngồi học",
    tracks: ["active", "life", "mood"],
    photo:
      "candid iPhone photo of the same woman at a desk or cafe corner with a notebook or laptop, earbuds, coffee, casual clothes, studying or working, ordinary room, not a corporate shoot",
  },
  {
    id: "tennis",
    keywords: ["tennis", "sân"],
    beat: "chơi tennis",
    tracks: ["active", "life"],
    photo:
      "candid iPhone photo of the same woman on a tennis court with a racket, sports skirt or shorts and top fully clothed, daylight, ordinary club court, not a sports campaign",
  },
];

const VIETNAM_ANGLES = [
  {
    id: "over-shoulder",
    photo:
      "over-the-shoulder candid. She looks into the scene, not at the camera. Face mostly averted.",
  },
  {
    id: "profile",
    photo:
      "strict side profile. She is looking at something in the scene. Not a frontal portrait.",
  },
  {
    id: "from-behind",
    photo:
      "from behind as she walks or stands. Long dark hair. Face not visible, or only a hint of cheek.",
  },
  {
    id: "three-quarter",
    photo:
      "three-quarter view, body turned, glancing to the side. Not a straight-on selfie.",
  },
  {
    id: "looking-down",
    photo:
      "looking down at her phone, food, or hands. Top of head and hair. Face partly hidden.",
  },
  {
    id: "window",
    photo:
      "camera beside her as she looks out a window, street, or across a room. Not posing.",
  },
  {
    id: "mid-shot",
    photo:
      "candid mid-shot from a few steps away. The place takes space. She is not a centered headshot.",
  },
  {
    id: "farther",
    photo:
      "taken from farther away. More street or room in the frame. She is smaller, doing something ordinary.",
  },
  {
    id: "full-body",
    photo:
      "full-body candid iPhone photo, head to shoes in frame, she looks a bit tall with long legs, standing or walking in the place, modest clothes, feet visible, not a fashion catalog, not cropped at the chest",
  },
  {
    id: "full-body-sit",
    photo:
      "full-body or three-quarter from head to shoes or at least to the knees, long-legged proportions visible, she is sitting in the scene, candid phone photo, not a portrait crop",
  },
  {
    id: "wide-standing",
    photo:
      "wide shot from a few steps back, full figure standing, lots of the cafe/beach/restaurant around her, handheld, not a close face crop",
  },
  {
    id: "selfie",
    photo:
      "casual iPhone front-camera selfie, arm's length, she is looking toward the phone, familiar cafe/restaurant/beach behind her, slightly imperfect, natural skin, not a beauty studio, not a duck-face beauty shot",
  },
  {
    id: "selfie-mirror",
    photo:
      "casual mirror selfie in a cafe bathroom, hotel room, or restaurant restroom, phone in her hand, outfit and place visible in the mirror, fully clothed, real tiles and lighting, not glamorous, not sexy",
  },
];

function pickVietnamTrack(_previousPosts: string[]): VietnamTrack {
  if (isVietnamWeekend()) {
    return pick(["active", "active", "life", "food", "travel", "mood"]);
  }

  return pick([
    "active",
    "active",
    "active",
    "life",
    "life",
    "travel",
    "food",
    "mood",
  ]);
}

function pickVietnamAngle(withFriends = false) {
  const friendAngles = VIETNAM_ANGLES.filter((item) =>
    /selfie$|mid-shot|full-body$|three-quarter|wide-standing|farther/.test(
      item.id,
    ),
  );
  const pool = withFriends
    ? friendAngles
    : [
        ...VIETNAM_ANGLES,
        ...VIETNAM_ANGLES.filter((item) =>
          /full-body|wide-standing|selfie/.test(item.id),
        ),
      ];

  return pick(pool.length ? pool : VIETNAM_ANGLES);
}

function pickVietnamAlbumCount() {
  return pick([1, 1, 2, 2, 2, 3]);
}

function pickVietnamAlbumAngles(
  count: number,
  first: (typeof VIETNAM_ANGLES)[number],
) {
  const rest = shuffle(VIETNAM_ANGLES.filter((item) => item.id !== first.id));

  return [first, ...rest].slice(0, Math.max(1, count));
}

function vietnamOutfitLock(sceneId: string) {
  if (/beach|seaside/.test(sceneId)) {
    return "LOCKED OUTFIT: the same light sundress and sandals, same color, not a bikini";
  }

  if (/resort/.test(sceneId)) {
    return "LOCKED OUTFIT: the same modest summer dress, same color, fully clothed, not a bikini";
  }

  if (sceneId === "dalat-cafe") {
    return "LOCKED OUTFIT: the same light jacket over the same top, same color";
  }

  if (sceneId === "hoian") {
    return "LOCKED OUTFIT: the same casual dress, same color";
  }

  if (sceneId === "hotel-breakfast") {
    return "LOCKED OUTFIT: the same casual breakfast outfit, same color";
  }

  if (sceneId === "park") {
    return "LOCKED OUTFIT: the same casual daytime outfit, same color";
  }

  if (/gym|yoga|running|badminton|tennis|cycling/.test(sceneId)) {
    return "LOCKED OUTFIT: the same modest sportswear set, same color top and bottoms, sneakers, fully covered, not sexy";
  }

  if (sceneId === "swim-lane") {
    return "LOCKED OUTFIT: the same modest one-piece swimsuit or swim dress, same color, fully covering, not a bikini";
  }

  if (/bookstore|reading-cafe|study-desk/.test(sceneId)) {
    return "LOCKED OUTFIT: the same casual pretty day outfit, same color top, same style";
  }

  return "LOCKED OUTFIT: the same modest cafe/restaurant outfit, same top color, same style";
}

type VietnamCaptionStyle = "chat" | "short" | "icons";

function pickVietnamCaptionStyle(
  track: VietnamTrack,
  previousPosts: string[],
): VietnamCaptionStyle {
  // Punchline stays two short lines. Everything else: ONE coherent line.
  if (track === "punchline") {
    return "chat";
  }

  const last = (previousPosts[0] || "").replace(/\s+/g, " ").trim();
  const lastHadIcons = /\p{Extended_Pictographic}/u.test(last);

  if (lastHadIcons) {
    return "short";
  }

  return pick(["short", "short", "short", "short", "icons"]);
}

const VIETNAM_CLOSERS = [
  "",
  "",
  "",
  "Về.",
  "Kệ.",
  "Đói quá.",
  "Im.",
  "Pin yếu.",
  "Ra về.",
  "Ngồi tiếp.",
  "Lần sau.",
  "Hôm nay vậy.",
  "Không lấy.",
  "Chưa.",
  "Ừ.",
  "Được rồi.",
  "Về ăn mì.",
  "Biết rồi.",
];

function pickVietnamCloser(previousPosts: string[]) {
  const used = new Set(
    previousPosts.slice(0, 6).map((post) => normalizeEnding(post)),
  );
  const unused = VIETNAM_CLOSERS.filter((line) => {
    const key = line
      .replace(/[.!?…]+$/g, "")
      .trim()
      .toLowerCase();
    if (!key) {
      return !used.has("thôi");
    }
    return !used.has(key);
  });

  return pick(unused.length ? unused : VIETNAM_CLOSERS.filter(Boolean));
}

function isVietnamWeekend(date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
  }).format(date);

  return weekday === "Sat" || weekday === "Sun";
}

function vietnamCalendarDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamDaySceneSettingKey(accountName: string) {
  return `vietnam_day_scene:${accountName}`;
}

function readVietnamDayScene(accountName?: string) {
  if (!accountName) {
    return null;
  }

  const raw = getSetting(vietnamDaySceneSettingKey(accountName));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { day?: string; sceneId?: string };

    if (parsed.day === vietnamCalendarDay() && parsed.sceneId) {
      return parsed.sceneId;
    }
  } catch {
    // Ignore bad lock values and pick a fresh scene.
  }

  return null;
}

function writeVietnamDayScene(accountName: string | undefined, sceneId: string) {
  if (!accountName) {
    return;
  }

  setSetting(
    vietnamDaySceneSettingKey(accountName),
    JSON.stringify({
      day: vietnamCalendarDay(),
      sceneId,
    }),
  );
}

const VIETNAM_FRIEND_SCENE_IDS = new Set([
  "cafe",
  "restaurant",
  "beach",
  "seaside-eats",
  "park",
  "night-cafe",
  "hoian",
  "dalat-cafe",
  "badminton",
  "tennis",
  "resort",
  "hotel-breakfast",
]);

const VIETNAM_FRIEND_PHOTO =
  "WEEKEND WITH FRIENDS: she is out with 1 or 2 girl friends in the SAME frame. Same age, fully clothed, candid phone photo. The reference woman is still the main person. Friends are ordinary different faces, not clones of her, not celebrities. Not a crowd. Not a solo portrait.";

const VIETNAM_FRIEND_CAPTION =
  "WEEKEND: Saturday or Sunday hangout with friends. ONE short coherent line. Must say bạn or tụi. Joke is the outing (trễ giờ, order nhiều, chụp xóa, ai trả). The photo shows those friends. No luôn. No diary. No anh dialogue.";

function pickVietnamScene(
  previousPosts: string[],
  track?: VietnamTrack | null,
  withFriends = false,
  lockedSceneId?: string | null,
) {
  if (lockedSceneId) {
    const locked = VIETNAM_SCENES.find((scene) => scene.id === lockedSceneId);

    if (locked) {
      return locked;
    }
  }

  const hay = previousPosts.join("\n").toLowerCase();
  const matching = track
    ? VIETNAM_SCENES.filter((scene) => scene.tracks.includes(track))
    : VIETNAM_SCENES;
  const friendPool = matching.filter((scene) =>
    VIETNAM_FRIEND_SCENE_IDS.has(scene.id),
  );
  const pool = withFriends
    ? friendPool.length
      ? friendPool
      : VIETNAM_SCENES.filter((scene) => VIETNAM_FRIEND_SCENE_IDS.has(scene.id))
    : matching.length
      ? matching
      : VIETNAM_SCENES;
  const unused = pool.filter(
    (scene) =>
      !scene.keywords.some((word) => hay.includes(word)) &&
      !hay.includes(scene.beat),
  );

  return pick(unused.length ? unused : pool);
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

const VIETNAM_PUNCHLINE_SEEDS = [
  "Anh nói.. anh không mê tín !!\n\nThôi được rồi.. anh có thể mê tôi 😉",
  "Anh bảo em đừng nghĩ nhiều.\n\nVậy anh nghĩ hộ đi. Em để chỗ.",
  "Anh nói không đói.\n\nNgồi nhìn em ăn cũng được mà.",
  "Anh bảo đi rum chậm thôi.\n\nChậm được. Miễn rum về phía em.",
];

const VIETNAM_LIFE_SEEDS = [
  "Chụp 20 tấm. Xóa 19. Tấm đẹp nhất cũng xóa vì mặt hơi dừ.",
  "Gọi size lớn. Uống 2 ngụm. Đầy. Em vẫn khoe ly.",
  "Nắng. Ra cho có hình. Về là hết pin người.",
  "Kem chống nắng quên một bên. Giờ mặt hai tone. Kệ.",
  "Menu chọn 10 phút. Gọi ly cũ. Đúng nhận sai cãi với chính mình.",
  "Delay. Pin 12%. Em vẫn giả vờ chill.",
  "Áo mỏng. Biết lạnh. Vẫn ra. Về run. Đăng hình thì nói trời đẹp.",
  "Đói. Chọn lâu vì không muốn sai. Sai vẫn được.",
  "Chưa makeup. Vẫn ra đứng. Camera xa một chút là xong.",
  "Ly hết từ lâu. Em chưa đứng dậy. Giữ chỗ cho không khí.",
  "Đăng ký tập 1 tháng. Đi được 3 buổi. App vẫn nhắc đều.",
  "Yoga 1 tiếng. Về nhà ngồi thẳng không nổi 5 phút.",
  "Chạy 2km. Story nói 'morning run'. Thật ra đi bộ nửa đường.",
  "Mua sách hay. Đọc 12 trang. Bookmark vẫn ở trang 12 cả tuần.",
  "Cầu lông với bạn. Thua. Đổ thừa vợt.",
  "Học 2 tiếng. Nhìn lại chỉ ghi được nửa trang. Trà thì hết.",
];

const VIETNAM_FLIRT_LINES = [
  "Wifi nhà em yếu, nên em mới bắt sóng anh.",
  "Anh có mệt không? Cả ngày chạy trong đầu em.",
  "Trời mưa rồi. Anh mang em về được không?",
  "Em không thích trà sữa. Em thích trà trộn vào đời anh.",
  "Anh là pin 1%. Em vẫn không tắt.",
  "Đèn đỏ lâu hơn tin nhắn của anh.",
  "Em không lạc. Em chỉ đang tìm đường vào tim anh.",
  "Ngoài kia 40 độ. Trong tin nhắn anh vẫn lạnh.",
  "Anh seen rồi thì cũng được. Em cũng giả vờ bận.",
  "Nếu yêu là tội, em nhận anh là chứng cứ.",
  "Em không cần GPS. Anh đi đâu em cũng ngoái.",
  "Chỗ này thiếu một người. Không phải ai. Là anh.",
  "Em hỏi anh ăn chưa. Không phải thả. Là quan tâm calo.",
  "Tín hiệu kém. Chỉ bắt được mỗi anh.",
  "Em không say nắng. Em say một người không chịu nhắn.",
];

async function collectVietnamInspiration() {
  const [tiktok, viral, youth, daily] = await Promise.allSettled([
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "tiktok việt nam OR trend tiktok when:7d",
      )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "viral việt nam OR meme việt nam OR câu nói hot when:7d",
      )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "gen z việt nam OR slang OR 'hết cứu' OR 'đúng nhận sai cãi' when:7d",
      )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
    fetchHeadlines(
      `https://news.google.com/rss/search?q=${encodeURIComponent(
        "nắng nóng OR mưa OR trà sữa OR bánh trung thu OR trend ăn uống việt nam when:7d",
      )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
    ),
  ]);

  const headlines: string[] = [...shuffle(VIETNAM_LIFE_SEEDS).slice(0, 4)];

  for (const result of [tiktok, viral, youth, daily]) {
    if (result.status === "fulfilled") {
      headlines.push(...result.value);
    }
  }

  const unique = headlines.filter(
    (title, index, list) =>
      title && list.findIndex((item) => item === title) === index,
  );

  return shuffle(unique).slice(0, 12);
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

      const events = [...(data.selected || []), ...(data.events || [])];

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
      title && list.findIndex((item) => item === title) === index,
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
      "A Vietnamese Facebook page of a confident, strong, active girl. ONE short clear Gen-Z Vietnamese line, one idea, like a status. Cá tính, mạnh mẽ, năng động, slay energy. Sports, reading, study, travel, cafe. Never flirting. Never talk to anh. Never written diary. Never stamp luôn.",

    pillars: [
      "cá tính, mạnh mẽ, năng động — một câu status rõ",
      "sporty girl: gym, yoga, chạy, cầu lông, bơi, tennis — cô ấy làm được",
      "đọc sách / học — chăm và chắc, không tự hỏi có ai cũng...",
      "đi chơi, cafe, biển — main character, không đợi ai",
      "đói thì gọi món mình muốn, không dễ thương giả",
      "cuối tuần đi với bạn vẫn là cô gái slay, không thả thính",
      "bắt trend giới trẻ bằng thái độ, không sến, không luôn, không viết văn",
    ],

    emotions: [
      "mình làm được",
      "sân này của mình",
      "vừa tập xong vẫn muốn thêm",
      "đi là đi, không đợi",
      "đọc cho xong cuốn này",
      "cá tính",
      "mạnh mẽ",
      "năng động",
      "slay",
    ],

    inspirationSources: ["vietnam_life", "pinterest"],

    formats: ["funny", "funny", "observation", "relatable"],

    hookMechanisms: [
      "curiosity",
      "confession",
      "specific_detail",
      "identity",
      "observation",
    ],

    imageStrategy:
      "Candid iPhone photo of the SAME woman as the attached reference (hair, skin, age, face). Confident slay body: a bit taller than average, long legs, sure posture — keep the same face. She looks cá tính, mạnh mẽ, năng động, not flirty and not posed for a boy. Familiar real places: cafe, restaurant, beach, resort, park, gym, yoga studio, bookstore, study desk, sports court. Often sports, reading, or out doing something. Sometimes a casual SELFIE. Prefer FULL-BODY or three-quarter so long legs show. Sometimes a friend took it. Looks real: slightly imperfect crop, real furniture, natural skin. NOT cinematic, NOT CGI. Fully clothed, modest sportswear when active, no bikini, not sexy. NEVER wet market, supermarket, laundry, or bus. New camera angle every post. NO text on the image. No logos, watermarks, collage, or split screen.",

    allowEmojis: false,
    useHashtags: false,
    minWords: 5,
    maxWords: 18,
    lengthGuide:
      "ONE short Vietnamese line only. About 4-10 words. One clear idea about this photo. Confident, strong, active. No flirting. No second action glued on with mà. No second line.",
    hookRule:
      "Write ONE spoken line, normal case. She is cá tính, mạnh mẽ, năng động, slay. Say the one thing she is doing. Do NOT flirt. Do NOT talk to anh. Do NOT glue a second action with mà. Good: Bao giờ mới xong bữa tập đây? Sân này hôm nay của mình. Stop.",
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

    formats: ["observation", "funny", "unexpected", "question", "relatable"],

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

    inspirationSources: ["reddit", "pinterest"],

    formats: ["funny", "funny", "unexpected", "observation", "relatable"],

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
      "A funny American family page. Mix household fights that spark laugh/discussion, recent family news people are talking about, and real family stories. Sitcom stakes. Punchline or discussion hook required. Never soft, never blessed, never a lecture.",

    pillars: [
      "one household thing that starts a fight or a laugh: leftovers, thermostat, remote, milk, couch rules",
      "recent family news / viral family events from this week — react, laugh, discuss",
      "real family stories rewritten into an original household scene people would tag",
      "family jokes: mom, dad, siblings, kids, in-laws arguing over something small",
      "family pets causing a real house argument people would tag about",
      "trending family fights twisted into a concrete household scene",
      "modern family arguments: group chats, GPS, school apps, streaming, chargers",
      "old-school family drama: Sunday dinner rules, one TV, calling a friend's mom first",
    ],

    emotions: [
      "I laughed out loud",
      "that's exactly my family",
      "we argued about THIS?",
      "wait, that happened this week?",
      "I cannot believe this was about leftovers",
      "tag your spouse",
      "the dog started this",
      "family discussion unlocked",
      "family humor",
    ],

    inspirationSources: [
      "family_news",
      "reddit",
      "historical",
      "old_products",
      "old_tv",
      "90s_culture",
      "pinterest",
    ],

    formats: ["funny", "funny", "funny", "funny", "unexpected", "before_after"],

    hookMechanisms: [
      "unexpected",
      "specific_detail",
      "curiosity",
      "observation",
      "recognition",
    ],

    imageStrategy:
      "One photorealistic American home photo matching THIS post. Maximum TWO people, preferably one person or just hands/objects. If the post is a pet story, the dog or cat is the subject and the overlay is a punchline about that pet. If the post is not about a pet, do NOT put a dog or cat in the photo. No group portrait, no crowded dinner table, no five-person family shot — that looks fake. Natural light, slightly imperfect phone framing. Overlay a SHORT viral-funny line in huge readable text: trending meme energy, laugh in one second. Do not recap the post. Do not use a soft or sentimental line. No split screen, no collage, no logos, no watermarks.",

    allowEmojis: false,
    useHashtags: true,
    minWords: 50,
    maxWords: 160,
    lengthGuide:
      "Usually 55-110 words. Name ONE family thing that sparks a laugh, discussion, or argument. Sitcom scene, then punchline. Never pad. Never soft.",
    hookRule:
      "Start with one catching ALL CAPS line about the household thing people fight or laugh about. Then the scene. End on a punchline. If there is no clear thing, rewrite it.",
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

Write like a young Vietnamese girl who is cá tính, mạnh mẽ, năng động. Slay energy. Gen-Z status. Short. Entirely Vietnamese. Confident. Not flirty. Not cute. Not waiting for a boy.

Sound like she posted one line after doing the thing: trời, thiệt, mình. Casual. Never stamp luôn or ghê luôn.

Do this:
- ONE LINE only. About 4-10 Vietnamese words. One clear idea. No blank line. No second paragraph.
- Say the one thing in the photo. She owns it. Do not glue a second unrelated action with mà.
- Bad: Gọi nước mà nhìn vào gương hỏi bao giờ mới xong bữa tập đây?
- Good: Bao giờ mới xong bữa tập đây?
- Good: Sân này hôm nay của mình.
- Good: Chạy xong vẫn muốn thêm vòng.
- Normal capitalization. No ALL CAPS first line.
- No flirting. No thả thính. Do not talk to anh. Do not write anh bảo, ăn cơm chưa, wifi, seen, mê tôi.
- Active posts: gym, yoga, run, badminton, swim, tennis, reading, study. She is doing it, not joking that she quit. Not a motivational poster.
- Life, food, travel, mood: main character. She showed up. Not lazy-sad. Not a poem.

Never use:
ngọt ngào, dịu dàng, lung linh, lấp lánh, lãng đãng, bình yên, ký ức, ánh mắt, trái tim, tâm hồn, xao xuyến, thổn thức, mỏi lòng, rung động, gió nhẹ, lá rụng, sáng rực, thật tình mà nói, biết đâu, chỉ cần anh, như một, tựa như, gây ấn tượng, mong chờ.
The attitude is slay. The line stays Vietnamese. Do not write a caption that is only the word slay.
No lộ thính: ăn cơm chưa, wifi nhà em, anh seen, anh mang em về, lần thứ bảy, thả thính, bắt sóng, mê tôi, anh bảo.
Banned filler: luôn, ghê luôn, cô đơn ghê, chán ghê, lười ghê luôn, cực khó chịu, khó chịu luôn, tự hỏi, có ai cũng, không nhỉ, tự dưng nghĩ, đang ngắm, cạn kiệt, năng lượng, Hôm nay anh bảo.

Never:
- Two paragraphs / two disconnected beats (except punchline)
- Long posts
- ALL CAPS first line
- Caption style: ĐÓI. / Tan làm. / Về ăn mì.
- Opening stamp: "ngồi bên hồ mà thấy lười ghê", "đứng bên biển mà thấy mệt ghê", or any ngồi/đứng/nằm bên + place + mà thấy + mood
- Everyone-question / bait: "có ai giống mình không", "có ai cũng thấy... không nhỉ", "tự hỏi..."
- Written diary: "Đọc sách mà bụng kêu réo ầm ĩ, cực khó chịu luôn"
- Fake scene + fake anh dialogue: "Hôm nay anh bảo: ... Đang ngắm..., tự dưng nghĩ..."
- Long quotes in quotation marks
- Metaphor / life lesson (cạn kiệt năng lượng, học xong mà không làm gì)
- Essay, moral, travel blog
- Lone "Thôi." as the last line
- The word luôn (no ghê luôn, no cái gì cũng luôn)
- Dry "em lười" with no joke
- Trying too hard to be a comedian

Good (one clear line, one idea):
Bao giờ mới xong bữa tập đây?
Chụp 20 tấm xóa hết vì mặt dừ.
Size lớn uống 2 ngụm là đầy.
Đọc 3 trang snack đã hết.
Học xong mới mở được sách.

Bad (two actions that do not belong together):
Gọi nước mà nhìn vào gương hỏi bao giờ mới xong bữa tập đây?

Good punchline (punchline track only, lâu lâu — two short lines OK):
Anh nói.. anh không mê tín !!
Thôi được rồi.. anh có thể mê tôi 😉

Anh bảo không đói.
Ngồi nhìn em ăn cũng được.

Bad (two scraps, meaning not liền mạch):
Đọc được 3 trang.
Snack hết trước.

Chụp 20 tấm. Xóa 19.
Tấm đẹp nhất cũng xóa vì mặt hơi dừ.

Bad punchline (copied / stale / too written):
repeating mê tín / mê tôi
ăn cơm chưa
wifi nhà em
Hôm nay anh bảo: "Mới sáng đã cà phê mà không làm gì à?"
Đang ngắm cây pin, tự dưng nghĩ...

Bad (too written / fake-natural):
Đọc sách mà bụng kêu réo ầm ĩ, cực khó chịu luôn.
Túi snack bên cạnh, tự hỏi có ai cũng thấy mình tội lỗi không nhỉ?

Hôm nay anh bảo: "Mới sáng đã cà phê mà không làm gì à?"
Đang ngắm cây pin, tự dưng nghĩ học xong mà không làm gì chắc cạn kiệt năng lượng luôn!

Bad (too long / too written):
Hôm nay tan làm muộn quá. Đói mà lười nấu, ra ngoài cũng không muốn nên mình suy nghĩ rất nhiều về việc nên ăn gì và cuối cùng quyết định về ăn mì.

Bad (caption):
ĐÓI.
Tan làm. Chưa ăn.
Về ăn mì.

Bad (poetic):
Chiều mát, gió nhẹ thổi qua. Trái tim em cũng mệt mỏi.

Bad (scenery + lazy stamp — never open like this):
Ngồi bên hồ mà thấy lười ghê.
Đứng trên rooftop mà thấy mệt ghê.
`;

function vietnamTrackRules(
  scene: (typeof VIETNAM_SCENES)[number],
  track: VietnamTrack,
  closer: string,
  captionStyle: VietnamCaptionStyle = "chat",
) {
  const trackGuide: Record<VietnamTrack, string> = {
    punchline: `THIS POST: do not flirt and do not write a two-line thính.
ONE short confident line about THIS photo. She is cá tính, mạnh mẽ, năng động. No anh. No thả thính.`,
    flirting: `THIS POST: flirting is off.
ONE short confident line about THIS photo. She is cá tính, mạnh mẽ, năng động. No anh. No thả thính. No empty-seat hint.`,
    life: `THIS POST: she owns this place
ONE clear line. Confident, strong, active. A detail from the photo (ly, cát, đĩa, ghế). Main character, not a hassle diary. No flirting. No anh. Do not write about a different place.`,
    travel: `THIS POST: she showed up at THIS place
ONE clear line. She is the main character here. Not a tourism caption. Not flirting. Not waiting for anyone. No anh. The photo and the post are the same stop.`,
    mood: `THIS POST: bold mood in THIS photo
She looks sure of herself. Not lazy-sad. Not cute. Not a poem. No anh. Not a different location.`,
    food: `THIS POST: she ordered what she wanted in THIS photo
The drink or plate is hers. Confident, not cute-hungry. Not a wet market. No flirting. No anh. Do not write about a place that is not in the photo.`,
    active: `THIS POST: she is training, playing, reading, or studying in THIS photo
Gym, yoga, run, badminton, swim, cycling, tennis, book, bookstore, or study. She is doing it. ONE clear line, e.g. "Bao giờ mới xong bữa tập đây?" or "Sân này hôm nay của mình." Not a quit-joke. Not a gym quote poster. No anh. No thả thính. Do not move her to a cafe if the photo is sport, or to a gym if the photo is a book.`,
  };

  const endingRule =
    "End like a person, not a template. Do not close with a lone Thôi. Do not reuse the last line of a previous post.";

  return `${VIETNAM_VOICE_RULES}

${trackGuide[track]}
${captionStyle === "short" ? `CAPTION SHAPE: ONE short clear line. About 4-10 Vietnamese words. One idea about THIS photo. Do not glue a second action with mà. Bad: "Gọi nước mà nhìn vào gương hỏi bao giờ mới xong bữa tập đây?" Good: "Bao giờ mới xong bữa tập đây?"` : captionStyle === "icons" ? `CAPTION SHAPE: one short clear line plus 2-4 emojis that fit the photo (🍜 😭 ✌️ 😴 🥲 ☀️). One idea. Do not glue a second action with mà.` : track === "punchline" ? `CAPTION SHAPE: two short punchline lines only. Setup then twist.` : `CAPTION SHAPE: ONE short clear line. One idea. Do not glue a second action with mà.`}
THIS POST SCENE: ${scene.beat}
Photo setting: ${scene.photo}
${endingRule}
Last line must be different from previous posts. Never use a lone "Thôi." as the ending.
The caption and the photo are the same moment. Slip in one real detail from THIS scene. Do NOT open with "ngồi bên hồ mà thấy lười ghê". Do not move her to a different place.`;
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

Every post is about ONE real thing that exists in a family and can cause a laugh, a discussion, or an argument.
Examples: leftovers, thermostat, TV remote, last slice, who finished the milk, chores, bedtime, bathroom schedule, group chat, school app, GPS, charging cable, dog on the couch, cat on the counter.

FUNNY / DISCUSSION is the job. If nobody would laugh, argue, or tag their spouse, rewrite it.
Sitcom energy. Small household thing. Federal-case stakes.

Do this:
- Name the thing early. Readers must know WHAT the fight or laugh is about.
- Start with one catching sentence on its own first line, in ALL CAPS.
- Stay in the assigned track for this post.
- Concrete scene: a room, a person, a pet, an object, a rule, a habit.
- Show the argument, discussion, or laugh landing. Punchline last.
- If a current family/pet trend is in the list, riff it into THIS household thing. Do not paste the headline.
- Pets posts: the pet caused a real house problem people would discuss. Funny crime + punchline. Not cute caption energy.

Do not do this:
- Vague "family life is crazy" with no specific thing
- Soft, warm, quietly emotional, or greeting-card
- Blessed / grateful / family is everything / cherish / wholesome
- A lecture, rant, or motivational poster
- Saying the past was simply better
- Comparing ten things in one post
- Inventing fake statistics
- Cute pet captions, fur baby talk, or rainbow-bridge sentiment
- A dry observation with no joke, fight, or discussion hook
`;

type FamilyTrack =
  | "old_school"
  | "modern"
  | "funny"
  | "then_now"
  | "pets"
  | "trending"
  | "recent"
  | "stories";

function pickFamilyTrack(previousPosts: string[]): FamilyTrack {
  const last = (previousPosts[0] || "").toLowerCase();
  const petLast = /\b(dog|cat|puppy|kitten|pet)\b/.test(last);
  const trendLast =
    /tiktok|meme|group chat|airtag|school app|gps|thermostat/.test(last);
  const recentLast =
    /\b(this week|viral|news|headline|everyone is talking)\b/.test(last);
  const storyLast =
    /\b(true story|happened|my sister|my brother|my mom|my dad|my wife|my husband)\b/.test(
      last,
    );
  const jokeLast =
    /\b(mom|dad|sibling|brother|sister|in-law|leftover|chore|kids?)\b/.test(
      last,
    ) && !petLast;

  // After a pet or trend post, the next one is a family joke.
  if (petLast || trendLast) {
    return "funny";
  }

  if (recentLast) {
    return pick(["stories", "funny", "pets", "trending"]);
  }

  if (storyLast) {
    return pick(["recent", "funny", "pets", "modern"]);
  }

  if (jokeLast) {
    return pick([
      "pets",
      "trending",
      "recent",
      "stories",
      "modern",
      "old_school",
    ]);
  }

  return pick([
    "funny",
    "funny",
    "pets",
    "trending",
    "recent",
    "recent",
    "stories",
    "stories",
    "modern",
    "old_school",
  ]);
}

function familyTrackRules(track: FamilyTrack) {
  if (track === "old_school") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: old-school family
Write about ONE old-school family thing that sparks a laugh, discussion, or argument. Rotary phones, Sunday dinner rules, Polaroids, streetlights, one TV, grandparents' house, getting in trouble, calling a friend's house and talking to their mom first. Name the thing. Make the house feel like a courtroom. Land a laugh. Do not spend the post explaining how everything is worse now. Do not make this post about a dog or cat.`;
  }

  if (track === "modern") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: modern family
Write about ONE modern family thing that sparks a laugh, discussion, or argument. Group chats, GPS, school apps, streaming fights, AirTags, chargers, everyone on a different screen in the same room. Name the thing. The fight should feel huge. Land a laugh. Do not turn it into a phone-bad lecture. Do not make this post about a dog or cat.`;
  }

  if (track === "funny") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: family joke
Write a FAMILY JOKE about ONE real household thing that can spark a laugh, discussion, or argument. People, not pets.
Pick one: leftovers, thermostat, remote, milk, chores, bedtime, bathroom, last slice, who left the lights on.
Shape: short setup around that thing, then a punchline someone would screenshot and tag their sibling or spouse.
Play it like a sitcom. The laugh is how extra the family got over that one thing.
No moral. No dog. No cat. No pet meme.`;
  }

  if (track === "pets") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: family pets
The IMAGE is the pet. The POST is about that same pet. Do not write a family story with a dog in the background.

Write a funny pet story that makes people laugh out loud. What the dog or cat actually did. Concrete. Then land a punchline.

Do this:
- First line ALL CAPS, a scroll-stopper about THIS pet moment.
- Short story: the crime, the look on their face, who lost.
- Punchline last. Tag-your-spouse energy. Overlay on the photo is also a punchline.
- Name dog or cat. One specific mess: couch, cake, trash, zoomies at 3am, knocking a glass, stealing a sandwich, judging the family.

Do not do this:
- Cute, wholesome, "pets are family", fur baby, rainbow bridge
- A family fight that barely mentions the animal
- Talking to the pet like a stand-up closer for a whole paragraph
- Soft captions ("my best friend")`;
  }

  if (track === "trending") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: trending family
Riff ONE current viral family / parenting / sibling / household meme or TikTok beat from the trend list into a concrete funny scene at home.
Make it feel like this week's scroll, not a generic family essay.
Keep the post funny. Sitcom stakes. Punchline.
Do not paste the headline. Do not invent celebrity news. Do not make this post about a dog or cat unless the trend itself is clearly a pet meme — if the trend is a pet meme, switch energy to a pet crime with a punchline, still funny.`;
  }

  if (track === "recent") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: recent family event
Pick ONE real recent family-related news / viral family moment from the inspiration list (last few days / this week).
Write a Facebook reaction like a parent in the comments: laugh, argue, or discuss.
Name what happened clearly enough that people know the story. Stay current. Do not invent facts.
Land a punchline, a sharp take, or a "this is exactly my family" hit.
Do not write a news article. Do not moralize. Do not make this post about a dog or cat unless the event itself is a pet story.`;
  }

  if (track === "stories") {
    return `${FAMILY_VOICE_RULES}

THIS POST TRACK: family story
Use a real family story from the inspiration list as fuel. Extract the situation. Create a substantially original household scene.
It must feel like something that happens in a real family and sparks a laugh, discussion, or argument.
Concrete people. Concrete thing. Punchline or discussion hook at the end.
Do not claim a stranger's exact Reddit story happened to you. Do not copy distinctive dialogue. Do not go soft. No dog/cat unless the story is clearly about a pet.`;
  }

  return `${FAMILY_VOICE_RULES}

THIS POST TRACK: then vs now
Write about one comparison between family life in the old days and family life now. Pick one specific thing. Show how it worked then, in a concrete scene. Show how it works now, in a concrete scene. Both sides should feel funny and quite dramatic. The laugh is in the difference. Do not say the past was simply better. Do not make this post about a dog or cat.`;
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
  const topic = (options?.topic || "everyday life").trim().toLowerCase();

  const preset =
    PAGE_DNA[topic] ||
    ({
      identity: `A personal Facebook page about ${options?.topic || "everyday life"}. The content should feel human, specific, useful or emotionally recognizable, never like a generic AI content page.`,

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

      inspirationSources: ["reddit", "pinterest", "historical"],

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
    identity: options?.pageDna?.trim() || preset.identity,

    pillars: options?.pillars?.length ? options.pillars : preset.pillars,

    emotions: options?.emotions?.length ? options.emotions : preset.emotions,

    inspirationSources: options?.inspirationSources?.length
      ? options.inspirationSources
      : preset.inspirationSources,

    formats: options?.formats?.length ? options.formats : preset.formats,

    hookMechanisms: preset.hookMechanisms,

    imageStrategy: options?.imageStrategy?.trim() || preset.imageStrategy,

    allowEmojis: options?.allowEmojis ?? preset.allowEmojis,

    useHashtags: options?.useHashtags ?? preset.useHashtags,

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

  POV: "Only use POV if it helps. One short first line starting with POV:, then drop it and talk normally. Never write a witty caption, a metaphor, or a punchline to the pet.",

  question:
    "Hook with a specific situation, give enough story/context, then payoff with a question people would actually answer. Avoid empty 'who else?' bait.",

  nostalgia:
    "Hook with a concrete object, routine, sound, or place. Tell the memory. Payoff is recognition, not 'the past was better.'",

  emotional:
    "Hook with a small moment, tell what happened, and earn a restrained last line. Do not manufacture a valuable lesson.",

  observation:
    "Hook with a sharp observation, prove it with one concrete scene, then payoff. Not a lecture.",

  list: "Hook with why this list exists, give 3-6 specific items from the same situation, then a short payoff. Not generic advice.",

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
    "one kid at a kitchen table with a mismatched plate",
    "dad asleep on the couch, TV glow, empty living room",
    "handwritten grocery list on a refrigerator, nobody in frame",
    "backyard hose on a summer afternoon, one child at the edge",
    "empty grandparents' living room at dusk with the television on",
    "shoes piled near the front door, no people",
    "a phone on the kitchen counter lighting up with a group chat",
    "one kid FaceTiming, only the back of a head and the phone",
    "car dashboard GPS screen, one parent hand on the wheel",
  ],

  vietnam: [
    "candid phone photo of an adult Vietnamese woman at a normal cafe table with an iced drink",
    "candid phone photo of an adult Vietnamese woman at a restaurant table",
    "candid phone photo of an adult Vietnamese woman on a real beach in a sundress, not bikini",
    "candid phone photo of an adult Vietnamese woman at a hotel resort pool with lounge chairs",
    "candid phone photo of an adult Vietnamese woman at a seaside restaurant",
    "candid phone photo of an adult Vietnamese woman at hotel breakfast",
    "casual iPhone selfie of an adult Vietnamese woman at a cafe table",
    "casual mirror selfie of an adult Vietnamese woman in a hotel or cafe restroom, fully clothed",
    "candid phone photo of an adult Vietnamese woman at a gym with a water bottle, modest sportswear",
    "candid phone photo of an adult Vietnamese woman reading a book at a cafe table",
    "candid phone photo of an adult Vietnamese woman in a bookstore aisle with a paperback",
    "candid phone photo of an adult Vietnamese woman after a jog in a park, sneakers",
    "candid phone photo of an adult Vietnamese woman holding a badminton racket at a court",
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
        body: (post?.selftext || "").replace(/\s+/g, " ").trim().slice(0, 700),
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
    return ["soccer", "football", "CristianoRonaldo", "Messi"];
  }

  if (/pet|dog|cat|animal/i.test(topic)) {
    return ["Pets", "dogs", "cats", "DogAdvice", "CatAdvice"];
  }

  if (/family|parent|mom|dad|child|siblings/i.test(topic)) {
    return [
      "Family",
      "Parenting",
      "daddit",
      "Mommit",
      "marriage",
      "AmItheAsshole",
      "nostalgia",
    ];
  }

  if (/nostalgia|80s|90s|retro|vintage/i.test(topic)) {
    return ["nostalgia", "OldSchoolCool", "90s"];
  }

  return ["CasualConversation", "nostalgia", "OldSchoolCool"];
}

async function collectRealStories(topic: string) {
  const subs = redditSubsForTopic(topic);

  const results = await Promise.allSettled(
    subs.slice(0, 3).map((sub) => fetchRedditStories(sub, 80)),
  );

  const stories = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const unique = stories.filter(
    (story, index, list) =>
      list.findIndex((item) => item.title === story.title) === index,
  );

  return shuffle(unique).slice(0, 6);
}

/**
 * ---------------------------------------------------------
 * INSPIRATION COLLECTOR
 * ---------------------------------------------------------
 */

async function collectInspiration(source: InspirationSource, topic: string) {
  const key = /pet|dog|cat|animal/i.test(topic)
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

  if (source === "family_news") {
    const headlines = await collectFamilyNewsEvents();

    if (headlines.length) {
      return headlines;
    }

    return topicTrends("family parenting viral news");
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

    return shuffle([...HISTORICAL_SEEDS, ...NINETIES_CULTURE]).slice(0, 5);
  }

  if (source === "pinterest") {
    const seeds = PINTEREST_SEEDS[key] || Object.values(PINTEREST_SEEDS).flat();

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
    ...terms
      .slice(0, 2)
      .map(
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
          .filter(
            (item: ImageQuote) =>
              item.text.length > 12 && item.text.length < 140,
          );
      }

      if (Array.isArray(data?.quotes)) {
        return data.quotes
          .map((item: any) => ({
            text: String(item.quote || "").trim(),
            author: String(item.author || "").trim() || "Unknown",
          }))
          .filter(
            (item: ImageQuote) =>
              item.text.length > 12 && item.text.length < 140,
          );
      }

      if (Array.isArray(data)) {
        return data
          .map((item: any) => ({
            text: String(item.q || item.quote || item.content || "").trim(),
            author: String(item.a || item.author || "").trim() || "Unknown",
          }))
          .filter(
            (item: ImageQuote) =>
              item.text.length > 12 && item.text.length < 140,
          );
      }

      return [] as ImageQuote[];
    }),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function looksLikeWeakFamilyOverlay(text: string) {
  const line = text.toLowerCase();

  if (
    /home is where|family is everything|blessed|grateful|meant everything|love of family|heart is|life is about family|pets are family|fur baby|rainbow bridge|unconditional love/.test(
      line,
    )
  ) {
    return true;
  }

  if (
    /like a federal crime|hostage situation|went to war|silent treatment lasted/.test(
      line,
    )
  ) {
    return true;
  }

  const words = wordCount(text);
  return words < 3 || words > 12 || text.length > 80;
}

function looksLikeFamilyFrictionTopic(text: string) {
  return /\b(leftover|thermostat|remote|milk|chore|bedtime|couch|trash|laundry|dish|dinner|breakfast|lunch|toilet|bathroom|shower|towel|sock|shoe|light|door|window|fridge|freezer|oven|microwave|tv|wifi|password|charger|cable|phone|tablet|group chat|school app|gps|airtag|homework|curfew|allowance|grounded|sibling|brother|sister|mom|dad|grandma|grandpa|in-law|holiday|road trip|car seat|backseat|front seat|last slice|sandwich|cookie|cake|pizza|dog|cat|puppy|kitten|pet|zoomies|recycling|volume|mute|streaming|netflix|hulu|disney|spotify|alarm|snooze|weekend|sunday dinner|polaroid|rotary|streetlight|fought|argument|argued|discussed|yelled|silent treatment|viral|this week|school|teacher|parent|parents|kids|wedding|reunion|cousin|uncle|aunt|wife|husband|son|daughter)\b/i.test(
    text,
  );
}

function looksLikeUnfunnyFamilyPost(text: string) {
  const body = text.toLowerCase().replace(/\s+/g, " ").trim();

  if (
    /home is where|family is everything|blessed|grateful|meant everything|love of family|life is about family|pets are family|fur baby|rainbow bridge|unconditional love|cherish|warmth of|heartwarming|wholesome|what we can learn|kids these days|back in my day the world|simply better|teach our children|at the end of the day/.test(
      body,
    )
  ) {
    return true;
  }

  // Soft essay / no sitcom stakes
  if (
    /i love my family|we are so lucky|makes me smile|precious moments|quiet evening|peaceful night|grateful for/.test(
      body,
    )
  ) {
    return true;
  }

  if (!looksLikeFamilyFrictionTopic(body)) {
    return true;
  }

  return false;
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
  const isFamily = /family/i.test(topic);

  if (isFamily) {
    if (cleanedOriginal && !looksLikeWeakFamilyOverlay(cleanedOriginal)) {
      return {
        text: cleanedOriginal,
        author: "",
      };
    }

    const hook = firstSentence(removeHashtags(content))
      .replace(/^["']+|["']+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (hook && !looksLikeWeakFamilyOverlay(hook)) {
      return {
        text: hook,
        author: "",
      };
    }

    const fallback = (cleanedOriginal || hook)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ");

    return {
      text: fallback || "This family could never",
      author: "",
    };
  }

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
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    return input;
  }

  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];

  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) {
      chunks.push(input.subarray(i));
      break;
    }

    while (i < input.length && input[i] === 0xff) {
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

    const length = (input[i] << 8) | input[i + 1];

    const next = i + length;

    const skip = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;

    if (!skip) {
      chunks.push(Buffer.from([0xff, marker]));

      chunks.push(input.subarray(i, Math.min(next, input.length)));
    }

    i = next;
  }

  return Buffer.concat(chunks);
}

async function encodePlainJpeg(raw: Buffer) {
  try {
    const jpeg = await sharp(raw, { failOn: "none" })
      .rotate()
      .resize(1080, 1080, {
        fit: "cover",
        position: "centre",
      })
      .jpeg({
        quality: 86,
        mozjpeg: true,
        chromaSubsampling: "4:2:0",
      })
      .toBuffer();

    return stripJpegMetadata(jpeg);
  } catch {
    return stripJpegMetadata(raw);
  }
}

async function saveCleanJpeg(imagePath: string, raw: Buffer) {
  fs.writeFileSync(imagePath, await encodePlainJpeg(raw));
}

export async function prepareImageForFacebook(imagePath: string) {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return imagePath;
  }

  const cleaned = await encodePlainJpeg(fs.readFileSync(imagePath));
  fs.writeFileSync(imagePath, cleaned);
  log("INFO", `Image cleaned for Facebook: ${path.basename(imagePath)}`);
  return imagePath;
}

function imageMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".png") {
    return "image/png";
  }

  if (ext === ".webp") {
    return "image/webp";
  }

  return "image/jpeg";
}

async function saveGeneratedImageFile(image: {
  b64_json?: string;
  url?: string;
}) {
  fs.mkdirSync(imageDir, { recursive: true });

  const imagePath = path.join(
    imageDir,
    `post-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`,
  );

  if (image.b64_json) {
    await saveCleanJpeg(imagePath, Buffer.from(image.b64_json, "base64"));
    return imagePath;
  }

  if (image.url) {
    const download = await fetch(image.url);

    if (!download.ok) {
      throw new Error("Could not download generated image");
    }

    await saveCleanJpeg(imagePath, Buffer.from(await download.arrayBuffer()));
    return imagePath;
  }

  throw new Error("OpenAI image API returned neither b64_json nor url");
}

async function requestImageEdit(
  model: string,
  prompt: string,
  referenceImagePath: string,
) {
  const bytes = new Uint8Array(fs.readFileSync(referenceImagePath));
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", "1024x1024");
  form.append("quality", "low");
  form.append("output_format", "jpeg");
  form.append(
    "image",
    new Blob([bytes], { type: imageMimeType(referenceImagePath) }),
    path.basename(referenceImagePath),
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey()}`,
    },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const image = data.data?.[0];

  if (!image) {
    throw new Error("OpenAI image edit API returned no image");
  }

  log("INFO", `Image used FB 001.jpg face (${model})`);
  return saveGeneratedImageFile(image);
}

async function generateImage(prompt: string, referenceImagePath?: string) {
  const models = [IMAGE_MODEL, FALLBACK_IMAGE_MODEL];

  let lastError = "";

  for (const model of models) {
    if (referenceImagePath && fs.existsSync(referenceImagePath)) {
      try {
        const edited = await requestImageEdit(
          model,
          prompt,
          referenceImagePath,
        );

        if (edited) {
          return edited;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log(
          "WARN",
          `Face reference edit failed (${model}): ${lastError.slice(0, 240)}`,
        );
      }
    }

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
        lastError = "OpenAI image API returned no image";
        continue;
      }

      fs.mkdirSync(imageDir, {
        recursive: true,
      });

      const filename = `post-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}.jpg`;

      const imagePath = path.join(imageDir, filename);

      if (image.b64_json) {
        await saveCleanJpeg(imagePath, Buffer.from(image.b64_json, "base64"));

        return imagePath;
      }

      if (image.url) {
        const download = await fetch(image.url);

        if (!download.ok) {
          lastError = "Could not download generated image";
          continue;
        }

        await saveCleanJpeg(
          imagePath,
          Buffer.from(await download.arrayBuffer()),
        );

        return imagePath;
      }

      lastError = "OpenAI image API returned neither b64_json nor url";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`OpenAI image API error: ${lastError}`);
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
        "A 6 to 14 word hook for the photo. Related to this exact post. Do not spoil the whole story. No celebrity quote. No author name. No hashtags. For Vietnamese posts, leave this empty: the photo has no overlay. For family posts: 4-10 words, viral-funny, trending meme energy, instant laugh or reaction. Never sentimental. For other topics, spark curiosity, a laugh, or an emotional hit.",
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
    log(
      "WARN",
      `OpenAI responses API ${response.status}: ${details.slice(0, 400)}`,
    );
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
    return "Về ăn mì vậy.";
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
  const cleaned = stripAiMentions(stripEmojis(text))
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/#\S+/g, "")
    .trim();

  const vietnam = /vietnam|vietnamese|du lich|dulich/i.test(topic || "");
  const words = wordCount(cleaned);
  const ok = vietnam
    ? cleaned.length >= 8 &&
      cleaned.length <= 70 &&
      words >= 3 &&
      words <= 10 &&
      !hasGenericAIPhrase(cleaned)
    : cleaned.length >= 12 &&
      cleaned.length <= 180 &&
      words >= 5 &&
      words <= 28;

  if (ok) {
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
      ? "Vietnamese. Same girl. Short Gen-Z chat, 4-10 words. Casual. Not thirsty. Not a pickup line."
      : /family/i.test(topic)
        ? "Funny and quite dramatic. Sitcom energy. Not soft. Not a greeting card."
        : "Funny in a dry, human way. Not a joke setup with a punchline."
  }
- Clearly about THIS post: a reaction, aside, or the thought that did not make the caption.
- ${
    /vietnam|vietnamese|du lich|dulich/i.test(topic)
      ? "4 to 10 Vietnamese words. Youth chat."
      : "One sentence, 8 to 20 words."
  }
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
      const fallback = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
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
        },
      );

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
  referenceImagePath?: string;
}): Promise<GeneratedPost> {
  const topic = options?.topic?.trim() || "everyday life";

  const today = new Date().toISOString().slice(0, 10);

  const dna = resolvePageDna({
    topic,
    pageDna: options?.pageDna,
    pillars: options?.pillars,
    emotions: options?.emotions,
    inspirationSources: options?.inspirationSources,
    formats: options?.formats,
    imageStrategy: options?.imageStrategy,
    allowEmojis: options?.allowEmojis,
    useHashtags: options?.useHashtags,
  });

  const pillar = pick(dna.pillars);
  const emotion = pick(dna.emotions);

  const isFamily = /family/i.test(topic);
  const isVietnam = /vietnam|vietnamese|du lich|dulich/i.test(topic);
  const familyTrack = isFamily
    ? pickFamilyTrack(options?.previousPosts || [])
    : null;
  const format = isVietnam
    ? pick(["funny", "funny", "observation", "relatable"] as PostFormat[])
    : familyTrack
      ? familyTrack === "then_now"
        ? "before_after"
        : "funny"
      : pick(dna.formats);

  const hookMechanism = pick(dna.hookMechanisms);

  const vietnamDaySceneId = isVietnam
    ? readVietnamDayScene(options?.accountName)
    : null;
  let vietnamTrack = isVietnam
    ? pickVietnamTrack(options?.previousPosts || [])
    : null;
  const preferFriendScene =
    isVietnam && isVietnamWeekend() && !vietnamDaySceneId;
  const vietnamScene = isVietnam
    ? pickVietnamScene(
        options?.previousPosts || [],
        vietnamTrack,
        preferFriendScene,
        vietnamDaySceneId,
      )
    : null;

  if (
    isVietnam &&
    vietnamScene &&
    vietnamTrack &&
    !vietnamScene.tracks.includes(vietnamTrack)
  ) {
    vietnamTrack = pick(vietnamScene.tracks as VietnamTrack[]);
  }

  const vietnamFriends =
    isVietnam &&
    isVietnamWeekend() &&
    !!vietnamScene &&
    VIETNAM_FRIEND_SCENE_IDS.has(vietnamScene.id);
  const vietnamDayLocked = Boolean(vietnamDaySceneId && vietnamScene);

  if (isVietnam && vietnamScene) {
    writeVietnamDayScene(options?.accountName, vietnamScene.id);
  }

  const vietnamAngle = isVietnam ? pickVietnamAngle(vietnamFriends) : null;
  const vietnamSelfie = !!vietnamAngle && /selfie/.test(vietnamAngle.id);
  const vietnamAlbumCount = isVietnam ? pickVietnamAlbumCount() : 1;
  const vietnamAlbumAngles =
    isVietnam && vietnamAngle
      ? pickVietnamAlbumAngles(vietnamAlbumCount, vietnamAngle)
      : [];
  const vietnamOutfit = vietnamScene ? vietnamOutfitLock(vietnamScene.id) : "";
  const vietnamCaption =
    isVietnam && vietnamTrack
      ? pickVietnamCaptionStyle(vietnamTrack, options?.previousPosts || [])
      : "chat";
  const vietnamCloser = isVietnam
    ? pickVietnamCloser(options?.previousPosts || [])
    : "";
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
      : familyTrack === "recent"
        ? ["family_news", "family_news", "reddit"]
        : familyTrack === "stories"
          ? ["reddit", "reddit", "family_news"]
          : familyTrack === "pets" ||
              familyTrack === "modern" ||
              familyTrack === "trending" ||
              familyTrack === "funny"
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
    ? true
    : isFootball || fb001Track === "news" || isFamily
      ? true
      : Math.random() < 0.3;

  /**
   * Give the model more previous content,
   * but only short excerpts.
   */
  const previous = (options?.previousPosts || [])
    .slice(0, 12)
    .map(
      (item, index) =>
        `${index + 1}. ${item.replace(/\s+/g, " ").slice(0, 240)}`,
    )
    .join("\n");

  const [inspirationItems, trendItems] = await Promise.all([
    collectInspiration(
      inspirationSource,
      familyTrack === "pets" ? "family pets" : topic,
    ),

    useTrend
      ? isVietnam
        ? fetchHeadlines(
            `https://news.google.com/rss/search?q=${encodeURIComponent(
              "trend tiktok việt OR viral facebook việt OR meme gen z OR câu hot when:7d",
            )}&hl=vi-VN&gl=VN&ceid=VN:vi`,
          )
        : isFamily
          ? fetchFamilyMemeTrends()
          : topicTrends(
              isFootball
                ? "Cristiano Ronaldo Lionel Messi football news"
                : topic,
            )
      : Promise.resolve([] as string[]),
  ]);

  const inspiration = numbered(inspirationItems);

  const optionalTrend = trendItems.length
    ? numbered(shuffle(trendItems).slice(0, 3))
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
      `${vietnamScene ? ` / ${vietnamScene.id}` : ""}` +
      `${vietnamDayLocked ? " / same-day-place" : vietnamScene ? " / new-day-place" : ""}` +
      `${vietnamAngle ? ` / ${vietnamAngle.id}` : ""}` +
      `${isVietnam && vietnamAlbumCount > 1 ? ` / album-${vietnamAlbumCount}` : ""}` +
      `${isVietnam ? ` / ${vietnamCaption}` : ""}` +
      `${familyTrack ? ` / ${familyTrack}` : ""}` +
      `${useTrend ? " / trend" : ""}`,
  );

  const systemPrompt = `
${
  isVietnam
    ? `You write short Facebook posts as a young Vietnamese girl chatting with friends. Human. Funny. A little playful. Gen-Z spoken Vietnamese. Short. Not a poet, not a caption bot, not dry.`
    : `You are an elite Facebook content strategist and writer creating organic content for a US audience.`
}

Your job is NOT to sound impressive.

Your job is to create a post that a real person would stop reading, recognize themselves in, and possibly respond to.
${
  isVietnam && vietnamTrack
    ? vietnamScene
      ? vietnamTrackRules(
          vietnamScene,
          vietnamTrack,
          vietnamCloser,
          vietnamCaption,
        ) + (vietnamFriends ? `\n${VIETNAM_FRIEND_CAPTION}` : "")
      : VIETNAM_VOICE_RULES
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

1. ${
    isVietnam
      ? vietnamTrack === "punchline"
        ? "Write a two-line Vietnamese joke-thính like texting. Anh bảo X. Twist. No Hôm nay anh bảo:. No long quotes. No đang ngắm / tự dưng nghĩ. 12-22 words. Never luôn. Invent a new pun, do not copy mê tín."
        : vietnamCaption === "short" || vietnamCaption === "icons"
          ? `ONE short coherent Vietnamese line about THIS photo. ${vietnamCaption === "icons" ? "Add 2-4 emojis." : "Usually no emoji."} 6-14 words. One thought. No second line.`
          : "Write one short Vietnamese status. She is cá tính, mạnh mẽ, năng động, slay. About 4-10 words. One idea. No flirting. No anh. No thả thính. Not ALL CAPS. Active track: she is doing the sport, reading, or study in this photo."
      : "Write natural American English."
  }
2. Sound human, not like an AI copywriter.
3. Prefer concrete details over generic emotional language.
4. Start close to the interesting part.
5. Do not spend half the post setting up the situation.
6. Give the reader a reason to keep reading.
7. ${
    isVietnam
      ? vietnamCaption === "short" || vietnamCaption === "icons"
        ? "ONE line only. One coherent joke/thought. No second paragraph. No essay."
        : vietnamTrack === "punchline"
          ? "Two short punchline lines only. No essay."
          : "Stop after one short coherent line. No essay payoff. No moral."
      : "Every post must have a payoff: a laugh, a recognition hit, a useful takeaway, an earned emotion, or a question worth answering. Not every post needs a valuable lesson."
  }
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
18. ${
    isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons")
      ? "One line is enough. Meaning must liền mạch. Do not add a second line to look complete."
      : "Format the post with real line breaks. Short paragraphs. A blank line between paragraphs. Never one wall of text."
  }

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

${
  isVietnam
    ? vietnamTrack === "punchline"
      ? `Talk like a young girl on Facebook:
two short punchline lines only
→ stop. Setup then twist. Never a lone "Thôi."`
      : `Talk like a young girl on Facebook:
ONE short coherent chat line about THIS photo
→ stop. Human, funny, playful. 6-14 words. Meaning liền mạch. Never a lone "Thôi."`
    : `Every post MUST have this shape:

HOOK (one catching sentence, its own first paragraph)
→ actual point / story / situation
→ PAYOFF

The first line is one sentence, written in ALL CAPS. It is about this post. It creates urgency and curiosity so someone stops scrolling and wants to read the rest. It does not dump the whole story.`
}

Good first lines:
${
  isVietnam
    ? `Tan làm muộn quá trời.
Chụp xong xóa.
Gọi size lớn.`
    : `THEY USED TO SHARE ONE PHONE. Nobody shares a table now.
AMERICA ALMOST LOST THIS IN A SINGLE AFTERNOON.
THE HOUSE PHONE USED TO BE AN EVENT.`
}

Bad first lines:
You won't believe what happened next.
Let me tell you about family dinners.
Here's the thing about US history.
Bạn sẽ không tin điều gì xảy ra tiếp theo.
Ngồi bên hồ mà thấy lười ghê.
Đứng trên rooftop mà thấy mệt ghê.

${
  isVietnam
    ? `Normal sentence case for the whole post. Do not uppercase the first line.

Talk in one spoken sentence. What happened + the tiny joke in the SAME line. Meaning liền mạch.`
    : `The rest of the post is normal sentence case. Only the first sentence is uppercase.

The middle is a real scene, detail, or point worth reading.
The payoff gives them a reason to stay, react, or comment.

A single relatable line is not a post.`
}

LINE BREAKS

This is required in the content field.

${
  isVietnam
    ? vietnamTrack === "punchline"
      ? "Write 2 short punchline lines. Blank line between them. Under ~22 words total."
      : "Write ONE short coherent line only. No blank line. No second paragraph. 6-14 words. Meaning liền mạch."
    : "Write 3 to 5 short paragraphs."
}
${
  isVietnam && vietnamTrack !== "punchline"
    ? "Do not add a second line. Do not add hashtags."
    : isVietnam
      ? "Put a blank line between the two punchline lines. Do not add hashtags."
      : "Put a blank line between every paragraph.\nPut the hashtags after another blank line, on their own last line."
}

The content string must look like this:

${
  isVietnam
    ? vietnamTrack === "punchline"
      ? `Anh bảo không đói.

Ngồi nhìn em ăn cũng được.`
      : `Chụp 20 tấm rồi xóa 19 vì mặt hơi dừ.`
    : `THEY USED TO FIGHT OVER ONE PHONE IN THE HALLWAY.

Grandma would stand there timing you. You got five minutes. If someone called the house, the whole family knew.

Now everyone is on their own phone at the same table, and nobody says a word.

#FamilyLife #ThenVsNow`
}

${
  isVietnam && vietnamTrack !== "punchline"
    ? "In JSON, that means one line inside the string. No \\n\\n. Meaning must hold as one thought."
    : `In JSON, that means real newline characters: paragraph, \\n\\n, paragraph, \\n\\n, paragraph${isVietnam ? "." : ", \\n\\n, hashtags."}`
}

${
  isVietnam && vietnamTrack !== "punchline"
    ? "Do not split into two scraps. Do not pad with a second paragraph."
    : "Do not write the post as one paragraph.\nDo not join sentences with extra spaces instead of line breaks."
}
Do not use labels like Hook: or Story:.

The assigned format decides the kind of post:

- funny: payoff is the laugh
- relatable: payoff is "that's my life"
- useful: payoff is a concrete takeaway
- emotional: payoff is an earned feeling
- question: payoff is a question people would actually answer

Do NOT force a moral, life lesson, or "what I learned."
${isVietnam ? "A life post can just be tired and short. A flirt post is only a quiet hint. Stop." : "A funny post can just be funny. A question post can just be a good question."}

HASHTAGS

${
  isVietnam
    ? "Do not use hashtags. No # tags anywhere in the post."
    : `Hashtags are required.

Use exactly 2-4 hashtags on their own last line, after a blank line.

They must be specific to this post and this topic.

Good: #DuLich #Vietnam #DaLat #HoiAn #Cafe #Ronaldo #Messi #Football #FamilyLife #FamilyPets
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
${
  isVietnam
    ? `
Vietnamese AI voice, never:
"gió nhẹ thổi qua"
"trái tim em"
"ký ức"
"cảm giác lãng đãng"
"thật tình mà nói"
"có ai nghe em nói không"
"có ai cũng thấy mình... không nhỉ"
"tự hỏi..."
"cực khó chịu luôn"
"Đọc sách mà bụng kêu réo ầm ĩ"
"Hôm nay anh bảo:"
"tự dưng nghĩ"
"đang ngắm..."
"cạn kiệt năng lượng"

Write like texting. Not like a caption writer performing relatability. Not a fake conversation scene.
`
    : ""
}

Do not use them unless absolutely necessary.

Do not overuse rhetorical questions.

Do not explain the joke after making the joke.

Do not explain the emotion after creating the emotion.

FORMAT

${
  isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons")
    ? "One short funny spoken line about this photo. Then stop. Do not tell a three-beat story."
    : FORMAT_INSTRUCTIONS[format]
}

LENGTH

${
  isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons")
    ? "4-12 Vietnamese words. One funny line. Stop."
    : familyTrack === "pets"
      ? "Usually 50-110 words. Funny pet story, then a punchline. Stop when people would laugh."
      : dna.lengthGuide
}

HOOK RULE

${
  familyTrack === "pets"
    ? "Start with one catching ALL CAPS line about what the pet did. Then the funny story. Land a punchline people would laugh at or tag. Do not go cute."
    : dna.hookRule
}

STRUCTURE

${
  isVietnam
    ? vietnamCaption === "short" || vietnamCaption === "icons"
      ? `ONE short coherent spoken line about THIS photo. ${vietnamCaption === "icons" ? "Then 2-4 emojis." : "Usually no emoji."} 6-14 words. Meaning liền mạch. Normal case. Not ALL CAPS.`
      : vietnamTrack === "punchline"
        ? `2 short punchline lines. Setup then twist. Gen-Z spoken Vietnamese. Normal case. Not ALL CAPS.`
        : `ONE short coherent line. Gen-Z spoken Vietnamese. 6-14 words. Meaning liền mạch. Normal case. Not ALL CAPS. Not a caption.`
    : `Required, not optional:

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
The payoff must match the assigned format. Do not default to a valuable lesson.`
}

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
  dna.allowEmojis || vietnamTrack === "punchline" || vietnamCaption === "icons"
    ? vietnamCaption === "icons"
      ? "Use 2-4 emojis that fit this photo. Still a real Vietnamese line, not only stickers."
      : vietnamTrack === "punchline"
        ? "One emoji at the end is OK. Do not spam emojis."
        : "Use emojis sparingly only when they genuinely fit."
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

${
  isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons")
    ? "One short funny spoken line about this photo. Then stop. Do not tell a three-beat story."
    : FORMAT_INSTRUCTIONS[format]
}

HOOK MECHANISM

${hookMechanism}

INSPIRATION SOURCE

${
  isVietnam
    ? "current Vietnamese tiktok/meme/viral slang plus her scene today"
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
    ? `These are CURRENT trends, memes, viral lines, and scene prompts.
Stay on the assigned track (${vietnamTrack}). Entire post in Vietnamese.
Pick ONE trend/meme/slang/news beat from the lists if it is actually current. Twist it into THIS scene. Creative wording. Do not say luôn. Do not say ghê luôn.
${
  vietnamTrack === "flirting"
    ? "Soft hint only. Do not copy internet thả thính."
    : vietnamTrack === "punchline"
      ? `JOKE-THÍNH STYLE. Two lines. Setup then twist. Can say anh. One emoji OK.
Example energy (do NOT copy the mê tín joke):
${VIETNAM_PUNCHLINE_SEEDS[0]}
Invent a new pun. Do not reuse mê tín / mê tôi.`
      : "Do NOT thả thính. Life post, funny and playful, plus a trend twist if it fits."
}

OPTIONAL CURRENT TREND

${optionalTrend}

Use a trend. Riff it. Do not ignore the list just to write "lười ghê luôn" again.`
    : isFootball
      ? `These are live football headlines, especially Ronaldo, Messi, matches, and related news.
Pick ONE real story. Write a Facebook fan reaction to it.
Do not invent scores, transfers, quotes, or matches.`
      : isFamily
        ? familyTrack === "recent"
          ? `These are RECENT family-related headlines and viral family moments.
Pick ONE real recent family event / parenting story / viral family moment from the lists.
Write a Facebook reaction: laugh, argue, or discuss. Stay current. Do not invent facts.
EVERY post must make people laugh, argue in the comments, or tag someone. Not soft. Not a lecture.
The IMAGE overlay (imageQuote) MUST feel trending and funny: scroll-stopper, instant reaction.
Do not paste the headline as the whole post. Do not write a news article.

OPTIONAL CURRENT TREND

${optionalTrend}`
          : familyTrack === "stories"
            ? `These are real family stories and situations from Reddit / inspiration.
Extract the human situation. Rewrite into an ORIGINAL funny household story people would discuss.
Do not copy distinctive details or claim the exact source story happened to the writer.
EVERY post must make people laugh, argue, or tag someone. Concrete thing. Punchline or discussion hook.
The IMAGE overlay (imageQuote) MUST feel trending and funny.

OPTIONAL CURRENT TREND

${optionalTrend}`
            : `These are CURRENT viral family memes, TikTok sounds, and Facebook lines people are reacting to this week.
EVERY post must be FUNNY. Laugh or tag. Not soft. Not a lecture.
The IMAGE overlay (imageQuote) MUST feel trending and funny: a scroll-stopper that gets a laugh, a tag, or "that's my family" in one second.
Riff a current meme format onto THIS household moment. Do not paste a news headline. The post body stays a funny family/pet story. The overlay is the bait.
${
  familyTrack === "pets"
    ? "THIS POST and THIS PHOTO are the same pet story. Funny dog/cat story. Punchline. Make people laugh. Overlay is a punchline about the pet. Do not write a family dinner with a dog in the corner."
    : familyTrack === "trending"
      ? "THIS POST riffs a CURRENT viral family/parenting/sibling meme from the trend list into a funny household scene. Must be funny. Punchline. Do not paste the headline. No pet in the photo unless the chosen trend is clearly a pet meme."
      : "Do not make this post about a dog or cat. No pet in the photo. Still make it funny enough to tag someone."
}

OPTIONAL CURRENT TREND

${optionalTrend}`
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

${
  isVietnam
    ? vietnamCaption === "short" || vietnamCaption === "icons"
      ? `one short coherent line about THIS photo, then stop. ${vietnamCaption === "icons" ? "Add 2-4 emojis." : "Usually no emoji."} Meaning liền mạch.`
      : vietnamTrack === "punchline"
        ? `paragraph 1 (setup, NOT ALL CAPS)

blank line

paragraph 2 (twist, then stop)`
        : `one short coherent chat line about THIS photo, then stop. No blank line.`
    : `paragraph 1 (ONE catching sentence in ALL CAPS about this post. Curiosity. Urge to read more.)

blank line

paragraph 2 (what happened)

blank line

paragraph 3 (payoff)`
}
${
  isVietnam
    ? ""
    : `
blank line

#Two #ToFour #Hashtags`
}

${
  isVietnam &&
  (vietnamCaption === "short" ||
    vietnamCaption === "icons" ||
    vietnamTrack !== "punchline")
    ? "One line in the JSON string. Meaning liền mạch. Do not pad with a second paragraph."
    : "Use real \\n\\n line breaks inside the JSON string. If the post is longer, add another short paragraph, still with blank lines between them. Never one wall of text."
}

${
  familyTrack === "pets"
    ? "Start with one catching ALL CAPS line about what the pet did. Then the funny story. Land a punchline people would laugh at or tag. Do not go cute or sentimental."
    : dna.hookRule
}

${
  isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons")
    ? "6-14 Vietnamese words. One coherent line. Stop."
    : familyTrack === "pets"
      ? "Usually 50-110 words. Funny pet story, then a punchline. Stop when people would laugh."
      : dna.lengthGuide
}

${
  isVietnam
    ? `Write the whole post in Vietnamese from this scene: ${vietnamScene?.beat}. Track: ${vietnamTrack}. ${
        vietnamTrack === "punchline"
          ? "Hai câu ngắn như nhắn tin. Câu 1: Anh bảo... (ngắn, không Hôm nay anh bảo:, không dấu ngoặc dài). Câu 2 twist. Một emoji cuối. Không đang ngắm / tự dưng nghĩ. 12-22 words."
          : vietnamCaption === "short" || vietnamCaption === "icons"
            ? `Một câu ngắn, rõ, một ý về tấm này rồi dừng. ${vietnamCaption === "icons" ? "Thêm 2-4 emoji hợp cảnh." : "Thường không cần emoji."} Khoảng 4-10 từ. Không nối việc khác bằng mà. Xấu: "Gọi nước mà nhìn vào gương hỏi bao giờ mới xong bữa tập đây?" Đúng: "Bao giờ mới xong bữa tập đây?"`
            : `Một câu ngắn, rõ, một ý. Khoảng 4-10 từ. Không nối hai việc bằng mà. Không 2 dòng. Không dùng chữ luôn. Không cực khó chịu. Không tự hỏi / có ai cũng... không nhỉ. Không Hôm nay anh bảo. Không tự dưng nghĩ. ${
                vietnamTrack === "flirting" || vietnamTrack === "punchline"
                  ? "Không thả thính. Một câu cô ấy đang làm việc trong ảnh. Cá tính, mạnh mẽ, năng động. Không nói anh."
                  : vietnamTrack === "active"
                    ? "Bài về tập / thể thao / đọc sách / học trong tấm này. Cô ấy đang làm, không bỏ cuộc. Một câu rõ. Không caption truyền động lực. Không thả thính. Không nói anh."
                    : "Cô gái cá tính, mạnh mẽ, năng động. Một câu về đúng việc trong ảnh. Không thả thính. Không thơ. Không caption du lịch. Không lười buồn. Không nói anh."
              }`
      } Bài và ảnh cùng một chỗ. ${vietnamDayLocked ? `Cùng ngày, vẫn ở ${vietnamScene?.beat}. Góc khác / khoảnh khắc khác, không đổi địa điểm.` : ""} ${vietnamFriends ? "Cuối tuần đi với bạn: một câu có chữ bạn hoặc tụi. Ảnh có 1-2 bạn nữ." : vietnamAlbumCount > 1 ? "Nhiều tấm cùng một chỗ, cùng đồ, khác góc." : vietnamSelfie ? "Ảnh là selfie. Có thể giỡn chuyện chụp, xóa, góc mặt, nhưng vẫn ở chỗ này." : "Một chi tiết thật từ scene (ly, cát, đĩa, ghế, vợt, sách, bình nước)."} Mix in ONE current trend if it fits, unless this is punchline. No gió nhẹ, no trái tim. No ALL CAPS. No telegram. No hashtags. First line is NOT "ngồi bên hồ mà thấy lười ghê".`
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
                ? "MUST be about ONE old-school family thing that sparks a laugh, discussion, or argument. Punchline. Do not go soft. Do not lecture. No dog/cat."
                : familyTrack === "modern"
                  ? "MUST be about ONE modern family thing that sparks a laugh, discussion, or argument: group chat, GPS, school app, streaming, charger. Huge stakes, punchline. Do not rant. No dog/cat."
                  : familyTrack === "pets"
                    ? "MUST be about a pet thing that exists in the house and causes a laugh or argument. Photo is the pet. Punchline people would tag. Not cute. Hashtags like #FamilyPets #DogsOfFacebook #CatDad #FamilyLife when they fit."
                    : familyTrack === "trending"
                      ? "MUST riff ONE current viral family meme into a concrete household thing people argue about. Punchline. Tag energy. Hashtags like #FamilyLife #ParentingHumor #FamilyHumor when they fit."
                      : familyTrack === "recent"
                        ? "MUST react to ONE real recent family-related event or viral family moment from the inspiration list. Laugh, discuss, or argue. Do not invent facts. Punchline or sharp take. Hashtags like #FamilyLife #ParentingHumor #FamilyNews when they fit."
                        : familyTrack === "stories"
                          ? "MUST be an original family story inspired by the list. Real-household energy. Laugh or discussion. Do not copy the source. Punchline. Hashtags like #FamilyLife #FamilyStories #ParentingHumor when they fit."
                          : familyTrack === "funny"
                            ? "MUST be a family joke about ONE real household thing: leftovers, thermostat, remote, milk, chores, bedtime. Setup then punchline. No dog/cat."
                            : "MUST be funny then vs now about ONE family thing people still argue about. Punchline. Not a lecture. No dog/cat."
              : ""
}

${isVietnam ? "Do not use hashtags." : "End with 2-4 relevant hashtags on their own last line. No generic AI hashtags."}

The post should feel like something worth seeing in a Facebook feed, not an article.

IMAGE

Create a concise image prompt that visually matches the exact situation in the final post.

${
  isVietnam
    ? `This Vietnamese post has NO text on the photo. imageQuote must be an empty string. imagePrompt must describe a candid photo with no overlay, no caption, no quote, no letters, and no words anywhere in the frame.`
    : `The photo MUST include a short, readable hook line. That line is not a recap. It is bait.

${
  isFamily
    ? "imageQuote must be 4-10 words that make someone laugh or react immediately."
    : "imageQuote must be 6-14 words that make someone stop, feel something, and tap to read the rest."
}

${
  isFamily
    ? familyTrack === "pets"
      ? `For this pet post, the PHOTO is the dog or cat. The POST is the funny story about that same pet. They must match.

imageQuote is the overlay punchline. 4-10 words. Viral-funny. Instant laugh. Can be ALL CAPS.
About THIS pet crime, not a recap of the whole story.

imagePrompt: the dog or cat is the subject. 0-1 people, or just hands. Guilty face, stolen food, couch, trash, zoomies. No crowd. Extra faces look AI.

Good overlay:
HE KNOWS WHAT HE DID
THE DOG ATE THE EVIDENCE
POV: the cat chose dad
WHO LET HIM ON THE COUCH
This is his house now
Not the sandwich though

Bad:
Pets are family.
Fur baby energy.
My best friend.
Home is where the heart is.`
      : `For this family post, imageQuote is the overlay. It MUST stop the scroll.

4-10 words. Viral-funny. Trending meme energy. Instant laugh or reaction. Can be ALL CAPS.
Tied to THIS household moment. Not a recap. Not a sitcom subtitle. Never soft or sentimental.
If a current meme format is in the trend list, riff it onto this story.

imagePrompt: 0-2 people only. One person, a pair, or just objects in a room. NO dog, NO cat, NO pet in this photo. This post is not about pets. No group of three or more. No crowded table. No family portrait. Extra faces look AI.

Good:
POV: mom found the leftovers
WHO TOUCHED THE THERMOSTAT
The group chat went silent
Not the leftovers being sacred
Tell me you have siblings
This family could never
When dad says he's not mad

Bad:
Mom treated leftovers like a federal crime.
Home is where the heart is.
Family dinners meant everything.
Life is about family.
Dinner was a hostage situation.`
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

Not a celebrity quote. Not a generic slogan. No author name. No hashtags. Spell it correctly.`
}

${dna.imageStrategy}

${
  options?.imageStyle?.trim()
    ? `Additional image style:
${options.imageStyle.trim()}`
    : ""
}
`;

  let generated = await generateStructuredContent(systemPrompt, userPrompt);

  let content = normalizePostContent(generated.content?.trim() || "", {
    allowEmojis:
      dna.allowEmojis ||
      vietnamTrack === "punchline" ||
      vietnamCaption === "icons",
    useHashtags: dna.useHashtags,
    keepFirstLineCase: isVietnam,
  });

  /**
   * One lightweight repair attempt.
   *
   * This protects against occasional generic AI openings
   * without turning the system into an expensive multi-call
   * generation pipeline.
   */
  const validation = validateGeneratedPost(content, {
    minWords:
      vietnamCaption === "short" || vietnamCaption === "icons"
        ? 3
        : dna.minWords,
    maxWords:
      vietnamCaption === "short" || vietnamCaption === "icons"
        ? 18
        : dna.maxWords,
    shortFunnyHook: /pet/i.test(topic),
    useHashtags: dna.useHashtags,
    casualVietnam: isVietnam,
    familyPets: familyTrack === "pets",
    funnyFamily: isFamily,
    familyJokes: familyTrack === "funny",
    shortVietnam:
      isVietnam && (vietnamCaption === "short" || vietnamCaption === "icons"),
    vietnamFriends,
    vietnamIcons: isVietnam && vietnamCaption === "icons",
    previousEndings: isVietnam
      ? (options?.previousPosts || []).slice(0, 6).map(normalizeEnding)
      : undefined,
    previousHay: isVietnam
      ? (options?.previousPosts || []).slice(0, 5).join("\n")
      : undefined,
  });

  if (!validation.valid) {
    log(
      "WARN",
      `${options?.accountName || topic} post quality guard: ${validation.reason}`,
    );

    const repairSystemPrompt = isVietnam
      ? `
Rewrite this Vietnamese Facebook post in short Gen-Z chat. Like texting a friend in 10 seconds. Human, funny, a little playful. Not a poet. Not a caption writer. Not dry.

Fix this problem:

${validation.reason}

Rules:
- Entirely Vietnamese. Youth chat. Funny, playful. Catch a trend if one is listed. No luôn. No ghê luôn. No cực khó chịu. No tự hỏi. No có ai cũng... không nhỉ. Normal case.
- ${
          vietnamCaption === "short" || vietnamCaption === "icons"
    ? `ONE short clear line about this photo. ${vietnamCaption === "icons" ? "Include 2-4 emojis." : "Usually no emoji."} About 4-10 words. One idea. Do not glue a second action with mà. Good: "Bao giờ mới xong bữa tập đây?"`
    : vietnamTrack === "punchline"
      ? "2 short punchline lines. Setup then twist. Cut the rest."
      : "ONE short clear line. About 4-10 words. One idea. Do not glue a second action with mà."
        }
- No ALL CAPS first line. No telegram (ĐÓI. Tan làm. Về.).
- Do not open with ngồi bên hồ / mà thấy lười ghê / đứng bên + place. Drop the scenery announcement. Start with a thought or hassle.
- Banned: ngọt ngào, gió nhẹ, trái tim, ký ức, lãng đãng, lấp lánh, thật tình mà nói, biết đâu, chỉ cần anh, mỏi lòng, ánh mắt, cực khó chịu luôn, tự hỏi, có ai cũng, không nhỉ, Hôm nay anh bảo, tự dưng nghĩ, đang ngắm, cạn kiệt, năng lượng, long quotation marks.
- Track is ${vietnamTrack}. ${vietnamFriends ? "Weekend with friends. ONE line. Must say bạn or tụi. She is still confident, not flirty. " : ""}No flirting. No anh. No thả thính. ${vietnamTrack === "active" ? "She is doing the sport, reading, or study in THIS photo. Confident, not a quit-joke. No gym poster." : "One clear confident line about what she is doing in the photo."}
- Do not end with a lone Thôi.
- Return only the revised post.
`
      : isFamily
        ? `
Rewrite this Facebook family post so it is FUNNY. Sitcom energy. People should laugh or tag someone.

Fix this problem:

${validation.reason}

Rules:
- Natural American English.
- Start with one catching ALL CAPS line on its own first line that is already funny.
- About ONE real family thing that sparks a laugh, discussion, or argument. Name the thing. Small thing, huge stakes.
- End on a punchline. Not soft. Not blessed. Not a lecture.
- Track is ${familyTrack}. ${
            familyTrack === "pets"
              ? "Pet thing that causes a house laugh or argument. Photo is the pet. Punchline."
              : familyTrack === "trending"
                ? "Riff a current family meme into one concrete household fight or discussion. Punchline."
                : familyTrack === "recent"
                  ? "React to one real recent family event or viral family moment. Do not invent facts. Laugh or discussion. Punchline."
                  : familyTrack === "stories"
                    ? "Original family story inspired by the list. Do not copy the source. Laugh or discussion. Punchline."
                    : familyTrack === "funny"
                      ? "Family joke about one household thing: leftovers, thermostat, remote, milk, chores, bedtime. Setup then punchline. No dog or cat."
                      : "One family thing people laugh about or argue about. Punchline. No dog or cat."
          }
- Short paragraphs with blank lines. 55-110 words.
- End with 2-4 specific hashtags.
- No #Blessed #GoodVibesOnly #FamilyIsEverything.
- Return only the revised Facebook post.
`
        : `
Rewrite the Facebook post below so it has a real hook, an actual point or story, and a payoff.

Keep the core idea and the assigned vibe (funny, relatable, useful, emotional, or question). Do not turn it into a life lesson unless it already is one.

Fix this problem:

${validation.reason}

Rules:

- Natural American English.
- Start with one catching sentence in ALL CAPS on its own first line, related to this post, that makes people want to read more.
- The rest of the post is normal sentence case.
- Keep hook → story/point → payoff. One relatable sentence is not enough.
- Use short paragraphs with a blank line between them. Do not return one wall of text.
- ${
            familyTrack === "pets"
              ? "This post's photo is the pet. Keep it a funny dog or cat story plus a punchline. Make people laugh. Not cute. Not a family dinner with a dog in the corner."
              : dna.hookRule
          }
- ${
            familyTrack === "pets"
              ? "Usually 50-110 words. Story then punchline."
              : dna.lengthGuide
          }
- End with 2-4 specific hashtags on their own last line.
- Do not use generic AI hashtags like #LifeChangingMoment, #Blessed, or #GoodVibesOnly.
- Remove generic AI phrases.
- Do not make it longer unless necessary.
- Do not explain what you changed.
- Return only the revised Facebook post.
`;

    const repairResponse = await fetch("https://api.openai.com/v1/responses", {
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
    });

    if (repairResponse.ok) {
      const repairData = (await repairResponse.json()) as OpenAIResponsePayload;

      const repaired = extractResponseText(repairData);

      if (repaired) {
        content = normalizePostContent(repaired, {
          allowEmojis:
            dna.allowEmojis ||
            vietnamTrack === "punchline" ||
            vietnamCaption === "icons",
          useHashtags: dna.useHashtags,
          keepFirstLineCase: isVietnam,
        });
      }
    }
  }

  if (!content) {
    throw new Error("OpenAI generated empty Facebook post");
  }

  /**
   * If the model decides the post does not need
   * an image, respect it unless forceImage=true.
   */
  const commentPromise = generateFunnyComment(content, topic);

  if (!generated.needsImage && !options?.forceImage) {
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
   * FB 001 / Vietnam: no overlay text on the photo.
   */
  const quote = isVietnam
    ? { text: "", author: "" }
    : pickQuoteForPost(topic, content, generated.imageQuote);

  if (isVietnam) {
    log("INFO", "Image overlay skipped");
  } else {
    log(
      "INFO",
      quote.author
        ? `Image quote: "${quote.text}" — ${quote.author}`
        : `Image quote: "${quote.text}"`,
    );
  }

  const imagePrompt = [
    dna.imageStrategy,

    vietnamScene
      ? vietnamSelfie
        ? `New iPhone SELFIE of the SAME woman as the attached reference. Assigned scene: ${vietnamScene.photo}. ${vietnamAngle ? `Camera: ${vietnamAngle.photo}` : "Front camera, arm's length."} Same hair, skin, age, and face. Confident slay look: a bit taller, long legs, sure posture, cá tính and energetic. Not flirty, not posed for a boy. She is holding the phone. Looking toward the camera is OK. New clothes for this place. Fully clothed. Not sexy. Real slightly imperfect phone selfie, not a studio portrait, not a render.`
        : `New photograph of the SAME woman as the attached reference, but a DIFFERENT camera angle and crop. Assigned scene: ${vietnamScene.photo}. ${vietnamAngle ? `Camera: ${vietnamAngle.photo}` : ""} Same hair, skin, age, and face. Confident slay look: a bit taller, long legs, sure posture, cá tính and energetic. Not flirty, not posed for a boy — show legs when full-body or three-quarter. Do not copy the reference pose, bikini, or frontal face crop. Change clothes to this scene. Fully clothed. Not sexy. Candid phone photo, not a render.`
      : "",

    vietnamFriends ? VIETNAM_FRIEND_PHOTO : "",

    options?.referenceImagePath
      ? vietnamSelfie
        ? "The attached image is identity only. Same face. Taller / longer-legged idol proportions OK. This post is a selfie: she may look at the camera. New outfit, new place. Do not copy the reference background, pose, or bikini."
        : "The attached image is identity only. Same face. Taller / longer-legged idol proportions OK. New pose. New angle. Do not invent a different woman, and do not recreate a frontal portrait of that face."
      : "",

    isVietnam
      ? vietnamSelfie
        ? "Familiar real settings: cafe, restaurant, beach, resort, hotel, park, gym, yoga studio, bookstore, sports court. This is a real iPhone selfie. Natural skin, slightly imperfect. Idol: a bit tall, long legs. NOT cinematic, NOT CGI, NOT a beauty-studio face. Fully clothed. Modest sportswear when active. NO bikini, lingerie, wet look, or sexual pose."
        : "Familiar real settings only: cafe, restaurant, beach, resort, hotel breakfast, park, gym, yoga studio, bookstore, study desk, sports court. Candid iPhone look. Natural skin, real furniture, slightly imperfect. Idol: a bit tall, long legs, slim long proportions. Prefer full-body or three-quarter when the angle allows. NOT cinematic, NOT editorial, NOT CGI. Fully clothed. Modest sportswear when active. NO bikini, lingerie, wet look, or sexual pose. NEVER wet market, supermarket, laundry, or bus."
      : generated.imagePrompt?.trim() ||
        `A candid everyday moment related to ${topic}`,

    isVietnam
      ? `The photograph must match this caption: "${content.replace(/\s+/g, " ").trim()}". Same place${vietnamDayLocked ? " as earlier posts today" : ""}, same outing. If the post mentions a drink, food, sand, pool, or street, that thing is in the frame. Do not show a different location.`
      : familyTrack === "pets"
        ? `The photograph must match this caption: "${content.replace(/\s+/g, " ").trim()}". The dog or cat in the post is in the photo doing that thing. Do not show a family scene without the pet.`
        : "The image must match the exact situation in the Facebook post.",

    "Natural human behavior and believable surroundings.",

    isVietnam
      ? "NO text on the photograph. No quote, no caption, no overlay, no letters, no Vietnamese words, no English words, no slogans."
      : `The photograph must include this exact hook line in clear, readable English text on the image: "${quote.text}"`,

    isVietnam
      ? "If the reference photo has text, do not copy it. The new photo is clean: only the woman and the scene."
      : isFamily
        ? familyTrack === "pets"
          ? "The dog or cat from this post MUST be the subject of the photo. 0-1 people or just hands. Guilty pet, stolen food, couch, trash. The overlay is a punchline about this pet. No group photo. Too many faces looks AI-generated."
          : "Maximum TWO people in the frame, preferably one person or no faces: hands, a phone, leftovers, an empty chair, a room after the fight. NO dog, NO cat, NO pet in this photo. This post is not about pets. No group photo, no crowded dinner, no four kids at the table. Too many faces looks AI-generated."
        : "",

    isVietnam
      ? ""
      : isFamily
        ? familyTrack === "pets"
          ? "The overlay text must be a SHORT punchline about this pet. Instant laugh. Huge, easy to read, correctly spelled. Not cute. Not sentimental. No extra slogans."
          : "The overlay text must be a SHORT viral-funny line. Trending meme energy. Instant laugh or reaction. Huge, easy to read, correctly spelled. Not a recap. Not a sitcom subtitle. No sentimental line. No extra slogans."
        : "The overlay text must create curiosity, a laugh, or an emotional hit. It must not spoil the whole post. Large, easy to read, correctly spelled, no extra slogans.",

    isVietnam
      ? ""
      : "Do not add a celebrity name, author, or fake attribution.",

    "No logos.",
    "No watermarks.",
    "No collage.",
    "No split screen.",
    "No UI.",
  ]
    .filter(Boolean)
    .join(". ");

  const captionText = content.replace(/\s+/g, " ").trim();

  async function generateVietnamShot(
    angle: (typeof VIETNAM_ANGLES)[number],
    followUp: boolean,
    shotIndex: number,
    shotCount: number,
    referencePath?: string,
  ) {
    const selfie = /selfie/.test(angle.id);
    const prompt = [
      dna.imageStrategy,
      vietnamOutfit,
      followUp
        ? `Follow-up shot ${shotIndex + 1} of ${shotCount} from the SAME outing. The attached photo is shot 1. SAME woman, SAME clothes, SAME color outfit, SAME place. Only a new camera angle and a small pose change. Do not change the dress, hair length, or location.`
        : `${
            selfie
              ? `New iPhone SELFIE of the SAME woman as the attached reference. Assigned scene: ${vietnamScene?.photo}. Camera: ${angle.photo}. Same hair, skin, age, and face. Confident slay look: a bit taller, long legs, sure posture, cá tính and energetic. Not flirty, not posed for a boy. She is holding the phone. Looking toward the camera is OK.`
              : `New photograph of the SAME woman as the attached reference, but a DIFFERENT camera angle and crop. Assigned scene: ${vietnamScene?.photo}. Camera: ${angle.photo}. Same hair, skin, age, and face. Confident slay look: a bit taller, long legs, sure posture, cá tính and energetic. Not flirty, not posed for a boy — show legs when full-body or three-quarter. Do not copy the reference pose, bikini, or frontal face crop.`
          } Keep ${vietnamOutfit} for every shot in this dump. Fully clothed. Not sexy. Real slightly imperfect phone photo, not a render.`,
      vietnamFriends ? VIETNAM_FRIEND_PHOTO : "",
      followUp
        ? "The attached photo is identity AND outfit AND place. Same tall / long-legged proportions. Copy her clothes and the location. New angle only."
        : selfie
          ? "The attached image is identity only. Same face. Taller / longer-legged idol proportions OK. This shot is a selfie: she may look at the camera. New outfit for this place, then freeze that outfit. Do not copy the reference background, pose, or bikini."
          : "The attached image is identity only. Same face. Taller / longer-legged idol proportions OK. New pose. New angle. Do not invent a different woman.",
      shotCount > 1 && !followUp
        ? `This is shot 1 of ${shotCount}. Remember this exact outfit and this exact place for the other shots.`
        : "",
      selfie
        ? "Familiar real settings. Real iPhone selfie. Natural skin. Idol: a bit tall, long legs. NOT cinematic, NOT CGI, NOT a beauty-studio face. Fully clothed. Modest sportswear when active. NO bikini."
        : "Familiar real settings only: cafe, restaurant, beach, resort, hotel breakfast, park, gym, yoga studio, bookstore, study desk, sports court. Candid iPhone look. Natural skin. Idol: a bit tall, long legs. Prefer full-body or three-quarter when the angle allows. NOT cinematic, NOT CGI. Fully clothed. Modest sportswear when active. NO bikini. NEVER wet market, supermarket, laundry, or bus.",
      `The photograph must match this caption: "${captionText}". Same place, same moment. Do not show a different location.`,
      "NO text on the photograph. No quote, no caption, no overlay, no letters.",
      "If the reference photo has text, do not copy it.",
      "No logos. No watermarks. No collage. No split screen. No UI.",
    ]
      .filter(Boolean)
      .join(". ");

    return generateImage(prompt, referencePath);
  }

  let imagePath: string | undefined;
  let imagePaths: string[] | undefined;
  let comment: string;

  if (isVietnam && vietnamAlbumAngles.length) {
    log(
      "INFO",
      `${options?.accountName || topic} album: ${vietnamAlbumAngles
        .map((item) => item.id)
        .join(" + ")} / ${vietnamOutfit}`,
    );

    const paths: string[] = [];

    for (let i = 0; i < vietnamAlbumAngles.length; i += 1) {
      const angle = vietnamAlbumAngles[i];
      const referencePath =
        i === 0
          ? options?.referenceImagePath
          : paths[0] || options?.referenceImagePath;

      try {
        const made = await generateVietnamShot(
          angle,
          i > 0,
          i,
          vietnamAlbumAngles.length,
          referencePath,
        );

        if (made) {
          paths.push(made);
        }
      } catch (error) {
        log(
          "WARN",
          `${options?.accountName || topic} album shot ${i + 1} failed: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 240),
        );

        if (!paths.length) {
          throw error;
        }

        break;
      }
    }

    imagePaths = paths;
    imagePath = paths[0];
    comment = await commentPromise;
  } else {
    const generatedPair = await Promise.all([
      generateImage(imagePrompt, options?.referenceImagePath),
      commentPromise,
    ]);

    imagePath = generatedPair[0];
    comment = generatedPair[1];
  }

  log("INFO", `Comment ready: "${comment}"`);

  return {
    content,
    imagePath,
    imagePaths,
    comment,
  };
}
