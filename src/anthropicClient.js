const PROXY_URL = 'http://localhost:3001/api/chat';

export async function claudeComplete(prompt, maxTokens = 800, systemPrompt = null) {
  const body = {
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt || 'You are a helpful assistant.',
    messages: [
      { role: 'user', content: prompt },
    ],
    max_tokens: 8000,
  };

  console.log('Claude request body:', JSON.stringify(body, null, 2));

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  console.log('Claude proxy response status:', response.status, response.statusText);
  console.log('Claude proxy response headers:', Array.from(response.headers.entries()));

  let responseText = await response.text();
  console.log('Claude proxy raw response text:', responseText);

  if (!response.ok) {
    throw new Error(`Anthropic proxy error: ${response.status} ${response.statusText} ${responseText}`);
  }

  responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (parseError) {
    console.error('Failed to parse Claude API response JSON:', parseError, responseText);
    throw parseError;
  }

  const resultText = data?.content?.[0]?.text || '';
  console.log('Claude parsed text output length:', resultText.length, 'text preview:', resultText.substring(0, 200));
  return resultText;
}
