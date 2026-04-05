// Vercel serverless function: transcribes video audio via AssemblyAI
// Auto-routed at /api/transcribe-video?url=...

export default async function handler(req, res) {
  const url = req.query.url || req.body?.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY not configured. Sign up at assemblyai.com and add your key to Vercel env vars.' });
  }

  try {
    // Step 1: Submit transcription request
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: url,
        language_detection: true,
      }),
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      console.error('AssemblyAI submit error:', err);
      return res.status(502).json({ error: 'Failed to submit transcription request' });
    }

    const { id } = await submitRes.json();

    // Step 2: Poll for completion (max 60 seconds for short videos)
    const startTime = Date.now();
    const timeout = 55000; // 55s to stay within Vercel 60s limit

    while (Date.now() - startTime < timeout) {
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { 'Authorization': apiKey },
      });

      if (!pollRes.ok) {
        return res.status(502).json({ error: 'Failed to check transcription status' });
      }

      const result = await pollRes.json();

      if (result.status === 'completed') {
        return res.status(200).json({
          text: result.text,
          words: result.words,
          duration: result.audio_duration,
          language: result.language_code,
        });
      }

      if (result.status === 'error') {
        return res.status(502).json({
          error: result.error || 'Transcription failed',
        });
      }

      // Wait 2 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Timed out — return the transcript ID so client can poll later
    return res.status(202).json({
      status: 'processing',
      transcriptId: id,
      message: 'Transcription is still processing. The video may be long.',
    });
  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
