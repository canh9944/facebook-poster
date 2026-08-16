import "./env.js";
import fs from "node:fs";
import path from "node:path";

const TEXT_MODEL = "gpt-4o-mini";
const IMAGE_MODEL = "gpt-image-2";
const imageDir = path.resolve("data/generated-images");

export type GeneratedPost = {
  content: string;
  imagePath?: string;
};

function openaiApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();

  if (!key) {
    throw new Error("OPENAI_API_KEY is missing. Add it to the .env file.");
  }

  return key;
}

async function fetchHeadlines(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "facebook-auto-poster/1.0",
    },
  });

  if (!response.ok) {
    return [];
  }

  const text = await response.text();
  const titles = [...text.matchAll(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gi)].map(
    (match) =>
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim(),
  );

  return titles.slice(1, 12);
}

async function currentTrends() {
  const sources = await Promise.allSettled([
    fetchHeadlines("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"),
    fetchHeadlines("https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en&gl=US&ceid=US:en"),
  ]);

  return sources
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter(Boolean)
    .slice(0, 20);
}

function stripEmojis(text: string) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0F\u200D]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/  +/g, " ")
    .trim();
}

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

function saveCleanJpeg(imagePath: string, raw: Buffer) {
  fs.writeFileSync(imagePath, stripJpegMetadata(raw));
}

async function generateImage(prompt: string) {
  const models = [IMAGE_MODEL, "gpt-image-1"];
  let lastError = "";

  for (const model of models) {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
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
    });

    if (!response.ok) {
      lastError = await response.text();
      continue;
    }

    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const image = data.data?.[0];

    if (!image) {
      lastError = "OpenAI image API returned no image";
      continue;
    }

    fs.mkdirSync(imageDir, { recursive: true });

    const filename = `post-${Date.now()}.jpg`;
    const imagePath = path.join(imageDir, filename);

    if (image.b64_json) {
      saveCleanJpeg(imagePath, Buffer.from(image.b64_json, "base64"));
      return imagePath;
    }

    if (image.url) {
      const download = await fetch(image.url);

      if (!download.ok) {
        lastError = "Could not download generated image";
        continue;
      }

      saveCleanJpeg(imagePath, Buffer.from(await download.arrayBuffer()));
      return imagePath;
    }

    lastError = "OpenAI image API returned neither b64_json nor url";
  }

  throw new Error(`OpenAI image API error: ${lastError}`);
}

export async function generatePost(options?: {
  forceImage?: boolean;
}): Promise<GeneratedPost> {
  const trends = await currentTrends();
  const today = new Date().toISOString().slice(0, 10);
  const trendList = trends.length
    ? trends.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(no live headlines available)";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You write Facebook posts in English like a normal person, not a brand or a news bot. No emojis, no icons, no decorative symbols, no markdown. Avoid stock phrases like stay tuned, major news, unleashes, or revolutionize. Use contractions and a casual tone. Choose one timely topic from current internet trends, then write the post. Decide whether the post needs an image. News, weather, products, events, places, and visual stories need an image. Return JSON only: {"content":"facebook post text only","needsImage":true,"imagePrompt":"short prompt for a natural-looking phone photo with no text, logos, watermarks, or UI, or empty string"}. content must be 80-150 words, 2-4 short paragraphs, and 2-4 hashtags.',
        },
        {
          role: "user",
          content: `Today is ${today}. Choose one current internet trend from these live headlines and return JSON for a Facebook post:\n\n${trendList}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${details}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content?.trim();

  if (!raw) {
    throw new Error("OpenAI API returned empty content");
  }

  const parsed = JSON.parse(raw) as {
    content?: string;
    needsImage?: boolean;
    imagePrompt?: string;
  };

  const content = stripEmojis(parsed.content?.trim() || "");

  if (!content) {
    throw new Error("OpenAI API returned empty post content");
  }

  if (!parsed.needsImage && !options?.forceImage) {
    return { content };
  }

  const imagePrompt =
    parsed.imagePrompt?.trim() ||
    `Casual phone photo related to this post, natural lighting, no text, no watermark, no logo: ${content.slice(0, 180)}`;

  const imagePath = await generateImage(imagePrompt);

  return { content, imagePath };
}
