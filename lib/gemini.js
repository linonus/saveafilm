const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

async function callGemini(parts) {
  const url = `${BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

function parseJsonArray(text) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter((t) => typeof t === 'string' && t.trim());
    }
  } catch (err) {
    console.error('Gemini: не получилось распарсить ответ как JSON:', text);
  }
  return [];
}

// По текстовому описанию сюжета пытается угадать название фильма/сериала.
// Возвращает массив из 1-3 наиболее вероятных названий.
export async function guessTitleFromDescription(description) {
  const prompt = `Ты помогаешь вспомнить название фильма или сериала по описанию сюжета от пользователя, который сам не помнит точное название.
Описание пользователя: "${description}"

Ответь СТРОГО в формате JSON-массива строк с 1-3 наиболее вероятными точными названиями (используй официальные русские названия, если они есть). Никаких пояснений, только JSON.
Пример ответа: ["Начало", "Помни"]`;

  const text = await callGemini([{ text: prompt }]);
  return parseJsonArray(text);
}

// По изображению (кадру/скриншоту) пытается определить фильм или сериал.
// Возвращает массив из 1 строки с наиболее вероятным названием.
export async function guessTitleFromImage(base64Image, mimeType) {
  const prompt = `На этом изображении — кадр или скриншот из фильма или сериала. Определи, из какого именно фильма или сериала этот кадр, по актёрам, обстановке, стилю.

Ответь СТРОГО в формате JSON-массива из одной строки с наиболее вероятным точным названием (используй официальное русское название, если оно есть). Если не уверен на 100% — всё равно дай наиболее вероятный вариант. Никаких пояснений, только JSON.
Пример ответа: ["Матрица"]`;

  const text = await callGemini([
    { text: prompt },
    { inline_data: { mime_type: mimeType, data: base64Image } },
  ]);
  return parseJsonArray(text);
}
