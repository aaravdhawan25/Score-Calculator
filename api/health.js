// GET /api/health — tells the page whether analysis is available, without
// revealing anything about the key itself.
export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ai: Boolean(process.env.OPENAI_API_KEY) || process.env.MOCK_AI === '1',
    mock: process.env.MOCK_AI === '1',
    accessCode: Boolean(process.env.ACCESS_CODE),
  }));
}
