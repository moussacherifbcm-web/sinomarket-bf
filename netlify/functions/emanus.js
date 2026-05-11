// Netlify Function — Proxy sécurisé pour Gemini
// La clé API est cachée côté serveur, jamais exposée au navigateur

exports.handler = async function(event, context) {

  // CORS headers — toujours inclus, même pour OPTIONS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Gérer le preflight OPTIONS (navigateur l'envoie avant POST)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Autoriser seulement les requêtes POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { messages, systemPrompt } = body;

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Messages invalides' })
      };
    }

    // Clé API Gemini — stockée dans les variables d'environnement Netlify
    const GEMINI_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Clé API non configurée sur le serveur' })
      };
    }

    // Construire les messages pour Gemini
    // Gemini exige que les rôles alternent user/model et commencent par user
    const geminiContents = [];

    // Injecter le system prompt comme premier échange user/model
    if (systemPrompt) {
      geminiContents.push({
        role: 'user',
        parts: [{ text: systemPrompt + '\n\nCompris ? Présente-toi brièvement.' }]
      });
      geminiContents.push({
        role: 'model',
        parts: [{ text: 'Compris ! Je suis Emanus, assistant SinoMarket BF. Je suis prêt à aider les clients.' }]
      });
    }

    // Ajouter l'historique — en s'assurant que les rôles alternent correctement
    messages.forEach(function(msg) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      // Éviter deux messages consécutifs du même rôle
      const lastRole = geminiContents.length > 0
        ? geminiContents[geminiContents.length - 1].role
        : null;
      if (lastRole === role) {
        // Fusionner avec le message précédent
        geminiContents[geminiContents.length - 1].parts[0].text += '\n' + msg.content;
      } else {
        geminiContents.push({
          role: role,
          parts: [{ text: msg.content }]
        });
      }
    });

    // S'assurer que le dernier message est bien de l'user
    if (geminiContents.length === 0 || geminiContents[geminiContents.length - 1].role !== 'user') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Dernier message doit venir de l\'utilisateur' })
      };
    }

    // Appel à l'API Gemini 2.0 Flash (modèle actuel)
    const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
    const response = await fetchFn(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: 'Erreur Gemini (' + response.status + '): ' + errorText })
      };
    }

    const data = await response.json();

    // Extraire la réponse
    const reply = (
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text
    ) ? data.candidates[0].content.parts[0].text
      : 'Je n\'ai pas pu répondre, veuillez réessayer.';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: reply })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur: ' + error.message })
    };
  }
};
