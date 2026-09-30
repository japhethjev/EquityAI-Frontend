exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        detail: "Method not allowed."
      })
    };
  }

  const apiKey = process.env.EQUITYAI_API_KEY;

  if (!apiKey) {
    console.error("EQUITYAI_API_KEY is not configured");

    return {
      statusCode: 503,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        detail: "AI service is temporarily unavailable."
      })
    };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const question = String(payload.question || "").trim();

    if (!question) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          detail: "Question cannot be empty."
        })
      };
    }

    const response = await fetch(
      "https://api.equityai.com.ng/ask",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey
        },
        body: JSON.stringify({
          question: question
        })
      }
    );

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error("Ask EquityAI function failed:", error);

    return {
      statusCode: 502,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        detail: "Unable to reach the AI service."
      })
    };
  }
};
