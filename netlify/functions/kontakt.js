exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, email, message, company } = body;
  if (!name || !email || !message) {
    return { statusCode: 400, body: 'Fehlende Felder' };
  }

  const res = await fetch('https://api.trigger.dev/api/v1/tasks/sofort-antwort/trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
    },
    body: JSON.stringify({
      payload: { name, email, message, company: company || '' }
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Trigger.dev Fehler:', res.status, text);
    return { statusCode: 500, body: 'Trigger fehlgeschlagen' };
  }

  return { statusCode: 200, body: 'OK' };
};
