import fs from "node:fs";
import path from "node:path";
import { listProfiles } from "./genlogin.js";

export type AccountConfig = {
  name: string;
  topic: string;
  enabled?: boolean;
  profileId?: string;
  imageStyle?: string;
  source?: "original" | "rewrite-real-stories";
  pageDna?: string;
  pillars?: string[];
  emotions?: string[];
};

const accountsDir = path.resolve("accounts");

export function loadAccounts(): AccountConfig[] {
  if (!fs.existsSync(accountsDir)) {
    throw new Error(`Accounts folder not found: ${accountsDir}`);
  }

  const files = fs
    .readdirSync(accountsDir)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .sort();

  const accounts = files.map((file) => {
    const raw = fs.readFileSync(path.join(accountsDir, file), "utf8");
    const parsed = JSON.parse(raw) as AccountConfig;

    if (!parsed?.name || !parsed?.topic) {
      throw new Error(`${file} must include "name" and "topic"`);
    }

    return {
      name: String(parsed.name).trim(),
      topic: String(parsed.topic).trim(),
      enabled: parsed.enabled !== false,
      profileId: parsed.profileId ? String(parsed.profileId) : undefined,
      imageStyle: parsed.imageStyle ? String(parsed.imageStyle).trim() : undefined,
      source: (parsed.source === "rewrite-real-stories"
        ? "rewrite-real-stories"
        : "original") as AccountConfig["source"],
      pageDna: parsed.pageDna ? String(parsed.pageDna).trim() : undefined,
      pillars: Array.isArray(parsed.pillars)
        ? parsed.pillars.map((item) => String(item).trim()).filter(Boolean)
        : undefined,
      emotions: Array.isArray(parsed.emotions)
        ? parsed.emotions.map((item) => String(item).trim()).filter(Boolean)
        : undefined,
    };
  });

  return accounts.filter((account) => account.enabled);
}

function profileName(profile: Record<string, any>) {
  return String(
    profile.name ||
      profile.profile_data?.name ||
      profile.profileData?.name ||
      "",
  ).trim();
}

export async function resolveAccountProfileId(account: AccountConfig) {
  if (account.profileId) {
    return account.profileId;
  }

  const { profiles } = await listProfiles();
  const match = profiles.find(
    (profile) =>
      profileName(profile as Record<string, any>).toLowerCase() ===
      account.name.toLowerCase(),
  );

  if (!match?.id) {
    throw new Error(
      `No Genlogin profile named "${account.name}". Check the accounts JSON and the Genlogin app.`,
    );
  }

  return String(match.id);
}
