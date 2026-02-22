exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { email, name } = JSON.parse(event.body || '{}');
  if (!email) {
    return { statusCode: 400, body: 'Missing email' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Sunday <onboarding@resend.dev>',
      to: 'baldaufdan@gmail.com',
      subject: `New Sunday Signup: ${name || 'Unknown'}`,
      text: `New user signed up for Sunday!\n\nName: ${name || 'N/A'}\nEmail: ${email}`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
    return { statusCode: 500, body: 'Failed to send notification' };
  }

  return { statusCode: 200, body: 'Notification sent' };
};
