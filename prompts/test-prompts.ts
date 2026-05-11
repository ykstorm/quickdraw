export const BENCHMARK_PROMPTS = [
  'Explain quantum entanglement in one paragraph.',
  'What is the difference between a mutex and a semaphore?',
  'Describe the water cycle in three sentences.',
  'Write a haiku about artificial intelligence.',
  'What are the primary colors?',
  'How does photosynthesis work?',
  'Explain why the sky is blue.',
  'What is the capital of France?',
  'Describe what a neural network does in simple terms.',
  'What is 15% of 200?',
]

export function getPrompt(index: number): string {
  return BENCHMARK_PROMPTS[index % BENCHMARK_PROMPTS.length]
}