import "./env.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const GenloginLib = require("genlogin") as new (apiKey?: string) => {
  getProfile(id: string | number): Promise<any>;
  getProfiles(offset?: number, limit?: number): Promise<any>;
  getWsEndpoint(id: string | number): Promise<any>;
  runProfile(id: string | number): Promise<any>;
  stopProfile(id: string | number): Promise<any>;
  getProfilesRunning(): Promise<any>;
};

export type GenloginProfile = {
  id: string | number;
  name?: string;
  [key: string]: unknown;
};

const client = new GenloginLib(process.env.GENLOGIN_API_KEY || "");
const LOCAL_URL = "http://localhost:55550/backend/profiles";

function extractWsEndpoint(result: any): string {
  return (
    result?.wsEndpoint ||
    result?.data?.wsEndpoint ||
    result?.data?.data?.wsEndpoint ||
    ""
  );
}

export async function listProfiles(offset = 0, limit = 1000) {
  const result = await client.getProfiles(offset, limit);

  if (!result?.profiles) {
    throw new Error(
      result?.message ||
        "Could not load Genlogin profiles. Is the Genlogin app running on localhost:55550?",
    );
  }

  return result as {
    profiles: GenloginProfile[];
    pagination: unknown;
  };
}

export async function getProfile(id: string | number) {
  return client.getProfile(id);
}

export async function listRunningProfiles() {
  return client.getProfilesRunning();
}

export async function startProfile(id: string | number) {
  const endpoint = await fetch(`${LOCAL_URL}/${id}/ws-endpoint`).then((res) =>
    res.json(),
  );
  let wsEndpoint = extractWsEndpoint(endpoint);

  if (!wsEndpoint) {
    const started = await fetch(`${LOCAL_URL}/${id}/start`, {
      method: "PUT",
    }).then((res) => res.json());

    wsEndpoint = extractWsEndpoint(started);

    if (!wsEndpoint) {
      throw new Error(
        started?.message ||
          `Could not start Genlogin profile ${id}. Is it already running on another device?`,
      );
    }
  }

  return {
    success: true as const,
    wsEndpoint,
  };
}

export async function stopProfile(id: string | number) {
  return client.stopProfile(id);
}
