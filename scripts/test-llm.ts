import { getLlmClient } from '../src/llm/client';

async function main() {
  const llm = getLlmClient();
  console.log('Provider:', llm.getProviderName());
  console.log('Available:', llm.isAvailable());

  if (!llm.isAvailable()) {
    console.log('LLM not available. Check DEEPSEEK_API_KEY in .env');
    process.exit(1);
  }

  console.log('\n--- Testing DeepSeek API ---');
  const result = await llm.completeJson<{ greeting: string }>(
    'You are a security test. Reply ONLY with JSON: {"greeting":"hello"}',
    'Say hi.',
    { maxTokens: 50, temperature: 0 }
  );

  console.log('Result:', JSON.stringify(result));

  if (result) {
    console.log('\n✅ LLM API working!');
  } else {
    console.log('\n❌ LLM API returned null');
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
