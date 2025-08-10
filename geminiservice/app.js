// Gemini RAG Chatbot Backend
// Node.js + Express + Vertex AI (Gemini) + SQLite for embedding + user tracking

import express from 'express';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();

const {
  PROJECT_ID,
  LOCATION,
  EMBEDDING_MODEL,
  GENERATION_MODEL,
  TOP_K = 3,
  CHAT_LIMIT = 2
} = process.env;

// SQLite setup
const db = new Database('rag_store.db');
db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  text TEXT,
  embedding BLOB,
  inserted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_chats (
  user_id TEXT PRIMARY KEY,
  chat_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

async function getAuthHeaders() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse.token;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// Get embedding from Gemini embedding model
async function embedText(text) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instances: [{ content: text }]
    })
  });

  const data = await res.json();
  if (!data?.predictions?.[0]?.embedding) {
    console.error("Embedding error:", data);
    throw new Error("Failed to generate embedding");
  }
  return data.predictions[0].embedding;
}

// Cosine similarity function
function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function addDocument(id, text) {
  const embedding = await embedText(text);
  db.prepare(`INSERT OR REPLACE INTO documents (id, text, embedding) VALUES (?, ?, ?)`)
    .run(id, text, JSON.stringify(embedding));
}

async function retrieveRelevant(query, k = TOP_K) {
  const queryEmbedding = await embedText(query);
  const rows = db.prepare(`SELECT id, text, embedding FROM documents`).all();
  return rows.map(r => {
    const emb = JSON.parse(r.embedding);
    return { id: r.id, text: r.text, score: cosineSim(queryEmbedding, emb) };
  }).sort((a, b) => b.score - a.score).slice(0, k);
}

// Correct Gemini generation API call
async function generateAnswer(prompt) {
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${GENERATION_MODEL}:generateContent`;
  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 }
    })
  });

  const data = await res.json();
  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error("Generation error:", data);
    throw new Error("Failed to generate answer");
  }
  return data.candidates[0].content.parts[0].text;
}

function incrementChatCount(userId) {
  const existing = db.prepare('SELECT chat_count FROM user_chats WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare('UPDATE user_chats SET chat_count = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(existing.chat_count + 1, userId);
    return existing.chat_count + 1;
  } else {
    db.prepare('INSERT INTO user_chats (user_id, chat_count) VALUES (?, 1)').run(userId);
    return 1;
  }
}

function getChatCount(userId) {
  const r = db.prepare('SELECT chat_count FROM user_chats WHERE user_id = ?').get(userId);
  return r ? r.chat_count : 0;
}

const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post('/ask', async (req, res) => {
  try {
    const { userId, presetQuestions, userPrompt } = req.body;
    if (!userId || !Array.isArray(presetQuestions) || presetQuestions.length !== 2)
      return res.status(400).json({ error: 'Invalid input' });

    const currentCount = getChatCount(userId);
    if (currentCount >= CHAT_LIMIT) return res.json({ limitReached: true });

    const retrievalQuery = [presetQuestions[0], presetQuestions[1], userPrompt || ''].join('\n');
    const relevant = await retrieveRelevant(retrievalQuery, Number(TOP_K));

    let prompt = `You are an expert assistant. Use the following context to answer user questions.\n`;
    prompt += `Question 1: ${presetQuestions[0]}\n`;
    prompt += `Question 2: ${presetQuestions[1]}\n`;
    if (userPrompt) prompt += `User input: ${userPrompt}\n`;
    relevant.forEach((r, i) => prompt += `\n--- Doc ${i + 1}:\n${r.text}\n`);
    prompt += `\nProvide a concise and helpful answer using this context.`;

    const answer = await generateAnswer(prompt);
    const newCount = incrementChatCount(userId);
    res.json({ answer: answer.trim(), chatCount: newCount });
  } catch (e) {
    console.error('Ask error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/add-doc', async (req, res) => {
  try {
    const { id, text } = req.body;
    if (!id || !text) return res.status(400).json({ error: 'Missing id or text' });
    await addDocument(id, text);
    res.json({ success: true });
  } catch (e) {
    console.error('Add-doc error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 4000, () => {
  console.log('Gemini chatbot backend running');
});
