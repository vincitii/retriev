const CLAUDE_API_URL = '/api/anthropic';

export async function claudeComplete(prompt, maxTokens = 800) {
	const body = {
		model: 'claude-sonnet-4-20250514',
		prompt: `Human: ${prompt}\n\nAssistant:`,
		max_tokens_to_sample: maxTokens,
		temperature: 0.25,
		top_p: 1,
		stop_sequences: ['Human:'],
	};

	const response = await fetch(CLAUDE_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Anthropic proxy error: ${response.status} ${response.statusText} ${text}`);
	}

	const data = await response.json();
	return data.completion || '';
}
