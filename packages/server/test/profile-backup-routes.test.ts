import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { backupRoutes } from "../src/routes/backup.routes.js";
import { createFileNativeDB } from "../src/db/file-backed-store.js";
import {
  apiConnections,
  characterImages,
  characters,
  chatImages,
  chats,
  lorebookCharacterLinks,
  lorebooks,
  messages,
} from "../src/db/schema/index.js";

const timestamp = "2026-05-15T00:00:00.000Z";

async function withProfileApp<T>(dataDir: string, fn: (app: FastifyInstance) => Promise<T>) {
  const previousDataDir = process.env.DATA_DIR;
  const previousStorageDir = process.env.FILE_STORAGE_DIR;
  process.env.DATA_DIR = dataDir;
  process.env.FILE_STORAGE_DIR = join(dataDir, "storage");

  const db = await createFileNativeDB([]);
  const app = Fastify({ logger: false });
  app.decorate("db", db);
  await app.register(backupRoutes, { prefix: "/api/backup" });

  try {
    return await fn(app);
  } finally {
    await app.close();
    await db._fileStore.close();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
    else process.env.FILE_STORAGE_DIR = previousStorageDir;
  }
}

async function seedProfileRows(app: FastifyInstance, dataDir: string) {
  await app.db.insert(characters).values({
    id: "char-847",
    data: JSON.stringify({ name: "Profile Character", description: "Roundtrip fixture" }),
    comment: "",
    avatarPath: "avatars/char-847.png",
    spriteFolderPath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await app.db.insert(apiConnections).values({
    id: "conn-847",
    name: "Roundtrip Connection",
    provider: "custom",
    baseUrl: "http://127.0.0.1:1234",
    apiKeyEncrypted: "redacted-on-profile-export",
    model: "test-model",
    maxContext: 8192,
    isDefault: "false",
    useForRandom: "false",
    enableCaching: "false",
    cachingAtDepth: 5,
    defaultForAgents: "false",
    embeddingModel: "",
    embeddingBaseUrl: "",
    embeddingConnectionId: null,
    openrouterProvider: null,
    imageGenerationSource: null,
    comfyuiWorkflow: null,
    imageService: null,
    defaultParameters: null,
    promptPresetId: null,
    maxTokensOverride: null,
    maxParallelJobs: 1,
    claudeFastMode: "false",
    folderId: null,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await app.db.insert(chats).values({
    id: "chat-847",
    name: "Roundtrip Chat",
    mode: "roleplay",
    characterIds: JSON.stringify(["char-847"]),
    groupId: null,
    personaId: null,
    promptPresetId: null,
    connectionId: "conn-847",
    metadata: "{}",
    connectedChatId: null,
    folderId: null,
    sortOrder: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await app.db.insert(messages).values({
    id: "msg-847",
    chatId: "chat-847",
    role: "user",
    characterId: null,
    content: "This message should survive profile import.",
    activeSwipeIndex: 0,
    extra: "{}",
    createdAt: timestamp,
  });
  await app.db.insert(lorebooks).values({
    id: "lore-847",
    name: "Roundtrip Lorebook",
    description: "",
    category: "world",
    scanDepth: 2,
    tokenBudget: 2048,
    recursiveScanning: "false",
    maxRecursionDepth: 3,
    characterId: "char-847",
    personaId: null,
    chatId: null,
    isGlobal: "false",
    enabled: "true",
    tags: "[]",
    generatedBy: null,
    sourceAgentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await app.db.insert(lorebookCharacterLinks).values({
    id: "link-847",
    lorebookId: "lore-847",
    characterId: "char-847",
    createdAt: timestamp,
  });
  await app.db.insert(characterImages).values({
    id: "character-image-847",
    characterId: "char-847",
    filePath: "characters/char-847/gallery.png",
    prompt: "character gallery",
    provider: "test",
    model: "fixture",
    width: 1,
    height: 1,
    createdAt: timestamp,
  });
  await app.db.insert(chatImages).values({
    id: "chat-image-847",
    chatId: "chat-847",
    filePath: "chats/chat-847/gallery.png",
    prompt: "chat gallery",
    provider: "test",
    model: "fixture",
    width: 1,
    height: 1,
    createdAt: timestamp,
  });

  mkdirSync(join(dataDir, "avatars"), { recursive: true });
  mkdirSync(join(dataDir, "gallery", "characters", "char-847"), { recursive: true });
  mkdirSync(join(dataDir, "gallery", "chats", "chat-847"), { recursive: true });
  writeFileSync(join(dataDir, "avatars", "char-847.png"), Buffer.from("avatar"));
  writeFileSync(join(dataDir, "gallery", "characters", "char-847", "gallery.png"), Buffer.from("character-gallery"));
  writeFileSync(join(dataDir, "gallery", "chats", "chat-847", "gallery.png"), Buffer.from("chat-gallery"));
}

test("profile export/import preserves file-native chats, connections, lorebook links, and images", async () => {
  const root = join(tmpdir(), `marinara-profile-roundtrip-${process.pid}-${Date.now()}`);
  try {
    let envelope: Record<string, any> | null = null;
    await withProfileApp(join(root, "source"), async (app) => {
      await seedProfileRows(app, join(root, "source"));
      const response = await app.inject({ method: "GET", url: "/api/backup/export-profile" });
      assert.equal(response.statusCode, 200, response.body);
      envelope = JSON.parse(response.body) as Record<string, any>;

      assert.ok(envelope.data.fileStorage?.tables?.chats?.some((row: any) => row.id === "chat-847"));
      assert.ok(envelope.data.fileStorage?.tables?.messages?.some((row: any) => row.id === "msg-847"));
      assert.ok(envelope.data.fileStorage?.tables?.api_connections?.some((row: any) => row.id === "conn-847"));
      assert.equal(
        envelope.data.fileStorage.tables.api_connections.find((row: any) => row.id === "conn-847").apiKeyEncrypted,
        "",
      );
    });

    await withProfileApp(join(root, "target"), async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/backup/import-profile",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(envelope),
      });
      assert.equal(response.statusCode, 200, response.body);

      const restoredChats = await app.db.select().from(chats);
      const restoredMessages = await app.db.select().from(messages);
      const restoredConnections = await app.db.select().from(apiConnections);
      const restoredLinks = await app.db.select().from(lorebookCharacterLinks);
      const restoredChatImages = await app.db.select().from(chatImages);
      const restoredCharacterImages = await app.db.select().from(characterImages);
      const targetDir = join(root, "target");

      assert.ok(restoredChats.some((row) => row.id === "chat-847"));
      assert.ok(restoredMessages.some((row) => row.id === "msg-847"));
      assert.ok(restoredConnections.some((row) => row.id === "conn-847" && row.apiKeyEncrypted === ""));
      assert.ok(restoredLinks.some((row) => row.lorebookId === "lore-847" && row.characterId === "char-847"));
      assert.ok(restoredChatImages.some((row) => row.id === "chat-image-847"));
      assert.ok(restoredCharacterImages.some((row) => row.id === "character-image-847"));
      assert.equal(existsSync(join(targetDir, "avatars", "char-847.png")), true);
      assert.equal(existsSync(join(targetDir, "gallery", "characters", "char-847", "gallery.png")), true);
      assert.equal(existsSync(join(targetDir, "gallery", "chats", "chat-847", "gallery.png")), true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
