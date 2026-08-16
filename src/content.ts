const MODEL = "gpt-4o-mini";
const API_KEY = "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";

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
    fetchHeadlines("https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi"),
    fetchHeadlines("https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en&gl=US&ceid=US:en"),
  ]);

  return sources
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter(Boolean)
    .slice(0, 20);
}

export async function generatePost() {
  const trends = await currentTrends();
  const today = new Date().toISOString().slice(0, 10);
  const trendList = trends.length
    ? trends.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "(no live headlines available)";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content:
            "You write Facebook posts in Vietnamese. First choose one timely topic from current internet trends, then write the post. Return only the post text. Keep it natural, useful, 80-150 words, with a short hook, 2-4 short paragraphs, and 2-4 relevant hashtags. Do not use markdown. Do not mention that you picked the topic from a list.",
        },
        {
          role: "user",
          content: `Today is ${today}. Choose one current internet trend from these live headlines and write a ready-to-publish Facebook post about it:\n\n${trendList}`,
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

  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenAI API returned empty content");
  }

  return content;
}
