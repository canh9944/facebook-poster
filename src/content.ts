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
      fs.writeFileSync(imagePath, Buffer.from(image.b64_json, "base64"));
      return imagePath;
    }

    if (image.url) {
      const download = await fetch(image.url);

      if (!download.ok) {
        lastError = "Could not download generated image";
        continue;
      }

      fs.writeFileSync(imagePath, Buffer.from(await download.arrayBuffer()));
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
            'You write Facebook posts in English. Choose one timely topic from current internet trends, then write the post. Decide whether the post needs an image. News, weather, products, events, places, and visual stories need an image. Pure opinions, quotes, or tips do not. Return JSON only: {"content":"facebook post text only","needsImage":true,"imagePrompt":"short English prompt for a simple social image, or empty string"}. content must be 80-150 words with a short hook, 2-4 short paragraphs, and 2-4 hashtags. No markdown.',
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

  const content = parsed.content?.trim();

  if (!content) {
    throw new Error("OpenAI API returned empty post content");
  }

  if (!parsed.needsImage && !options?.forceImage) {
    return { content };
  }

  const imagePrompt =
    parsed.imagePrompt?.trim() ||
    `Simple low-detail social media illustration for this Facebook post: ${content.slice(0, 200)}`;

  const imagePath = await generateImage(imagePrompt);

  return { content, imagePath };
}
